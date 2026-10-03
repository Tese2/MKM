import { Router } from 'express';
import { pool } from '../db/pool.js';
import { normalizeSupportSettings } from '../lib/supportSettings.js';
import { requireAuth } from '../middleware/auth.js';
export const customerRouter = Router();
customerRouter.get('/dashboard', requireAuth, async (request, response, next) => {
    try {
        const userId = request.auth.userId;
        const [account, team, activity] = await Promise.all([
            pool.query('SELECT available_balance, pending_balance, locked_balance FROM wallets WHERE user_id = $1', [userId]),
            pool.query(`WITH RECURSIVE team(user_id, depth) AS (
           SELECT referred_user_id, 1 FROM referrals WHERE referrer_id = $1 AND status = 'ACTIVE'
           UNION ALL
           SELECT r.referred_user_id, t.depth + 1 FROM referrals r JOIN team t ON r.referrer_id = t.user_id
           WHERE t.depth < 3 AND r.status = 'ACTIVE'
         )
         SELECT t.depth, count(DISTINCT t.user_id)::int AS user_count,
           coalesce(sum(r.amount) FILTER (WHERE r.status = 'APPROVED' AND r.credited_at IS NOT NULL), 0)::text AS recharge_total
         FROM team t LEFT JOIN recharge_requests r ON r.user_id = t.user_id
         GROUP BY t.depth`, [userId]),
            pool.query(`SELECT id, transaction_type AS type, (credit + debit)::text AS amount,
           CASE WHEN credit > 0 THEN 'CREDIT' ELSE 'DEBIT' END AS direction,
           status, created_at AS "createdAt"
         FROM wallet_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, [userId]),
        ]);
        const totals = {
            aLevel: { userCount: 0, rechargeTotal: '0.00' },
            bLevel: { userCount: 0, rechargeTotal: '0.00' },
            cLevel: { userCount: 0, rechargeTotal: '0.00' },
        };
        for (const row of team.rows) {
            const key = row.depth === 1 ? 'aLevel' : row.depth === 2 ? 'bLevel' : 'cLevel';
            totals[key] = { userCount: row.user_count, rechargeTotal: row.recharge_total };
        }
        const totalCents = [totals.aLevel.rechargeTotal, totals.bLevel.rechargeTotal, totals.cLevel.rechargeTotal]
            .reduce((sum, amount) => sum + decimalToCents(amount), 0n);
        const balance = account.rows[0] ?? { available_balance: '0.00', pending_balance: '0.00', locked_balance: '0.00' };
        const user = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
        response.json({
            success: true,
            data: {
                wallet: { availableBalance: balance.available_balance, pendingBalance: balance.pending_balance, lockedBalance: balance.locked_balance },
                referralCode: user.rows[0].referral_code,
                team: {
                    ...totals,
                    total: { userCount: totals.aLevel.userCount + totals.bLevel.userCount + totals.cLevel.userCount, rechargeTotal: centsToDecimal(totalCents) },
                },
                recentTransactions: activity.rows,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
customerRouter.get('/purchases', requireAuth, async (request, response, next) => {
    try {
        const result = await pool.query(`SELECT pp.id, pp.amount::text AS amount, pp.status, pp.activated_at AS "activatedAt",
          pp.expires_at AS "expiresAt", pp.created_at AS "createdAt",
          p.name, p.price::text AS "productPrice", p.daily_rate::text AS "dailyRate", p.duration_days AS "durationDays"
        FROM product_purchases pp JOIN products p ON p.id = pp.product_id
        WHERE pp.user_id = $1 ORDER BY pp.created_at DESC LIMIT 100`, [request.auth.userId]);
        response.json({ success: true, data: result.rows });
    }
    catch (error) {
        next(error);
    }
});
customerRouter.get('/config/public', async (_request, response, next) => {
    try {
        const keys = [
            'site_name', 'support_name', 'support_phone', 'support_message',
            'support_enabled', 'customer_support_url', 'customer_support_label', 'customer_support_enabled',
            'whatsapp_url', 'whatsapp_number', 'whatsapp_enabled', 'whatsapp_message',
            'official_group_name', 'official_group_url', 'official_group_label', 'official_group_enabled',
            'app_download_url', 'about_title', 'about_intro', 'about_first_heading',
            'about_first_content', 'about_second_heading', 'about_second_content', 'public_links',
        ];
        const result = await pool.query("SELECT key, value #>> '{}' AS value FROM settings WHERE key = ANY($1::text[])", [keys]);
        const settings = Object.fromEntries(result.rows.map(({ key, value }) => [key, value]));
        response.json({
            success: true,
            data: normalizeSupportSettings({
                ...settings,
                app_download_url: settings.app_download_url ?? process.env.APP_DOWNLOAD_URL,
            }),
        });
    }
    catch (error) {
        next(error);
    }
});
function decimalToCents(amount) {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}
function centsToDecimal(amount) {
    return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
