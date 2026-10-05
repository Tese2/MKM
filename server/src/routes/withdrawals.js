import argon2 from 'argon2';
import { Router } from 'express';
import { z } from 'zod';
import { runIdempotent } from '../db/idempotency.js';
import { inTransaction, pool } from '../db/pool.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { createUserRateLimit } from '../middleware/userRateLimit.js';
import { adjustLockedBalance, postWalletMovement } from '../services/wallet.js';
import { validateAccountNumber } from '../lib/bankValidation.js';
export const withdrawalsRouter = Router();
withdrawalsRouter.use(requireAuth);
withdrawalsRouter.get('/config', async (_request, response, next) => {
    try {
        const result = await pool.query("SELECT value #>> '{}' AS value FROM settings WHERE key = 'withdrawal_fee'");
        const parsed = Number(result.rows[0]?.value ?? 10);
        const withdrawalFee = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 10;
        response.json({ success: true, data: { withdrawalFee } });
    }
    catch (error) {
        next(error);
    }
});
export const adminWithdrawalsRouter = Router();
adminWithdrawalsRouter.use(requireAuth, requireAdmin);
const amountSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/, 'Enter a valid amount with up to two decimal places.');
const customerWithdrawalLimiter = createUserRateLimit({ limit: 20 });
withdrawalsRouter.post('/', customerWithdrawalLimiter, async (request, response, next) => {
    try {
        const parsed = z.object({ withdrawalAccountId: z.string().uuid(), amount: amountSchema, withdrawalPassword: z.string().min(1).max(128) }).safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the withdrawal details.', code: 'VALIDATION_ERROR' });
        const result = await inTransaction(async (client) => runIdempotent(client, {
            userId: request.auth.userId,
            operation: 'withdrawal.submit',
            key: request.get('Idempotency-Key'),
            payload: { withdrawalAccountId: parsed.data.withdrawalAccountId, amount: parsed.data.amount },
        }, async () => {
            const userResult = await client.query("SELECT withdrawal_password_hash FROM users WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE", [request.auth.userId]);
            if (!userResult.rowCount)
                throw Object.assign(new Error('This account cannot withdraw.'), { status: 403, code: 'ACCOUNT_INACTIVE' });
            if (!userResult.rows[0].withdrawal_password_hash)
                throw Object.assign(new Error('Set a withdrawal password in your profile before requesting a withdrawal.'), { status: 409, code: 'WITHDRAWAL_PASSWORD_REQUIRED' });
            if (!await argon2.verify(userResult.rows[0].withdrawal_password_hash, parsed.data.withdrawalPassword))
                throw Object.assign(new Error('Withdrawal password is incorrect.'), { status: 400, code: 'INVALID_WITHDRAWAL_PASSWORD' });
            const active = await client.query("SELECT id FROM withdrawals WHERE user_id = $1 AND status IN ('PENDING', 'PROCESSING') FOR UPDATE", [request.auth.userId]);
            if (active.rowCount)
                throw Object.assign(new Error('You already have a pending withdrawal.'), { status: 409, code: 'WITHDRAWAL_PENDING' });
            const todayWithdrawal = await client.query(
                `SELECT 1 FROM withdrawals
                 WHERE user_id = $1
                   AND created_at >= (
                       date_trunc('day', now() AT TIME ZONE 'Africa/Addis_Ababa')
                       AT TIME ZONE 'Africa/Addis_Ababa'
                   )
                   AND created_at < (
                       (date_trunc('day', now() AT TIME ZONE 'Africa/Addis_Ababa') + interval '1 day')
                       AT TIME ZONE 'Africa/Addis_Ababa'
                   )
                 LIMIT 1`,
                [request.auth.userId],
            );
            if (todayWithdrawal.rowCount)
                throw Object.assign(new Error('You can submit only one withdrawal per calendar day (Ethiopia time).'), { status: 429, code: 'WITHDRAWAL_COOLDOWN' });
            const productCheck = await client.query("SELECT 1 FROM product_purchases WHERE user_id = $1 AND status IN ('ACTIVE', 'COMPLETED') LIMIT 1", [request.auth.userId]);
            if (!productCheck.rowCount)
                throw Object.assign(new Error('You must purchase at least one product before requesting a withdrawal.'), { status: 400, code: 'PRODUCT_PURCHASE_REQUIRED' });
            const rechargeCheck = await client.query("SELECT coalesce(sum(amount), 0) AS total_recharge FROM recharge_requests WHERE user_id = $1 AND status = 'APPROVED'", [request.auth.userId]);
            if (Number(rechargeCheck.rows[0].total_recharge) < 300)
                throw Object.assign(new Error('You must have an approved recharge of at least 300 ETB before requesting a withdrawal.'), { status: 400, code: 'RECHARGE_REQUIRED' });
            const account = await client.query(`SELECT a.*, p.name AS payment_provider FROM withdrawal_accounts a
         JOIN payment_methods p ON p.id = a.payment_method_id AND p.is_active = true
         WHERE a.id = $1 AND a.user_id = $2 FOR UPDATE OF a`, [parsed.data.withdrawalAccountId, request.auth.userId]);
            if (!account.rowCount)
                throw Object.assign(new Error('Select an active saved withdrawal account.'), { status: 400, code: 'ACCOUNT_NOT_FOUND' });
            if (!validateAccountNumber(account.rows[0].payment_provider, account.rows[0].account_number))
                throw Object.assign(new Error('The saved withdrawal account is no longer valid.'), { status: 400, code: 'INVALID_ACCOUNT_NUMBER' });
            const settings = await client.query("SELECT key, value #>> '{}' AS value FROM settings WHERE key = ANY($1::text[])", [['minimum_withdrawal_balance', 'maximum_withdrawal', 'withdrawal_fee']]);
            const limits = Object.fromEntries(settings.rows.map((row) => [row.key, row.value]));
            const walletResult = await client.query('SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE', [request.auth.userId]);
            if (!walletResult.rowCount)
                throw Object.assign(new Error('Wallet not found.'), { status: 409, code: 'WALLET_NOT_FOUND' });
              const balanceCheck = await client.query(`SELECT available_balance >= $1::numeric AS meets_minimum,
                  $2::numeric >= $1::numeric AS amount_meets_minimum,
                  available_balance >= $2::numeric AS can_fund,
                  $2::numeric <= $3::numeric AS under_maximum
         FROM wallets WHERE id = $4`, [limits.minimum_withdrawal_balance ?? '70', parsed.data.amount, limits.maximum_withdrawal ?? '1000000', walletResult.rows[0].id]);
            if (!balanceCheck.rows[0].meets_minimum)
                throw Object.assign(new Error('Your available balance is below the minimum withdrawal balance.'), { status: 400, code: 'MINIMUM_BALANCE' });
                    if (!balanceCheck.rows[0].amount_meets_minimum)
                         throw Object.assign(new Error(`The minimum withdrawal amount is ${limits.minimum_withdrawal_balance ?? '70'} ETB.`), { status: 400, code: 'MINIMUM_WITHDRAWAL' });
            if (!balanceCheck.rows[0].can_fund || !balanceCheck.rows[0].under_maximum)
                throw Object.assign(new Error('Withdrawal amount is outside the allowed limits.'), { status: 400, code: 'WITHDRAWAL_LIMIT' });
            const feeRate = limits.withdrawal_fee ?? '10';
            const withdrawalAmounts = await client.query(`SELECT round($1::numeric * $2::numeric / 100, 2)::text AS fee,
              ($1::numeric - round($1::numeric * $2::numeric / 100, 2))::text AS "netAmount"`,
            [parsed.data.amount, feeRate]);
            const fee = withdrawalAmounts.rows[0].fee;
            const netAmount = withdrawalAmounts.rows[0].netAmount;
            const inserted = await client.query(`INSERT INTO withdrawals(user_id, withdrawal_account_id, account_holder_name_snapshot, payment_method_snapshot,
          account_number_snapshot, phone_number_snapshot, amount, fee, net_amount, withdrawal_password_verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
         RETURNING id, amount::text, fee::text, net_amount::text, status, created_at`, [request.auth.userId, account.rows[0].id, account.rows[0].account_holder_name, account.rows[0].payment_provider,
                account.rows[0].account_number, account.rows[0].phone_number, parsed.data.amount, fee, netAmount]);
            const row = inserted.rows[0];
            await postWalletMovement(client, {
                userId: request.auth.userId,
                walletId: walletResult.rows[0].id,
                amount: row.amount,
                direction: 'DEBIT',
                lockedDirection: 'CREDIT',
                insufficientBalanceCode: 'BALANCE_CHANGED',
                insufficientBalanceMessage: 'Your available balance changed. Refresh and try again.',
                transactionType: 'WITHDRAWAL',
                referenceId: row.id,
                referenceType: 'withdrawal',
                description: 'Withdrawal funds reserved',
                ledgerStatus: 'PENDING',
                transactionStatus: 'PENDING',
            });
            await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Withdrawal requested', $2, 'WITHDRAWAL_SUBMITTED')", [request.auth.userId, `Your ${row.amount} ETB withdrawal is pending.`]);
            return { status: 201, body: { success: true, data: row } };
        }));
        response.status(result.status).json(result.body);
    }
    catch (error) {
        next(error);
    }
});
withdrawalsRouter.get('/', async (request, response, next) => {
    try {
        const result = await pool.query(`SELECT id, created_at AS "createdAt", amount::text, fee::text, net_amount AS "netAmount",
        payment_method_snapshot AS "paymentMethod", account_number_snapshot AS "accountNumber", status,
        admin_note AS "adminNote", processed_at AS "processedAt"
       FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [request.auth.userId]);
        response.json({ success: true, data: result.rows.map((row) => ({ ...row, accountNumber: maskAccount(row.accountNumber) })) });
    }
    catch (error) {
        next(error);
    }
});
withdrawalsRouter.post('/:id/cancel', async (request, response, next) => {
    try {
        const result = await inTransaction(async (client) => runIdempotent(client, {
            userId: request.auth.userId,
            operation: `withdrawal.cancel.${request.params.id}`,
            key: request.get('Idempotency-Key'),
            payload: { withdrawalId: request.params.id },
        }, async () => {
            const withdrawal = await client.query("SELECT * FROM withdrawals WHERE id = $1 AND user_id = $2 FOR UPDATE", [request.params.id, request.auth.userId]);
            if (!withdrawal.rowCount || withdrawal.rows[0].status !== 'PENDING')
                throw Object.assign(new Error('This withdrawal cannot be cancelled.'), { status: 409, code: 'INVALID_STATUS' });
            const row = withdrawal.rows[0];
            await client.query("UPDATE withdrawals SET status = 'CANCELLED', updated_at = now() WHERE id = $1", [row.id]);
            await client.query("UPDATE wallet_ledger SET status = 'REVERSED' WHERE reference_id = $1 AND transaction_type = 'WITHDRAWAL'", [row.id]);
            await addRefund(client, request.auth.userId, row.id, row.amount, 'Withdrawal cancelled');
            await client.query("UPDATE transactions SET status = 'CANCELLED', updated_at = now() WHERE reference_type = 'withdrawal' AND reference_id = $1", [row.id]);
            await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Withdrawal cancelled', 'Reserved funds were returned to your available balance.', 'WITHDRAWAL_CANCELLED')", [request.auth.userId]);
            return { status: 200, body: { success: true, data: { id: row.id, status: 'CANCELLED' } } };
        }));
        response.status(result.status).json(result.body);
    }
    catch (error) {
        next(error);
    }
});
adminWithdrawalsRouter.get('/', async (request, response, next) => {
    try {
        const parsed = z.object({
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().refine((value) => [5, 10, 25, 50, 100].includes(value)).default(25),
            status: z.enum(['PENDING', 'PROCESSING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED']).optional(),
            search: z.string().trim().max(100).optional(),
        }).safeParse(request.query);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: 'Invalid withdrawal filters.', code: 'VALIDATION_ERROR' });
        const { page, limit, status, search } = parsed.data;
        const values = [];
        const conditions = [];
        const bind = (value) => { values.push(value); return `$${values.length}`; };
        if (status) conditions.push(`w.status = ${bind(status)}`);
        if (search) {
            const match = bind(`%${search}%`);
            conditions.push(`(u.full_name ILIKE ${match} OR u.phone_number::text ILIKE ${match} OR w.account_number_snapshot ILIKE ${match} OR w.account_holder_name_snapshot ILIKE ${match})`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const count = await pool.query(`SELECT count(*)::int AS total FROM withdrawals w JOIN users u ON u.id = w.user_id ${where}`, values);
        const limitBind = bind(limit);
        const offsetBind = bind((page - 1) * limit);
        const result = await pool.query(`SELECT w.id, w.user_id AS "userId", u.full_name AS "fullName", u.phone_number AS "phoneNumber",
        w.amount::text, w.fee::text, w.net_amount::text AS "netAmount", w.payment_method_snapshot AS "paymentMethod",
        w.account_holder_name_snapshot AS "accountHolderName", w.account_number_snapshot AS "accountNumber",
        w.phone_number_snapshot AS "accountPhone", w.status, w.admin_note AS "adminNote", w.created_at AS "createdAt", w.processed_at AS "processedAt"
        FROM withdrawals w JOIN users u ON u.id = w.user_id
        ${where} ORDER BY CASE WHEN w.status IN ('PENDING', 'PROCESSING') THEN 0 ELSE 1 END, w.created_at DESC
        LIMIT ${limitBind} OFFSET ${offsetBind}`, values);
        response.json({ success: true, data: {
            items: result.rows.map((row) => ({ ...row, phoneNumber: String(row.phoneNumber).trim() })),
            pagination: { page, limit, total: count.rows[0].total, pages: Math.ceil(count.rows[0].total / limit) },
        } });
    }
    catch (error) {
        next(error);
    }
});
adminWithdrawalsRouter.post('/:id/:action', async (request, response, next) => {
    try {
        const action = z.enum(['process', 'approve', 'complete', 'reject']).safeParse(request.params.action);
        const note = z.string().trim().max(1000).optional().safeParse(request.body?.note);
        if (!action.success || !note.success)
            return response.status(400).json({ success: false, message: 'Invalid withdrawal action.', code: 'VALIDATION_ERROR' });
        const result = await inTransaction(async (client) => runIdempotent(client, {
            userId: request.auth.userId,
            operation: `admin.withdrawal.${request.params.id}.${action.data}`,
            key: request.get('Idempotency-Key'),
            payload: { note: note.data ?? null },
        }, async () => {
            const selected = await client.query('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [request.params.id]);
            if (!selected.rowCount)
                throw Object.assign(new Error('Withdrawal not found.'), { status: 404, code: 'NOT_FOUND' });
            const withdrawal = selected.rows[0];
            if (action.data === 'process' || action.data === 'approve') {
                if (withdrawal.status !== 'PENDING')
                    throw Object.assign(new Error('Only pending withdrawals can be processed.'), { status: 409, code: 'INVALID_STATUS' });
                const updated = await client.query("UPDATE withdrawals SET status = 'PROCESSING', processed_by = $2, processed_at = now(), admin_note = $3, updated_at = now() WHERE id = $1 RETURNING id, status", [withdrawal.id, request.auth.userId, note.data ?? null]);
                await client.query("UPDATE transactions SET status = 'PROCESSING', updated_at = now() WHERE reference_type = 'withdrawal' AND reference_id = $1", [withdrawal.id]);
                await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Withdrawal processing', 'Your withdrawal is being processed.', 'WITHDRAWAL_PROCESSING')", [withdrawal.user_id]);
                await audit(client, request.auth.userId, withdrawal, updated.rows[0].status, note.data);
                return { status: 200, body: { success: true, data: updated.rows[0] } };
            }
            if (action.data === 'complete') {
                if (!['PENDING', 'PROCESSING'].includes(withdrawal.status))
                    throw Object.assign(new Error('Only a pending or processing withdrawal can be completed.'), { status: 409, code: 'INVALID_STATUS' });
                await adjustLockedBalance(client, { userId: withdrawal.user_id, amount: String(withdrawal.amount), direction: 'DEBIT' });
                const updated = await client.query("UPDATE withdrawals SET status = 'COMPLETED', processed_by = $2, processed_at = now(), admin_note = $3, updated_at = now() WHERE id = $1 RETURNING id, status", [withdrawal.id, request.auth.userId, note.data ?? withdrawal.admin_note]);
                await client.query("UPDATE wallet_ledger SET status = 'COMPLETED' WHERE reference_id = $1 AND transaction_type = 'WITHDRAWAL'", [withdrawal.id]);
                await client.query("UPDATE transactions SET status = 'COMPLETED', updated_at = now() WHERE reference_type = 'withdrawal' AND reference_id = $1", [withdrawal.id]);
                await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Withdrawal completed', $2, 'WITHDRAWAL_COMPLETED')", [withdrawal.user_id, `${withdrawal.net_amount} ETB was paid to your withdrawal account.`]);
                await audit(client, request.auth.userId, withdrawal, 'COMPLETED', note.data);
                return { status: 200, body: { success: true, data: updated.rows[0] } };
            }
            if (!['PENDING', 'PROCESSING'].includes(withdrawal.status))
                throw Object.assign(new Error('This withdrawal has already been resolved.'), { status: 409, code: 'INVALID_STATUS' });
            if (!note.data)
                throw Object.assign(new Error('Provide a reason for rejecting this withdrawal.'), { status: 400, code: 'REJECTION_NOTE_REQUIRED' });
            const updated = await client.query("UPDATE withdrawals SET status = 'REJECTED', processed_by = $2, processed_at = now(), admin_note = $3, updated_at = now() WHERE id = $1 RETURNING id, status", [withdrawal.id, request.auth.userId, note.data]);
            await client.query("UPDATE wallet_ledger SET status = 'REVERSED' WHERE reference_id = $1 AND transaction_type = 'WITHDRAWAL'", [withdrawal.id]);
            await addRefund(client, withdrawal.user_id, withdrawal.id, withdrawal.amount, 'Withdrawal rejected');
            await client.query("UPDATE transactions SET status = 'REJECTED', updated_at = now() WHERE reference_type = 'withdrawal' AND reference_id = $1", [withdrawal.id]);
            await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Withdrawal rejected', $2, 'WITHDRAWAL_REJECTED')", [withdrawal.user_id, note.data]);
            await audit(client, request.auth.userId, withdrawal, 'REJECTED', note.data);
            return { status: 200, body: { success: true, data: updated.rows[0] } };
        }));
        response.status(result.status).json(result.body);
    }
    catch (error) {
        next(error);
    }
});
async function addRefund(client, userId, referenceId, amount, description) {
    return postWalletMovement(client, {
        userId,
        amount: String(amount),
        direction: 'CREDIT',
        lockedDirection: 'DEBIT',
        transactionType: 'REFUND',
        referenceId,
        referenceType: 'withdrawal',
        description,
    });
}
async function audit(client, adminId, withdrawal, status, note) {
    await client.query('INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)', [adminId, `WITHDRAWAL_${status}`, 'withdrawal', withdrawal.id, { status: withdrawal.status }, { status, note: note ?? null }]);
}
function maskAccount(account) { return account.length <= 4 ? '****' : `${'*'.repeat(Math.max(4, account.length - 4))}${account.slice(-4)}`; }
