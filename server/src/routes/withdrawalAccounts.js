import { Router } from 'express';
import { z } from 'zod';
import { inTransaction, pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateAccountNumber } from '../lib/bankValidation.js';
export const withdrawalAccountsRouter = Router();
withdrawalAccountsRouter.use(requireAuth);
const accountSchema = z.object({
    paymentMethodId: z.string().uuid(),
    accountHolderName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(3).max(120),
    phoneNumber: z.string().trim().max(40).nullable().optional(),
    additionalDetails: z.string().trim().max(1000).nullable().optional(),
    isDefault: z.boolean().optional(),
});

async function validateAccountForPaymentMethod(paymentMethodId, accountNumber) {
    const result = await pool.query('SELECT name FROM payment_methods WHERE id = $1 AND is_active = true', [paymentMethodId]);
    if (!result.rowCount) {
        throw Object.assign(new Error('That payment provider is not available.'), { status: 400, code: 'PAYMENT_METHOD_UNAVAILABLE' });
    }
    const methodName = result.rows[0].name;
    if (!validateAccountNumber(methodName, accountNumber)) {
        throw Object.assign(new Error('The selected bank account number format is invalid for this payment method.'), { status: 400, code: 'INVALID_ACCOUNT_NUMBER' });
    }
    return methodName;
}
withdrawalAccountsRouter.get('/', async (request, response, next) => {
    try {
        const result = await pool.query(`SELECT a.id, a.payment_method_id AS "paymentMethodId", coalesce(p.name, 'Other') AS "paymentProvider",
        a.account_holder_name AS "accountHolderName", a.account_number AS "accountNumber",
        a.phone_number AS "phoneNumber", a.additional_details AS "additionalDetails",
        a.is_default AS "isDefault", a.is_verified AS "isVerified", a.created_at AS "createdAt"
       FROM withdrawal_accounts a LEFT JOIN payment_methods p ON p.id = a.payment_method_id
       WHERE a.user_id = $1 ORDER BY a.is_default DESC, a.created_at DESC`, [request.auth.userId]);
        response.json({ success: true, data: result.rows.map((account) => ({
            ...account,
            phoneNumber: account.phoneNumber ? maskAccount(account.phoneNumber) : null,
        })) });
    }
    catch (error) {
        next(error);
    }
});
withdrawalAccountsRouter.post('/', async (request, response, next) => {
    try {
        const parsed = accountSchema.safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the account details.', code: 'VALIDATION_ERROR' });
        const provider = await validateAccountForPaymentMethod(parsed.data.paymentMethodId, parsed.data.accountNumber);
        const account = await inTransaction(async (client) => {
            await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [request.auth.userId]);
            const existing = await client.query(`SELECT count(*)::int AS total_count,
              count(*) FILTER (WHERE lower(p.name) = 'telebirr')::int AS telebirr_count,
              count(*) FILTER (WHERE lower(p.name) <> 'telebirr')::int AS bank_count
             FROM withdrawal_accounts a LEFT JOIN payment_methods p ON p.id = a.payment_method_id
             WHERE a.user_id = $1`, [request.auth.userId]);
            const counts = existing.rows[0];
            if ((provider.toLowerCase() === 'telebirr' && counts.telebirr_count > 0) || (provider.toLowerCase() !== 'telebirr' && counts.bank_count > 0)) {
                throw Object.assign(new Error('Only one bank account and one Telebirr account may be saved.'), { status: 409, code: 'ACCOUNT_LIMIT_REACHED' });
            }
            const isDefault = parsed.data.isDefault ?? counts.total_count === 0;
            if (isDefault)
                await client.query('UPDATE withdrawal_accounts SET is_default = false WHERE user_id = $1', [request.auth.userId]);
            const result = await client.query(`INSERT INTO withdrawal_accounts(user_id, payment_method_id, account_holder_name, account_number, phone_number, additional_details, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, payment_method_id AS "paymentMethodId", account_holder_name AS "accountHolderName",
           account_number AS "accountNumber", phone_number AS "phoneNumber", additional_details AS "additionalDetails",
           is_default AS "isDefault", is_verified AS "isVerified"`, [request.auth.userId, parsed.data.paymentMethodId ?? null, parsed.data.accountHolderName, parsed.data.accountNumber, parsed.data.phoneNumber ?? null, parsed.data.additionalDetails ?? null, isDefault]);
            return result.rows[0];
        });
        response.status(201).json({ success: true, data: {
            ...account,
            phoneNumber: account.phoneNumber ? maskAccount(account.phoneNumber) : null,
        } });
    }
    catch (error) {
        next(error);
    }
});
withdrawalAccountsRouter.patch('/:id', (_request, response) => response.status(403).json({ success: false, message: 'Withdrawal accounts cannot be edited by customers. Contact support.', code: 'ACCOUNT_IMMUTABLE' }));
withdrawalAccountsRouter.delete('/:id', (_request, response) => response.status(403).json({ success: false, message: 'Withdrawal accounts cannot be removed by customers. Contact support.', code: 'ACCOUNT_IMMUTABLE' }));

function maskAccount(value) {
    const account = String(value ?? '');
    return account.length <= 4 ? '****' : `${'*'.repeat(Math.max(4, account.length - 4))}${account.slice(-4)}`;
}
