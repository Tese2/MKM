import { Router } from 'express';
import { z } from 'zod';
import { inTransaction, pool } from '../db/pool.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { createUserRateLimit } from '../middleware/userRateLimit.js';
import { getMilestoneRewardStatus, summarizeRewardData, summarizeTaskData } from '../lib/rewardMetrics.js';
import { postWalletMovement } from '../services/wallet.js';
import { claimDailyTask, processEligibleTasksForUser } from '../services/dailyTaskProcessor.js';
import { getReferredRechargeTotal } from '../services/rewardEligibility.js';

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth);
transactionsRouter.get('/', async (request, response, next) => {
    try {
        const query = z.object({
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(25),
            search: z.string().trim().max(100).optional(),
            type: z.string().trim().max(40).optional(),
            status: z.string().trim().max(40).optional(),
            startDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
            endDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
        }).safeParse(request.query);
        if (!query.success)
            return response.status(400).json({ success: false, message: 'Invalid query parameters.', code: 'VALIDATION_ERROR' });

        const { page, limit, search, type, status, startDate, endDate } = query.data;
        const values = [request.auth.userId];
        const clauses = ['user_id = $1'];

        if (search) {
            values.push(`%${search}%`);
            clauses.push(`(description ILIKE $${values.length} OR external_reference ILIKE $${values.length})`);
        }
        if (type) {
            values.push(type.toUpperCase());
            clauses.push(`type = $${values.length}`);
        }
        if (status) {
            values.push(status.toUpperCase());
            clauses.push(`status = $${values.length}`);
        }
        if (startDate) {
            values.push(startDate);
            clauses.push(`created_at >= $${values.length}::timestamptz`);
        }
        if (endDate) {
            values.push(endDate);
            clauses.push(`created_at <= ($${values.length}::date + INTERVAL '1 day')::timestamptz`);
        }

        const whereSql = clauses.join(' AND ');
        const offset = (page - 1) * limit;
        values.push(limit, offset);

        const result = await pool.query(`SELECT id, type, amount::text, direction, status, reference_type AS "referenceType",
          reference_id AS "referenceId", external_reference AS "externalReference", description, created_at AS "createdAt",
          count(*) OVER()::int AS "totalCount"
        FROM transactions WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values);
        const total = result.rows[0]?.totalCount ?? 0;
        response.json({ success: true, data: { items: result.rows.map(({ totalCount, ...item }) => item), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
    }
    catch (error) { next(error); }
});

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.get('/unread-count', async (request, response, next) => {
    try {
        const result = await pool.query(
            'SELECT count(*)::int AS "unreadCount" FROM notifications WHERE user_id=$1 AND is_read=false',
            [request.auth.userId],
        );
        response.json({ success: true, data: result.rows[0] });
    }
    catch (error) { next(error); }
});
notificationsRouter.get('/', async (request, response, next) => {
    try {
        const query = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).safeParse(request.query);
        if (!query.success)
            return response.status(400).json({ success: false, message: 'Invalid pagination.', code: 'VALIDATION_ERROR' });
        const { page, limit } = query.data;
        const result = await pool.query(`SELECT id,title,message,type,is_read AS "isRead",created_at AS "createdAt",
          count(*) OVER()::int AS "totalCount"
        FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
        [request.auth.userId, limit, (page - 1) * limit]);
        const total = result.rows[0]?.totalCount ?? 0;
        response.json({ success: true, data: { items: result.rows.map(({ totalCount, ...item }) => item), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
    }
    catch (error) { next(error); }
});

notificationsRouter.patch('/:notificationId/read', async (request, response, next) => {
    try {
        const id = z.string().uuid().safeParse(request.params.notificationId);
        if (!id.success)
            return response.status(400).json({ success: false, message: 'Invalid notification.', code: 'VALIDATION_ERROR' });
        const result = await pool.query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2 RETURNING id,is_read AS "isRead"', [id.data, request.auth.userId]);
        if (!result.rowCount)
            return response.status(404).json({ success: false, message: 'Notification not found.', code: 'NOT_FOUND' });
        response.json({ success: true, data: result.rows[0] });
    }
    catch (error) { next(error); }
});

export const tasksRouter = Router();
tasksRouter.use(requireAuth);
tasksRouter.get('/', async (request, response, next) => {
    try {
        const autoCreditedTasks = await processEligibleTasksForUser(request.auth.userId);
        const result = await pool.query(`SELECT dtr.id, dtr.business_date AS "businessDate", dtr.status, dtr.calculated_amount::text AS "calculatedAmount",
            p.name AS "productName",
            pp.id AS "productPurchaseId",
            (pp.activated_at + ((dtr.business_date - pp.activated_at::date) + 1) * INTERVAL '24 hours') AS "eligibleAt",
            count(*) OVER()::int AS "totalCount"
        FROM daily_task_records dtr
        INNER JOIN product_purchases pp ON pp.id = dtr.product_purchase_id
        INNER JOIN products p ON p.id = pp.product_id
        WHERE dtr.user_id = $1
        ORDER BY dtr.business_date DESC, p.name ASC, dtr.created_at DESC`, [request.auth.userId]);

        const items = result.rows.map(({ totalCount, ...item }) => item);
        response.json({ success: true, data: { items, summary: summarizeTaskData(items), autoCredited: autoCreditedTasks.length > 0 } });
    }
    catch (error) { next(error); }
});

const taskClaimLimiter = createUserRateLimit({ limit: 30 });
tasksRouter.post('/:taskId/claim', taskClaimLimiter, async (request, response, next) => {
    try {
        const taskId = z.string().uuid().safeParse(request.params.taskId);
        if (!taskId.success)
            return response.status(400).json({ success: false, message: 'Invalid task.', code: 'VALIDATION_ERROR' });

        const result = await inTransaction((client) =>
            claimDailyTask(client, { taskId: taskId.data, userId: request.auth.userId }),
        );

        response.json({ success: true, data: result });
    }
    catch (error) { next(error); }
});

export const rewardsRouter = Router();
rewardsRouter.use(requireAuth);
const rewardClaimLimiter = createUserRateLimit({ limit: 20 });
rewardsRouter.get('/', async (request, response, next) => {
    try {
        const qualifyingRechargeTotal = await getReferredRechargeTotal(pool, request.auth.userId);
        const result = await pool.query(`SELECT rr.id, rr.name, rr.rule_type AS "ruleType", rr.threshold_amount::text AS "thresholdAmount",
            rr.reward_amount::text AS "rewardAmount", rr.status, rc.id AS "claimId", rc.status AS "claimStatus",
            rc.amount::text AS amount, rc.created_at AS "createdAt"
        FROM reward_rules rr
        LEFT JOIN reward_claims rc ON rc.reward_rule_id = rr.id AND rc.user_id = $1
        WHERE rr.status = 'ACTIVE'
        ORDER BY rr.created_at DESC`, [request.auth.userId]);

        const items = result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            ruleType: row.ruleType,
            thresholdAmount: row.thresholdAmount,
            rewardAmount: row.rewardAmount,
            status: getMilestoneRewardStatus({
                ruleStatus: row.status,
                ruleType: row.ruleType,
                claimStatus: row.claimStatus,
                qualifyingRechargeAmount: qualifyingRechargeTotal,
                thresholdAmount: row.thresholdAmount,
            }),
            amount: row.amount ?? row.rewardAmount ?? '0.00',
            createdAt: row.createdAt,
            claimId: row.claimId,
            qualifyingRechargeAmount: qualifyingRechargeTotal,
            ruleStatus: row.status,
        }));

        response.json({ success: true, data: {
            items,
            summary: summarizeRewardData(items),
            qualifyingRechargeAmount: qualifyingRechargeTotal,
        } });
    }
    catch (error) { next(error); }
});
rewardsRouter.post('/:ruleId/claim', rewardClaimLimiter, async (request, response, next) => {
    try {
        const ruleId = z.string().uuid().safeParse(request.params.ruleId);
        if (!ruleId.success)
            return response.status(400).json({ success: false, message: 'Invalid reward rule.', code: 'VALIDATION_ERROR' });

        const claim = await inTransaction(async (client) => {
            const rule = await client.query("SELECT id, name, rule_type, threshold_amount, reward_amount FROM reward_rules WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE", [ruleId.data]);
            if (!rule.rowCount)
                throw Object.assign(new Error('This reward is not currently available.'), { status: 404, code: 'REWARD_NOT_FOUND' });
            const selectedRule = rule.rows[0];
            if (selectedRule.rule_type !== 'MILESTONE')
                throw Object.assign(new Error('This reward type is not claimable yet.'), { status: 409, code: 'REWARD_NOT_CLAIMABLE' });

            const existing = await client.query('SELECT id, status FROM reward_claims WHERE user_id = $1 AND reward_rule_id = $2 FOR UPDATE', [request.auth.userId, ruleId.data]);
            if (existing.rowCount)
                throw Object.assign(new Error('This reward has already been claimed or resolved.'), { status: 409, code: 'REWARD_ALREADY_CLAIMED' });

            const qualifyingRechargeTotal = await getReferredRechargeTotal(client, request.auth.userId);
            if (Number(qualifyingRechargeTotal) < Number(selectedRule.threshold_amount))
                throw Object.assign(new Error("Your invited friends' approved recharges have not reached this reward threshold."), { status: 409, code: 'REWARD_THRESHOLD_NOT_MET' });

            const inserted = await client.query(`INSERT INTO reward_claims(user_id, reward_rule_id, amount, status, requested_at)
              VALUES ($1, $2, $3, 'PENDING', now())
              RETURNING id, status, amount::text AS amount, created_at AS "createdAt"`,
            [request.auth.userId, selectedRule.id, selectedRule.reward_amount]);
            await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Reward claim submitted', $2, 'REWARD_CLAIM_SUBMITTED')",
                [request.auth.userId, `Your ${selectedRule.name} claim is waiting for admin approval.`]);
            return inserted.rows[0];
        });
        response.status(201).json({ success: true, data: claim });
    }
    catch (error) { next(error); }
});

export const adminTasksRouter = Router();
adminTasksRouter.use(requireAuth, requireAdmin);
adminTasksRouter.get('/', async (_request, response, next) => {
    try {
        const result = await pool.query(`SELECT dtr.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber", p.name AS "productName",
            dtr.business_date AS "businessDate", dtr.status, dtr.calculated_amount::text AS "calculatedAmount"
        FROM daily_task_records dtr
        INNER JOIN users u ON u.id = dtr.user_id
        INNER JOIN product_purchases pp ON pp.id = dtr.product_purchase_id
        INNER JOIN products p ON p.id = pp.product_id
        ORDER BY dtr.business_date DESC, dtr.created_at DESC LIMIT 100`);
        response.json({ success: true, data: result.rows });
    }
    catch (error) { next(error); }
});

export const adminRewardsRouter = Router();
adminRewardsRouter.use(requireAuth, requireAdmin);
adminRewardsRouter.get('/', async (_request, response, next) => {
    try {
        const result = await pool.query(`SELECT rc.id, rc.user_id AS "userId", u.full_name AS "fullName", u.phone_number AS "phoneNumber",
            rr.name, rr.rule_type AS "ruleType", rr.threshold_amount::text AS "thresholdAmount",
            rc.amount::text AS amount, rc.status, rc.admin_note AS "adminNote",
            rc.created_at AS "createdAt", rc.requested_at AS "requestedAt", rc.reviewed_at AS "reviewedAt", rc.paid_at AS "paidAt"
        FROM reward_claims rc
        INNER JOIN users u ON u.id = rc.user_id
        INNER JOIN reward_rules rr ON rr.id = rc.reward_rule_id
        ORDER BY rc.created_at DESC LIMIT 250`);
        response.json({ success: true, data: result.rows });
    }
    catch (error) { next(error); }
});
adminRewardsRouter.get('/rules', async (_request, response, next) => {
    try {
        const result = await pool.query(`SELECT id, name, rule_type AS "ruleType", threshold_amount::text AS "thresholdAmount",
          reward_amount::text AS "rewardAmount", frequency, status FROM reward_rules ORDER BY threshold_amount, created_at`);
        response.json({ success: true, data: result.rows });
    }
    catch (error) { next(error); }
});
const rewardRuleSchema = z.object({
    name: z.string().trim().min(2).max(120),
    ruleType: z.enum(['MILESTONE', 'DAILY', 'WEEKLY']),
    thresholdAmount: z.coerce.number().min(0).max(1000000000)
        .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001, 'Use no more than two decimal places.'),
    rewardAmount: z.coerce.number().positive().max(1000000000)
        .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001, 'Use no more than two decimal places.'),
    frequency: z.enum(['ONCE', 'DAILY', 'WEEKLY']),
    status: z.enum(['ACTIVE', 'DISABLED']),
});
adminRewardsRouter.post('/rules', async (request, response, next) => {
    try {
        const parsed = rewardRuleSchema.safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the reward rule.', code: 'VALIDATION_ERROR' });
        const rule = parsed.data;
        const result = await inTransaction(async (client) => {
            const inserted = await client.query(`INSERT INTO reward_rules(name, rule_type, threshold_amount, reward_amount, frequency, status)
              VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [rule.name, rule.ruleType, rule.thresholdAmount, rule.rewardAmount, rule.frequency, rule.status]);
            await client.query('INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
                [request.auth.userId, 'REWARD_RULE_CREATE', 'reward_rule', inserted.rows[0].id, null, rule]);
            return inserted.rows[0];
        });
        response.status(201).json({ success: true, data: { id: result.id, ...rule } });
    }
    catch (error) { next(error); }
});
adminRewardsRouter.patch('/rules/:ruleId', async (request, response, next) => {
    try {
        const ruleId = z.string().uuid().safeParse(request.params.ruleId);
        const parsed = rewardRuleSchema.safeParse(request.body);
        if (!ruleId.success || !parsed.success)
            return response.status(400).json({ success: false, message: parsed.success ? 'Invalid reward rule.' : parsed.error.issues[0]?.message ?? 'Check the reward rule.', code: 'VALIDATION_ERROR' });
        const rule = await inTransaction(async (client) => {
            const existing = await client.query('SELECT * FROM reward_rules WHERE id = $1 FOR UPDATE', [ruleId.data]);
            if (!existing.rowCount)
                throw Object.assign(new Error('Reward rule not found.'), { status: 404, code: 'NOT_FOUND' });
            const updated = await client.query(`UPDATE reward_rules SET name = $2, rule_type = $3, threshold_amount = $4,
              reward_amount = $5, frequency = $6, status = $7, updated_at = now()
              WHERE id = $1 RETURNING id`, [ruleId.data, parsed.data.name, parsed.data.ruleType, parsed.data.thresholdAmount,
                parsed.data.rewardAmount, parsed.data.frequency, parsed.data.status]);
            await client.query('INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
                [request.auth.userId, 'REWARD_RULE_UPDATE', 'reward_rule', ruleId.data, existing.rows[0], parsed.data]);
            return updated.rows[0];
        });
        response.json({ success: true, data: { id: rule.id, ...parsed.data } });
    }
    catch (error) { next(error); }
});
adminRewardsRouter.post('/:claimId/:action', async (request, response, next) => {
    try {
        const claimId = z.string().uuid().safeParse(request.params.claimId);
        const action = z.enum(['approve', 'reject', 'paid']).safeParse(request.params.action);
        const note = z.string().trim().max(500).optional().safeParse(request.body?.note);
        if (!claimId.success || !action.success || !note.success)
            return response.status(400).json({ success: false, message: 'Invalid reward action.', code: 'VALIDATION_ERROR' });
        if (action.data === 'reject' && !note.data)
            return response.status(400).json({ success: false, message: 'Provide a reason for rejecting this reward claim.', code: 'REJECTION_NOTE_REQUIRED' });
        const updated = await inTransaction(async (client) => {
            const selected = await client.query(`SELECT rc.*, rr.name FROM reward_claims rc
              JOIN reward_rules rr ON rr.id = rc.reward_rule_id WHERE rc.id = $1 FOR UPDATE OF rc`, [claimId.data]);
            if (!selected.rowCount)
                throw Object.assign(new Error('Reward claim not found.'), { status: 404, code: 'NOT_FOUND' });
            const claim = selected.rows[0];
            if (action.data === 'approve' || action.data === 'reject') {
                if (claim.status !== 'PENDING')
                    throw Object.assign(new Error('Only pending reward claims can be approved or rejected.'), { status: 409, code: 'INVALID_STATUS' });
                const status = action.data === 'approve' ? 'APPROVED' : 'REJECTED';
                await client.query(`UPDATE reward_claims SET status = $2, reviewed_at = now(), reviewed_by = $3, admin_note = $4 WHERE id = $1`,
                    [claim.id, status, request.auth.userId, note.data ?? null]);
                if (status === 'APPROVED') {
                    await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Reward claim approved', $2, 'REWARD_APPROVED')",
                        [claim.user_id, `Your ${claim.name} claim was approved and is awaiting payment.`]);
                } else {
                    await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Reward claim rejected', $2, 'REWARD_REJECTED')",
                        [claim.user_id, note.data]);
                }
                await client.query('INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
                    [request.auth.userId, `REWARD_${status}`, 'reward_claim', claim.id, { status: claim.status }, { status, note: note.data ?? null }]);
                return { id: claim.id, status };
            }
            if (claim.status !== 'APPROVED')
                throw Object.assign(new Error('Only approved reward claims can be marked paid.'), { status: 409, code: 'INVALID_STATUS' });
            const movement = await postWalletMovement(client, {
                userId: claim.user_id,
                amount: String(claim.amount),
                direction: 'CREDIT',
                transactionType: 'MILESTONE_REWARD',
                referenceId: claim.id,
                referenceType: 'reward_claim',
                description: `${claim.name} reward paid`,
            });
            await client.query("UPDATE reward_claims SET status = 'PAID', paid_at = now(), reviewed_by = $2 WHERE id = $1", [claim.id, request.auth.userId]);
            await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Reward paid', $2, 'REWARD_PAID')",
                [claim.user_id, `${claim.amount} ETB for ${claim.name} was added to your wallet.`]);
            await client.query('INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
                [request.auth.userId, 'REWARD_PAID', 'reward_claim', claim.id, { status: claim.status }, { status: 'PAID', amount: claim.amount }]);
            return { id: claim.id, status: 'PAID', availableBalance: movement.availableBalance };
        });
        response.json({ success: true, data: updated });
    }
    catch (error) { next(error); }
});