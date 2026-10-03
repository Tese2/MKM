import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { summarizeRewardData, summarizeTaskData } from '../lib/rewardMetrics.js';

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
        const result = await pool.query(`SELECT dtr.id, dtr.business_date AS "businessDate", dtr.status, dtr.calculated_amount::text AS "calculatedAmount",
            dtr.base_amount::text AS "baseAmount", dtr.configured_rate::text AS "configuredRate",
            p.name AS "productName", count(*) OVER()::int AS "totalCount"
        FROM daily_task_records dtr
        INNER JOIN product_purchases pp ON pp.id = dtr.product_purchase_id
        INNER JOIN products p ON p.id = pp.product_id
        WHERE dtr.user_id = $1
        ORDER BY dtr.business_date DESC, dtr.created_at DESC LIMIT 30`, [request.auth.userId]);

        const items = result.rows.map(({ totalCount, ...item }) => item);
        response.json({ success: true, data: { items, summary: summarizeTaskData(items) } });
    }
    catch (error) { next(error); }
});

export const rewardsRouter = Router();
rewardsRouter.use(requireAuth);
rewardsRouter.get('/', async (request, response, next) => {
    try {
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
            status: row.claimStatus ?? 'CLAIMABLE',
            amount: row.amount ?? row.rewardAmount ?? '0.00',
            createdAt: row.createdAt,
            claimId: row.claimId,
        }));

        response.json({ success: true, data: { items, summary: summarizeRewardData(items) } });
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
        const result = await pool.query(`SELECT rc.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber",
            rr.name, rr.rule_type AS "ruleType", rc.amount::text AS amount, rc.status, rc.created_at AS "createdAt"
        FROM reward_claims rc
        INNER JOIN users u ON u.id = rc.user_id
        INNER JOIN reward_rules rr ON rr.id = rc.reward_rule_id
        ORDER BY rc.created_at DESC LIMIT 100`);
        response.json({ success: true, data: result.rows });
    }
    catch (error) { next(error); }
});