import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
export const referralsRouter = Router();
referralsRouter.use(requireAuth);
export const adminReferralsRouter = Router();
adminReferralsRouter.use(requireAuth, requireAdmin);
export function buildReferralLink(code) {
    const base = (process.env.CLIENT_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    return `${base}/register?ref=${encodeURIComponent(code)}`;
}
const treeCte = `WITH RECURSIVE team(user_id, depth, path) AS (
  SELECT referred_user_id, 1, ARRAY[$1::uuid, referred_user_id] FROM referrals
  WHERE referrer_id = $1 AND status = 'ACTIVE'
  UNION ALL
  SELECT r.referred_user_id, t.depth + 1, t.path || r.referred_user_id
  FROM referrals r JOIN team t ON r.referrer_id = t.user_id
  WHERE t.depth < 3 AND r.status = 'ACTIVE' AND NOT r.referred_user_id = ANY(t.path)
)`;
referralsRouter.get('/', async (request, response, next) => {
    try {
        const result = await pool.query('SELECT referral_code FROM users WHERE id = $1', [request.auth.userId]);
        const referralCode = result.rows[0]?.referral_code ?? '';
        response.json({ success: true, data: {
            referralCode,
            referralLink: referralCode ? buildReferralLink(referralCode) : '',
            shareText: referralCode ? `Join me on MKM using my referral code: ${referralCode}` : 'Join me on MKM',
            rates: { A: 22, B: 2, C: 1 },
        } });
    }
    catch (error) {
        next(error);
    }
});
referralsRouter.get('/team/summary', async (request, response, next) => {
    try {
        const [result, earningsResult] = await Promise.all([
            pool.query(`${treeCte}
       SELECT t.depth, count(DISTINCT t.user_id)::int AS user_count,
         count(DISTINCT r.user_id) FILTER (WHERE r.status = 'APPROVED' AND r.credited_at IS NOT NULL)::int AS active_count,
         coalesce(sum(r.amount) FILTER (WHERE r.status = 'APPROVED' AND r.credited_at IS NOT NULL), 0)::text AS recharge_total
       FROM team t LEFT JOIN recharge_requests r ON r.user_id = t.user_id GROUP BY t.depth`, [request.auth.userId]),
            pool.query(`SELECT coalesce(sum(credit), 0)::text AS total_earnings FROM wallet_ledger WHERE user_id = $1 AND transaction_type = 'REFERRAL_COMMISSION'`, [request.auth.userId]),
        ]);
        const byLevel = [
            { userCount: 0, activeUserCount: 0, rechargeTotal: '0.00', rate: 22 },
            { userCount: 0, activeUserCount: 0, rechargeTotal: '0.00', rate: 2 },
            { userCount: 0, activeUserCount: 0, rechargeTotal: '0.00', rate: 1 },
        ];
        for (const row of result.rows) {
            if (row.depth >= 1 && row.depth <= 3) {
                byLevel[row.depth - 1] = {
                    userCount: row.user_count,
                    activeUserCount: row.active_count,
                    rechargeTotal: row.recharge_total,
                    rate: [22, 2, 1][row.depth - 1],
                };
            }
        }
        const cents = byLevel.reduce((sum, value) => sum + decimalToCents(value.rechargeTotal), 0n);
        const totalEarnings = earningsResult.rows[0]?.total_earnings ?? '0.00';
        response.json({ success: true, data: {
                aLevel: byLevel[0], bLevel: byLevel[1], cLevel: byLevel[2],
                total: {
                    userCount: byLevel.reduce((sum, value) => sum + value.userCount, 0),
                    activeUserCount: byLevel.reduce((sum, value) => sum + value.activeUserCount, 0),
                    rechargeTotal: centsToDecimal(cents),
                    totalEarnings: totalEarnings,
                },
                rates: { A: 22, B: 2, C: 1 },
            } });
    }
    catch (error) {
        next(error);
    }
});
referralsRouter.get('/team', (request, response) => response.redirect(307, '/api/referrals/team/summary'));
referralsRouter.get('/team/members', async (request, response, next) => {
    try {
        const query = z.object({
            level: z.enum(['A', 'B', 'C']).optional(),
            status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
            hasRecharge: z.enum(['true', 'false']).optional(),
            from: z.string().date().optional(),
            to: z.string().date().optional(),
            search: z.string().trim().max(80).optional(),
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(25),
        }).superRefine((value, context) => {
            if (value.from && value.to && value.from > value.to)
                context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'The end date must be on or after the start date.' });
        }).safeParse(request.query);
        if (!query.success)
            return response.status(400).json({ success: false, message: 'One or more team filters are invalid.', code: 'VALIDATION_ERROR' });
        const filters = query.data;
        const values = [request.auth.userId];
        const bind = (value) => { values.push(value); return `$${values.length}`; };
        const conditions = [];
        if (filters.level)
            conditions.push(`m.depth = ${bind({ A: 1, B: 2, C: 3 }[filters.level])}`);
        if (filters.status)
            conditions.push(`m.status = ${bind(filters.status)}`);
        if (filters.from)
            conditions.push(`m.created_at >= ${bind(filters.from)}::date`);
        if (filters.to)
            conditions.push(`m.created_at < (${bind(filters.to)}::date + interval '1 day')`);
        if (filters.search)
            conditions.push(`(m.full_name ILIKE ${bind(`%${filters.search}%`)} OR m.phone_number::text LIKE ${bind(`%${filters.search}%`)})`);
        if (filters.hasRecharge !== undefined)
            conditions.push(`(m.recharge_total::numeric > 0) = ${bind(filters.hasRecharge === 'true')}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const offset = bind((filters.page - 1) * filters.limit);
        const limit = bind(filters.limit);
        const result = await pool.query(`${treeCte}, recharge_totals AS (
         SELECT user_id, sum(amount) AS recharge_total, count(*)::int AS recharge_count, max(credited_at) AS last_recharge
         FROM recharge_requests WHERE status = 'APPROVED' AND credited_at IS NOT NULL GROUP BY user_id
       ), members AS (
         SELECT t.depth, u.id, u.full_name, u.phone_number, u.status, u.created_at,
           coalesce(rt.recharge_total, 0)::text AS recharge_total, coalesce(rt.recharge_count, 0)::int AS recharge_count, rt.last_recharge
         FROM team t JOIN users u ON u.id = t.user_id LEFT JOIN recharge_totals rt ON rt.user_id = u.id
       )
      SELECT m.*, count(*) OVER()::int AS total_count FROM members m
      ${where} ORDER BY m.created_at DESC OFFSET ${offset} LIMIT ${limit}`, values);
        const totalCount = result.rows[0]?.total_count ?? 0;
        response.json({ success: true, data: {
                members: result.rows.map((row) => ({
                    id: row.id, level: ['A', 'B', 'C'][row.depth - 1], fullName: row.full_name,
                    phoneNumber: maskPhone(String(row.phone_number).trim()), status: row.status,
                    registeredAt: row.created_at, approvedRechargeTotal: row.recharge_total,
                    approvedRechargeCount: row.recharge_count, lastApprovedRechargeAt: row.last_recharge,
                })),
                pagination: { page: filters.page, limit: filters.limit, total: totalCount, pages: Math.ceil(totalCount / filters.limit) },
            } });
    }
    catch (error) {
        next(error);
    }
});
referralsRouter.get('/team/:userId', async (request, response, next) => {
    try {
        const targetId = z.string().uuid().safeParse(request.params.userId);
        if (!targetId.success)
            return response.status(400).json({ success: false, message: 'Invalid team member.', code: 'VALIDATION_ERROR' });
        const result = await pool.query(`${treeCte}
       SELECT u.id, u.full_name, u.phone_number, u.status, u.created_at, t.depth,
         coalesce(sum(r.amount) FILTER (WHERE r.status = 'APPROVED' AND r.credited_at IS NOT NULL), 0)::text AS recharge_total,
         count(r.id) FILTER (WHERE r.status = 'APPROVED' AND r.credited_at IS NOT NULL)::int AS recharge_count,
         max(r.credited_at) FILTER (WHERE r.status = 'APPROVED' AND r.credited_at IS NOT NULL) AS last_recharge
       FROM team t JOIN users u ON u.id = t.user_id LEFT JOIN recharge_requests r ON r.user_id = u.id
       WHERE u.id = $2 GROUP BY u.id, t.depth`, [request.auth.userId, targetId.data]);
        if (!result.rowCount)
            return response.status(404).json({ success: false, message: 'Team member not found.', code: 'NOT_FOUND' });
        const member = result.rows[0];
        response.json({ success: true, data: {
                id: member.id, level: ['A', 'B', 'C'][member.depth - 1], fullName: member.full_name,
                phoneNumber: maskPhone(String(member.phone_number).trim()), status: member.status,
                registeredAt: member.created_at, approvedRechargeTotal: member.recharge_total,
                approvedRechargeCount: member.recharge_count, lastApprovedRechargeAt: member.last_recharge,
            } });
    }
    catch (error) {
        next(error);
    }
});

adminReferralsRouter.get('/', async (request, response, next) => {
    try {
        const query = z.object({
            search: z.string().trim().max(80).optional(),
            status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
            from: z.string().date().optional(),
            to: z.string().date().optional(),
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(25),
        }).superRefine((value, context) => {
            if (value.from && value.to && value.from > value.to)
                context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'The end date must be on or after the start date.' });
        }).safeParse(request.query);
        if (!query.success)
            return response.status(400).json({ success: false, message: 'One or more referral filters are invalid.', code: 'VALIDATION_ERROR' });
        const filters = query.data;
        const values = [];
        const bind = (value) => { values.push(value); return `$${values.length}`; };
        const conditions = ["u.role = 'CUSTOMER'", 'EXISTS (SELECT 1 FROM referrals edge WHERE edge.referrer_id = u.id)'];
        if (filters.search)
            conditions.push(`(u.full_name ILIKE ${bind(`%${filters.search}%`)} OR u.phone_number::text LIKE ${bind(`%${filters.search}%`)} OR u.referral_code ILIKE ${bind(`%${filters.search}%`)})`);
        if (filters.status)
            conditions.push(`u.status = ${bind(filters.status)}`);
        const rootWhere = conditions.join(' AND ');
        const start = filters.from ? bind(filters.from) : null;
        const end = filters.to ? bind(filters.to) : null;
        const dateClauses = [];
        if (start) dateClauses.push(`member.created_at >= ${start}::date`);
        if (end) dateClauses.push(`member.created_at < (${end}::date + interval '1 day')`);
        const memberDateWhere = dateClauses.length ? `AND ${dateClauses.join(' AND ')}` : '';
        const rechargeDateClauses = [];
        if (start) rechargeDateClauses.push(`r.credited_at >= ${start}::date`);
        if (end) rechargeDateClauses.push(`r.credited_at < (${end}::date + interval '1 day')`);
        const rechargeDateWhere = rechargeDateClauses.length ? `AND ${rechargeDateClauses.join(' AND ')}` : '';
        const commissionDateClauses = [];
        if (start) commissionDateClauses.push(`rc.created_at >= ${start}::date`);
        if (end) commissionDateClauses.push(`rc.created_at < (${end}::date + interval '1 day')`);
        const commissionDateWhere = commissionDateClauses.length ? `AND ${commissionDateClauses.join(' AND ')}` : '';
        const offset = bind((filters.page - 1) * filters.limit);
        const limit = bind(filters.limit);
        const result = await pool.query(`WITH RECURSIVE roots AS (
          SELECT u.id, u.full_name, u.phone_number, u.referral_code, u.status, u.created_at
          FROM users u WHERE ${rootWhere}
        ), network(root_id, member_id, depth, path) AS (
          SELECT r.referrer_id, r.referred_user_id, 1, ARRAY[r.referrer_id, r.referred_user_id]
          FROM referrals r JOIN roots root ON root.id = r.referrer_id
          WHERE r.status = 'ACTIVE'
          UNION ALL
          SELECT n.root_id, r.referred_user_id, n.depth + 1, n.path || r.referred_user_id
          FROM referrals r JOIN network n ON r.referrer_id = n.member_id
          WHERE n.depth < 3 AND r.status = 'ACTIVE' AND NOT r.referred_user_id = ANY(n.path)
        ), member_stats AS (
          SELECT n.root_id, n.member_id, n.depth, member.status,
            coalesce(sum(r.amount) FILTER (WHERE r.status = 'APPROVED' AND r.credited_at IS NOT NULL ${rechargeDateWhere}), 0)::numeric AS recharge_total
          FROM network n JOIN users member ON member.id = n.member_id
          LEFT JOIN recharge_requests r ON r.user_id = member.id
          WHERE true ${memberDateWhere}
          GROUP BY n.root_id, n.member_id, n.depth, member.status
        ), commission_stats AS (
          SELECT rc.beneficiary_user_id AS root_id,
            sum(rc.amount)::numeric AS total,
            sum(rc.amount) FILTER (WHERE rc.referral_level = 'A')::numeric AS level_a,
            sum(rc.amount) FILTER (WHERE rc.referral_level = 'B')::numeric AS level_b,
            sum(rc.amount) FILTER (WHERE rc.referral_level = 'C')::numeric AS level_c
          FROM referral_commissions rc
          WHERE true ${commissionDateWhere}
          GROUP BY rc.beneficiary_user_id
        )
        SELECT roots.id, roots.full_name AS "fullName", roots.phone_number AS "phoneNumber",
          roots.referral_code AS "referralCode", roots.status, roots.created_at AS "registeredAt",
          count(member_stats.member_id)::int AS "totalReferrals",
          count(member_stats.member_id) FILTER (WHERE member_stats.status = 'ACTIVE')::int AS "activeReferrals",
          count(member_stats.member_id) FILTER (WHERE member_stats.depth = 1)::int AS "levelAReferrals",
          count(member_stats.member_id) FILTER (WHERE member_stats.depth = 2)::int AS "levelBReferrals",
          count(member_stats.member_id) FILTER (WHERE member_stats.depth = 3)::int AS "levelCReferrals",
          coalesce(sum(member_stats.recharge_total), 0)::text AS "qualifyingRechargeTotal",
          coalesce(commission_stats.total, 0)::text AS "commissionTotal",
          coalesce(commission_stats.level_a, 0)::text AS "levelACommission",
          coalesce(commission_stats.level_b, 0)::text AS "levelBCommission",
          coalesce(commission_stats.level_c, 0)::text AS "levelCCommission",
          count(*) OVER()::int AS total_count
        FROM roots
        LEFT JOIN member_stats ON member_stats.root_id = roots.id
        LEFT JOIN commission_stats ON commission_stats.root_id = roots.id
        GROUP BY roots.id, roots.full_name, roots.phone_number, roots.referral_code, roots.status, roots.created_at,
          commission_stats.total, commission_stats.level_a, commission_stats.level_b, commission_stats.level_c
        ORDER BY roots.created_at DESC OFFSET ${offset} LIMIT ${limit}`, values);
        response.json({ success: true, data: {
            items: result.rows.map(({ total_count, ...item }) => item),
            pagination: { page: filters.page, limit: filters.limit, total: result.rows[0]?.total_count ?? 0, pages: Math.ceil((result.rows[0]?.total_count ?? 0) / filters.limit) },
        } });
    }
    catch (error) {
        next(error);
    }
});

adminReferralsRouter.get('/:userId/members', async (request, response, next) => {
    try {
        const userId = z.string().uuid().safeParse(request.params.userId);
        const query = z.object({ from: z.string().date().optional(), to: z.string().date().optional() })
            .superRefine((value, context) => {
                if (value.from && value.to && value.from > value.to)
                    context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'The end date must be on or after the start date.' });
            }).safeParse(request.query);
        if (!userId.success || !query.success)
            return response.status(400).json({ success: false, message: 'Invalid referral network request.', code: 'VALIDATION_ERROR' });
        const values = [userId.data];
        const memberDates = [];
        const rechargeDates = [];
        const commissionDates = [];
        if (query.data.from) {
            values.push(query.data.from);
            memberDates.push(`u.created_at >= $${values.length}::date`);
            rechargeDates.push(`r.credited_at >= $${values.length}::date`);
            commissionDates.push(`rc.created_at >= $${values.length}::date`);
        }
        if (query.data.to) {
            values.push(query.data.to);
            memberDates.push(`u.created_at < ($${values.length}::date + interval '1 day')`);
            rechargeDates.push(`r.credited_at < ($${values.length}::date + interval '1 day')`);
            commissionDates.push(`rc.created_at < ($${values.length}::date + interval '1 day')`);
        }
        const result = await pool.query(`WITH RECURSIVE team(user_id, sponsor_id, depth, path) AS (
          SELECT referred_user_id, referrer_id, 1, ARRAY[$1::uuid, referred_user_id]
          FROM referrals WHERE referrer_id = $1 AND status = 'ACTIVE'
          UNION ALL
          SELECT r.referred_user_id, r.referrer_id, team.depth + 1, team.path || r.referred_user_id
          FROM referrals r JOIN team ON r.referrer_id = team.user_id
          WHERE team.depth < 3 AND r.status = 'ACTIVE' AND NOT r.referred_user_id = ANY(team.path)
        )
        SELECT u.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.status,
          team.depth AS level, sponsor.full_name AS "sponsorName", u.created_at AS "registeredAt",
          coalesce((SELECT sum(r.amount) FROM recharge_requests r WHERE r.user_id = u.id AND r.status = 'APPROVED' AND r.credited_at IS NOT NULL ${rechargeDates.length ? `AND ${rechargeDates.join(' AND ')}` : ''}), 0)::text AS "qualifyingRechargeTotal",
          (SELECT count(*)::int FROM recharge_requests r WHERE r.user_id = u.id AND r.status = 'APPROVED' AND r.credited_at IS NOT NULL ${rechargeDates.length ? `AND ${rechargeDates.join(' AND ')}` : ''}) AS "qualifyingRechargeCount",
          coalesce((SELECT json_agg(json_build_object(
            'id', r.id, 'amount', r.amount::text, 'creditedAt', r.credited_at,
            'transactionReference', r.transaction_reference
          ) ORDER BY r.credited_at DESC) FROM recharge_requests r
            WHERE r.user_id = u.id AND r.status = 'APPROVED' AND r.credited_at IS NOT NULL
            ${rechargeDates.length ? `AND ${rechargeDates.join(' AND ')}` : ''}), '[]'::json) AS "qualifyingRecharges",
          coalesce((SELECT sum(rc.amount) FROM referral_commissions rc WHERE rc.beneficiary_user_id = u.id ${commissionDates.length ? `AND ${commissionDates.join(' AND ')}` : ''}), 0)::text AS "commissionTotal"
        FROM team JOIN users u ON u.id = team.user_id
        JOIN users sponsor ON sponsor.id = team.sponsor_id
        ${memberDates.length ? `WHERE ${memberDates.join(' AND ')}` : ''}
        ORDER BY team.depth, u.created_at DESC`, values);
        response.json({ success: true, data: result.rows.map((row) => ({ ...row, level: ['A', 'B', 'C'][row.level - 1] })) });
    }
    catch (error) {
        next(error);
    }
});
function maskPhone(phone) { return `${phone.slice(0, 3)}***${phone.slice(-3)}`; }
function decimalToCents(amount) { const [whole, fraction = ''] = amount.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2)); }
function centsToDecimal(amount) { return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`; }
