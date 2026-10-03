import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { runIdempotent } from '../db/idempotency.js';
import { inTransaction, pool } from '../db/pool.js';
import { buildReferralCommissions, fetchSponsorLevels } from '../lib/referralEngine.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { postWalletMovement } from '../services/wallet.js';
export const rechargesRouter = Router();
rechargesRouter.use(requireAuth);
export const adminRechargesRouter = Router();
adminRechargesRouter.use(requireAuth, requireAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const privateDirectory = resolve(process.env.PRIVATE_UPLOAD_DIR ?? 'server/private-uploads');
const isWithinPrivateDirectory = (target) => {
    const normalizedTarget = resolve(target);
    return normalizedTarget === privateDirectory || normalizedTarget.startsWith(`${privateDirectory}${sep}`);
};
const amountSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/, 'Enter a valid amount with up to two decimal places.');
rechargesRouter.post('/', upload.single('proof'), async (request, response, next) => {
    let storedPath;
    try {
        const parsed = z.object({
            amount: amountSchema,
            paymentMethodId: z.string().uuid(),
            transactionReference: z.string().trim().min(5, 'FT / Transaction reference must be at least 5 digits/characters.').max(120),
            senderName: z.string().trim().max(120).optional().default(''),
            senderAccount: z.string().trim().max(120).optional().default(''),
        }).safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the recharge details.', code: 'VALIDATION_ERROR' });
        let detected = null;
        if (request.file) {
            detected = await fileTypeFromBuffer(request.file.buffer);
            const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
            if (!detected || !allowed.has(detected.mime))
                return response.status(400).json({ success: false, message: 'Upload a valid JPG, PNG, WEBP, or PDF proof.', code: 'INVALID_PROOF' });
        }
        const input = parsed.data;
        const proofDigest = request.file ? createHash('sha256').update(request.file.buffer).digest('hex') : null;
        const result = await inTransaction(async (client) => runIdempotent(client, {
            userId: request.auth.userId,
            operation: 'recharge.submit',
            key: request.get('Idempotency-Key'),
            payload: { ...input, proofDigest },
        }, async () => {
            await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [request.auth.userId]);
            const settings = await client.query(`SELECT key, value #>> '{}' AS value FROM settings WHERE key = ANY($1::text[])`, [['minimum_recharge_amount', 'maximum_recharge_amount', 'daily_recharge_limit', 'monthly_recharge_limit', 'maximum_pending_recharges']]);
            const limits = Object.fromEntries(settings.rows.map((row) => [row.key, row.value]));
            const amountValid = await client.query(`SELECT $1::numeric >= $2::numeric AS above_minimum, $1::numeric <= $3::numeric AS below_maximum`, [input.amount, limits.minimum_recharge_amount ?? '1', limits.maximum_recharge_amount ?? '1000000']);
            if (!amountValid.rows[0].above_minimum || !amountValid.rows[0].below_maximum)
                throw Object.assign(new Error('The amount is outside the allowed recharge limits.'), { status: 400, code: 'AMOUNT_LIMIT' });
            const method = await client.query('SELECT id FROM payment_methods WHERE id = $1 AND is_active = true', [input.paymentMethodId]);
            if (!method.rowCount)
                throw Object.assign(new Error('That payment method is not available.'), { status: 400, code: 'PAYMENT_METHOD_UNAVAILABLE' });
            const usage = await client.query(`SELECT count(*) FILTER (WHERE status IN ('PENDING', 'UNDER_REVIEW'))::int AS pending,
           coalesce(sum(amount) FILTER (WHERE status NOT IN ('REJECTED', 'CANCELLED') AND created_at >= date_trunc('day', now())), 0)::numeric AS daily,
           coalesce(sum(amount) FILTER (WHERE status NOT IN ('REJECTED', 'CANCELLED') AND created_at >= date_trunc('month', now())), 0)::numeric AS monthly
         FROM recharge_requests WHERE user_id = $1`, [request.auth.userId]);
            const dailyCheck = await client.query('SELECT $1::numeric + $2::numeric <= $3::numeric AS allowed', [usage.rows[0].daily, input.amount, limits.daily_recharge_limit ?? '1000000']);
            const monthlyCheck = await client.query('SELECT $1::numeric + $2::numeric <= $3::numeric AS allowed', [usage.rows[0].monthly, input.amount, limits.monthly_recharge_limit ?? '10000000']);
            if (usage.rows[0].pending >= Number(limits.maximum_pending_recharges ?? '3') || !dailyCheck.rows[0].allowed || !monthlyCheck.rows[0].allowed) {
                throw Object.assign(new Error('A recharge limit has been reached. Try again after a pending request is resolved.'), { status: 400, code: 'RECHARGE_LIMIT' });
            }
            let storageKey = null;
            if (request.file && detected) {
                const id = randomUUID();
                const extension = detected.ext;
                await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
                storedPath = resolve(privateDirectory, `${id}.${extension}`);
                await writeFile(storedPath, request.file.buffer, { flag: 'wx', mode: 0o600 });
                storageKey = `${id}.${extension}`;
            }
            const recharge = await client.query(`INSERT INTO recharge_requests(user_id, payment_method_id, amount, transaction_reference, sender_name, sender_account, payment_date, proof_storage_key)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7) RETURNING id, status, created_at`, [request.auth.userId, input.paymentMethodId, input.amount, input.transactionReference, input.senderName, input.senderAccount, storageKey]);
            await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Recharge submitted', 'Your recharge request is pending verification.', 'RECHARGE_SUBMITTED')", [request.auth.userId]);
            return { status: 201, body: { success: true, data: recharge.rows[0] } };
        }));
        response.status(result.status).json(result.body);
    }
    catch (error) {
        if (storedPath)
            await rm(storedPath, { force: true }).catch(() => undefined);
        next(error);
    }
});
rechargesRouter.get('/', async (request, response, next) => {
    try {
        const result = await pool.query(`SELECT r.id, r.amount::text, r.transaction_reference AS "transactionReference", r.status,
        r.sender_name AS "senderName", r.sender_account AS "senderAccount", r.proof_storage_key AS "proofStorageKey",
        r.created_at AS "createdAt", r.reviewed_at AS "reviewedAt", p.name AS "paymentMethod"
       FROM recharge_requests r JOIN payment_methods p ON p.id = r.payment_method_id
       WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [request.auth.userId]);
        response.json({ success: true, data: result.rows });
    }
    catch (error) {
        next(error);
    }
});
rechargesRouter.post('/:id/proof', upload.single('proof'), async (request, response, next) => {
    let storedPath;
    try {
        if (!request.file)
            return response.status(400).json({ success: false, message: 'Proof file is required.', code: 'PROOF_REQUIRED' });
        const detected = await fileTypeFromBuffer(request.file.buffer);
        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
        if (!detected || !allowed.has(detected.mime))
            return response.status(400).json({ success: false, message: 'Upload a valid JPG, PNG, WEBP, or PDF proof.', code: 'INVALID_PROOF' });
        const existing = await pool.query("SELECT id, status, proof_storage_key FROM recharge_requests WHERE id = $1 AND user_id = $2", [request.params.id, request.auth.userId]);
        if (!existing.rowCount)
            return response.status(404).json({ success: false, message: 'Recharge request not found.', code: 'NOT_FOUND' });
        if (!['PENDING', 'UNDER_REVIEW'].includes(existing.rows[0].status))
            return response.status(400).json({ success: false, message: 'Proof can only be uploaded for pending recharges.', code: 'INVALID_STATUS' });
        const id = randomUUID();
        const extension = detected.ext;
        await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
        storedPath = resolve(privateDirectory, `${id}.${extension}`);
        await writeFile(storedPath, request.file.buffer, { flag: 'wx', mode: 0o600 });
        const storageKey = `${id}.${extension}`;
        await pool.query("UPDATE recharge_requests SET proof_storage_key = $1, updated_at = now() WHERE id = $2", [storageKey, request.params.id]);
        response.json({ success: true, data: { id: request.params.id, proofStorageKey: storageKey } });
    }
    catch (error) {
        if (storedPath)
            await rm(storedPath, { force: true }).catch(() => undefined);
        next(error);
    }
});
rechargesRouter.post('/:id/cancel', async (request, response, next) => {
    try {
        const result = await pool.query("UPDATE recharge_requests SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND user_id = $2 AND status = 'PENDING' RETURNING id", [request.params.id, request.auth.userId]);
        if (!result.rowCount)
            return response.status(409).json({ success: false, message: 'This recharge cannot be cancelled.', code: 'INVALID_STATUS' });
        response.json({ success: true, data: { id: result.rows[0].id, status: 'CANCELLED' } });
    }
    catch (error) {
        next(error);
    }
});
adminRechargesRouter.get('/', async (request, response, next) => {
    try {
        const parsed = z.object({
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().refine((value) => [5, 10, 25, 50, 100].includes(value)).default(25),
            status: z.enum(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
            search: z.string().trim().max(100).optional(),
        }).safeParse(request.query);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: 'Invalid recharge filters.', code: 'VALIDATION_ERROR' });
        const { page, limit, status, search } = parsed.data;
        const values = [];
        const conditions = [];
        const bind = (value) => { values.push(value); return `$${values.length}`; };
        if (status) conditions.push(`r.status = ${bind(status)}`);
        if (search) {
            const match = bind(`%${search}%`);
            conditions.push(`(u.full_name ILIKE ${match} OR u.phone_number::text ILIKE ${match} OR r.transaction_reference ILIKE ${match} OR r.sender_name ILIKE ${match})`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const count = await pool.query(
            `SELECT count(*)::int AS total FROM recharge_requests r JOIN users u ON u.id = r.user_id ${where}`,
            values,
        );
        const limitBind = bind(limit);
        const offsetBind = bind((page - 1) * limit);
        const result = await pool.query(`SELECT r.id, r.user_id AS "userId", u.full_name AS "fullName", u.phone_number AS "phoneNumber",
        r.amount::text, r.transaction_reference AS "transactionReference", r.sender_name AS "senderName",
        r.sender_account AS "senderAccount", r.payment_date AS "paymentDate", r.status,
        r.proof_storage_key IS NOT NULL AS "hasProof",
        lower(split_part(r.proof_storage_key, '.', 2)) IN ('jpg', 'jpeg', 'png', 'webp') AS "proofIsImage",
        r.created_at AS "createdAt", p.name AS "paymentMethod"
       FROM recharge_requests r JOIN users u ON u.id = r.user_id JOIN payment_methods p ON p.id = r.payment_method_id
       ${where} ORDER BY CASE WHEN r.status IN ('PENDING', 'UNDER_REVIEW') THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT ${limitBind} OFFSET ${offsetBind}`, values);
        response.json({ success: true, data: {
            items: result.rows,
            pagination: { page, limit, total: count.rows[0].total, pages: Math.ceil(count.rows[0].total / limit) },
        } });
    }
    catch (error) {
        next(error);
    }
});
adminRechargesRouter.get('/:id/proof', async (request, response, next) => {
    try {
        const result = await pool.query('SELECT proof_storage_key FROM recharge_requests WHERE id = $1', [request.params.id]);
        if (!result.rowCount || !result.rows[0].proof_storage_key)
            return response.status(404).json({ success: false, message: 'Payment proof not found.', code: 'NOT_FOUND' });
        const file = resolve(privateDirectory, result.rows[0].proof_storage_key);
        if (!isWithinPrivateDirectory(file))
            return response.status(400).json({ success: false, message: 'Invalid proof reference.', code: 'INVALID_PROOF' });
        const extension = result.rows[0].proof_storage_key.split('.').at(-1)?.toLowerCase();
        const contentTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
        const contentType = contentTypes[extension];
        if (!contentType)
            return response.status(400).json({ success: false, message: 'Invalid proof type.', code: 'INVALID_PROOF' });
        response.setHeader('Cache-Control', 'private, no-store');
        response.setHeader('Content-Type', contentType);
        const inline = request.query.inline === '1' && contentType.startsWith('image/');
        response.setHeader('Content-Disposition', inline ? 'inline' : 'attachment');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        createReadStream(file).on('error', next).pipe(response);
    }
    catch (error) {
        next(error);
    }
});
adminRechargesRouter.post('/:id/:action', async (request, response, next) => {
    try {
        const action = z.enum(['approve', 'reject', 'review']).safeParse(request.params.action);
        const note = z.string().trim().max(1000).optional().safeParse(request.body?.note);
        if (!action.success || !note.success)
            return response.status(400).json({ success: false, message: 'Invalid review action.', code: 'VALIDATION_ERROR' });
        const outcome = await inTransaction(async (client) => runIdempotent(client, {
            userId: request.auth.userId,
            operation: `admin.recharge.${request.params.id}.${action.data}`,
            key: request.get('Idempotency-Key'),
            payload: { note: note.data ?? null },
        }, async () => {
            const rechargeResult = await client.query('SELECT * FROM recharge_requests WHERE id = $1 FOR UPDATE', [request.params.id]);
            const recharge = rechargeResult.rows[0];
            if (!recharge || !['PENDING', 'UNDER_REVIEW'].includes(recharge.status))
                throw Object.assign(new Error('This recharge has already been resolved.'), { status: 409, code: 'INVALID_STATUS' });
            if (action.data === 'review') {
                const row = await client.query("UPDATE recharge_requests SET status = 'UNDER_REVIEW', admin_note = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now() WHERE id = $1 RETURNING id, status", [recharge.id, note.data ?? null, request.auth.userId]);
                await client.query('INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)', [request.auth.userId, 'RECHARGE_REVIEW', 'recharge', recharge.id, { status: recharge.status }, { status: 'UNDER_REVIEW', note: note.data ?? null }]);
                return { status: 200, body: { success: true, data: row.rows[0] } };
            }
            if (action.data === 'reject') {
                if (!note.data)
                    throw Object.assign(new Error('Provide a reason for rejecting this recharge.'), { status: 400, code: 'REJECTION_NOTE_REQUIRED' });
                const row = await client.query("UPDATE recharge_requests SET status = 'REJECTED', admin_note = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now() WHERE id = $1 RETURNING id, status", [recharge.id, note.data, request.auth.userId]);
                await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Recharge rejected', $2, 'RECHARGE_REJECTED')", [recharge.user_id, note.data]);
                await client.query('INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)', [request.auth.userId, 'RECHARGE_REJECT', 'recharge', recharge.id, { status: recharge.status }, { status: 'REJECTED', note: note.data }]);
                return { status: 200, body: { success: true, data: row.rows[0] } };
            }
            const duplicate = await client.query("SELECT 1 FROM recharge_requests WHERE id <> $1 AND transaction_reference = $2 AND status = 'APPROVED'", [recharge.id, recharge.transaction_reference]);
            if (duplicate.rowCount)
                throw Object.assign(new Error('This payment reference has already been credited.'), { status: 409, code: 'DUPLICATE_PAYMENT' });
            await postWalletMovement(client, {
                userId: recharge.user_id,
                amount: recharge.amount,
                direction: 'CREDIT',
                transactionType: 'DEPOSIT',
                referenceId: recharge.id,
                referenceType: 'recharge',
                externalReference: recharge.transaction_reference,
                description: 'Approved manual recharge',
            });
            const referralSettings = await client.query("SELECT value #>> '{}' AS value FROM settings WHERE key = 'referral_rates'");
            let referralRates = { A: 22, B: 2, C: 1 };
            if (referralSettings.rows[0]?.value) {
                try {
                    const parsed = JSON.parse(referralSettings.rows[0].value);
                    referralRates = parsed && typeof parsed === 'object' ? parsed : referralRates;
                }
                catch {
                    referralRates = { A: 22, B: 2, C: 1 };
                }
            }
            const sponsorLevels = await fetchSponsorLevels(client, recharge.user_id);
            const referralCommissions = buildReferralCommissions({
                rechargeAmount: recharge.amount,
                sponsorLevels,
                rates: referralRates,
            });
            for (const commission of referralCommissions) {
                const movement = await postWalletMovement(client, {
                    userId: commission.userId,
                    amount: commission.amount,
                    direction: 'CREDIT',
                    transactionType: 'REFERRAL_COMMISSION',
                    referenceId: recharge.id,
                    referenceType: 'recharge',
                    externalReference: `${recharge.id}:${commission.level}:${commission.userId}`,
                    description: `Referral commission (${commission.level})`,
                });
                await client.query(`INSERT INTO referral_commissions(
                    recharge_id,
                    beneficiary_user_id,
                    referral_level,
                    rate,
                    amount,
                    wallet_ledger_id,
                    transaction_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
                    recharge.id,
                    commission.userId,
                    commission.level,
                    commission.rate,
                    commission.amount,
                    movement.ledgerId,
                    movement.transactionId,
                ]);
                await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, $2, $3, 'REFERRAL_COMMISSION')", [
                    commission.userId,
                    `Referral payout (${commission.level})`,
                    `${commission.amount} ETB was credited for your referral reward.`,
                ]);
            }
            const row = await client.query("UPDATE recharge_requests SET status = 'APPROVED', admin_note = $2, reviewed_by = $3, reviewed_at = now(), credited_at = now(), updated_at = now() WHERE id = $1 RETURNING id, status", [recharge.id, note.data ?? null, request.auth.userId]);
            await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Recharge approved', $2, 'RECHARGE_APPROVED')", [recharge.user_id, `${recharge.amount} ETB was added to your wallet.`]);
            await client.query('INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)', [request.auth.userId, 'RECHARGE_APPROVE', 'recharge', recharge.id, { status: recharge.status }, { status: 'APPROVED', amount: recharge.amount }]);
            return { status: 200, body: { success: true, data: row.rows[0] } };
        }));
        response.status(outcome.status).json(outcome.body);
    }
    catch (error) {
        next(error);
    }
});
rechargesRouter.use((error, _request, response, next) => {
    if (error instanceof multer.MulterError)
        return response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? 'Proof must be 5 MB or smaller.' : 'Invalid proof upload.', code: error.code });
    next(error);
});
