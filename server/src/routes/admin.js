import argon2 from 'argon2';
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { normalizeAdminSettings } from '../lib/adminSettings.js';
import { normalizePublicLinks } from '../lib/supportSettings.js';
import { validateAccountNumber } from '../lib/bankValidation.js';
import { ADMIN_PRIVILEGES, normalizePrivileges, hasPrivilege } from '../lib/adminPrivileges.js';
import { runIdempotent } from '../db/idempotency.js';
import { inTransaction, pool } from '../db/pool.js';
import { requireAdmin, requireAdminPrivilege, requireAuth } from '../middleware/auth.js';
import { createUserRateLimit } from '../middleware/userRateLimit.js';
import { postWalletMovement } from '../services/wallet.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/dashboard', async (_request, response, next) => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT count(DISTINCT user_id)::int FROM product_purchases WHERE status IN ('ACTIVE', 'COMPLETED')) AS active_customers,
        (SELECT count(*)::int FROM users) AS total_customers,
        (SELECT coalesce(sum(available_balance), 0)::text FROM wallets) AS total_available_balance,
        (SELECT coalesce(sum(locked_balance), 0)::text FROM wallets) AS total_locked_balance,
        (SELECT count(*)::int FROM recharge_requests WHERE status = 'PENDING') AS pending_recharges,
        (SELECT coalesce(sum(amount), 0)::text FROM recharge_requests WHERE status = 'APPROVED') AS approved_recharge_total,
        (SELECT count(*)::int FROM recharge_requests WHERE status = 'REJECTED') AS rejected_recharges,
        (SELECT count(*)::int FROM withdrawals WHERE status = 'PENDING') AS pending_withdrawals,
        (SELECT coalesce(sum(net_amount), 0)::text FROM withdrawals WHERE status = 'COMPLETED') AS completed_withdrawal_total,
        (SELECT count(*)::int FROM products WHERE status <> 'DRAFT') AS total_products,
        (SELECT count(*)::int FROM products WHERE status = 'AVAILABLE') AS active_products,
        (SELECT count(*)::int FROM product_purchases) AS total_purchases,
        (SELECT count(*)::int FROM referrals) AS referral_links
    `);
    response.json({ success: true, data: stats.rows[0] });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/customers', requireAdminPrivilege('CUSTOMER_VIEW'), async (request, response, next) => {
  try {
    const query = z.object({
      search: z.string().trim().max(80).optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }).safeParse(request.query);

    if (!query.success) {
      return response.status(400).json({ success: false, message: 'Invalid customer query.', code: 'VALIDATION_ERROR' });
    }

    const { search, status, page, limit } = query.data;
    const values = [];
    const clauses = [];
    if (search) {
      clauses.push(`(u.full_name ILIKE $${values.length + 1} OR u.phone_number::text ILIKE $${values.length + 1} OR u.referral_code ILIKE $${values.length + 1})`);
      values.push(`%${search}%`);
    }
    if (status) {
      clauses.push(`u.status = $${values.length + 1}`);
      values.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT u.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.referral_code AS "referralCode",
              u.role, u.status, u.created_at AS "registeredAt",
              coalesce(w.available_balance, '0')::text AS "availableBalance",
              coalesce(w.locked_balance, '0')::text AS "lockedBalance",
              coalesce(wa.accounts, '[]'::json) AS "withdrawalAccounts",
              count(*) OVER()::int AS total_count
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'id', a.id,
           'paymentMethodId', a.payment_method_id,
           'paymentProvider', coalesce(p.name, 'Other'),
           'accountHolderName', a.account_holder_name,
           'accountNumber', a.account_number,
           'phoneNumber', a.phone_number
         ) ORDER BY a.is_default DESC, a.created_at DESC) AS accounts
         FROM withdrawal_accounts a
         LEFT JOIN payment_methods p ON p.id = a.payment_method_id
         WHERE a.user_id = u.id
       ) wa ON true
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    const total = result.rows[0]?.total_count ?? 0;
    response.json({
      success: true,
      data: {
        items: result.rows.map(({ total_count, ...row }) => row),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/customers/:id', requireAdminPrivilege('CUSTOMER_VIEW'), async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) {
      return response.status(400).json({ success: false, message: 'Invalid customer ID.', code: 'VALIDATION_ERROR' });
    }
    const [userRes, walletRes, rechargesRes, withdrawalsRes, purchasesRes, recentTxRes] = await Promise.all([
      pool.query(`SELECT u.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.referral_code AS "referralCode",
                         u.role, u.status, u.created_at AS "registeredAt",
                         coalesce(wa.accounts, '[]'::json) AS "withdrawalAccounts"
                  FROM users u
                  LEFT JOIN LATERAL (
                    SELECT json_agg(json_build_object(
                      'id', a.id,
                      'paymentMethodId', a.payment_method_id,
                      'paymentProvider', coalesce(p.name, 'Other'),
                      'accountHolderName', a.account_holder_name,
                      'accountNumber', a.account_number,
                      'phoneNumber', a.phone_number,
                      'isDefault', a.is_default
                    ) ORDER BY a.is_default DESC, a.created_at DESC) AS accounts
                    FROM withdrawal_accounts a
                    LEFT JOIN payment_methods p ON p.id = a.payment_method_id
                    WHERE a.user_id = u.id
                  ) wa ON true
                  WHERE u.id = $1 AND u.role = 'CUSTOMER'`, [parsedId.data]),
      pool.query(`SELECT available_balance::text AS "availableBalance",
                         pending_balance::text AS "pendingBalance",
                         locked_balance::text AS "lockedBalance"
                  FROM wallets WHERE user_id = $1`, [parsedId.data]),
      pool.query(`SELECT count(*)::int AS count,
                         coalesce(sum(amount) FILTER (WHERE status = 'APPROVED'), 0)::text AS "approvedTotal",
                         count(*) FILTER (WHERE status = 'PENDING')::int AS "pendingCount"
                  FROM recharge_requests WHERE user_id = $1`, [parsedId.data]),
      pool.query(`SELECT count(*)::int AS count,
                         coalesce(sum(net_amount) FILTER (WHERE status = 'COMPLETED'), 0)::text AS "completedTotal",
                         count(*) FILTER (WHERE status = 'PENDING')::int AS "pendingCount"
                  FROM withdrawals WHERE user_id = $1`, [parsedId.data]),
      pool.query(`SELECT count(*)::int AS count,
                         count(*) FILTER (WHERE status = 'ACTIVE')::int AS "activeCount",
                         coalesce(sum(amount), 0)::text AS "totalAmount"
                  FROM product_purchases WHERE user_id = $1`, [parsedId.data]),
      pool.query(`SELECT id, type, amount::text, direction, status, description, created_at AS "createdAt"
                  FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`, [parsedId.data]),
    ]);

    if (!userRes.rowCount) {
      return response.status(404).json({ success: false, message: 'Customer not found.', code: 'NOT_FOUND' });
    }

    const customer = userRes.rows[0];
    const wallet = walletRes.rows[0] ?? { availableBalance: '0.00', pendingBalance: '0.00', lockedBalance: '0.00' };
    const recharges = rechargesRes.rows[0] ?? { count: 0, approvedTotal: '0.00', pendingCount: 0 };
    const withdrawals = withdrawalsRes.rows[0] ?? { count: 0, completedTotal: '0.00', pendingCount: 0 };
    const purchases = purchasesRes.rows[0] ?? { count: 0, activeCount: 0, totalAmount: '0.00' };

    response.json({
      success: true,
      data: {
        ...customer,
        phoneNumber: String(customer.phoneNumber ?? '').trim(),
        wallet,
        recharges,
        withdrawals,
        purchases,
        recentTransactions: recentTxRes.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

const customerStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  reason: z.string().trim().max(500).optional(),
  adminPassword: z.string().min(1).max(128).optional(),
});

adminRouter.post('/customers/:id/penalties', requireAdminPrivilege('CUSTOMER_MANAGE'), async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const parsedBody = z.object({
      amount: z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/),
      comment: z.string().trim().min(1).max(1000),
    }).safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      return response.status(400).json({
        success: false,
        message: parsedBody.success ? 'Invalid customer ID.' : parsedBody.error.issues[0]?.message ?? 'Enter a valid penalty amount and reason.',
        code: 'VALIDATION_ERROR',
      });
    }
    const [wholeAmount, fractionAmount = ''] = parsedBody.data.amount.split('.');
    if (BigInt(wholeAmount) * 100n + BigInt(fractionAmount.padEnd(2, '0')) <= 0n) {
      return response.status(400).json({ success: false, message: 'Penalty amount must be greater than zero.', code: 'VALIDATION_ERROR' });
    }

    const outcome = await inTransaction(async (client) => runIdempotent(client, {
      userId: request.auth.userId,
      operation: `admin.customer.${parsedId.data}.penalty`,
      key: request.get('Idempotency-Key'),
      payload: parsedBody.data,
    }, async () => {
      const customer = await client.query(
        "SELECT id, full_name FROM users WHERE id = $1 AND role = 'CUSTOMER' FOR UPDATE",
        [parsedId.data],
      );
      if (!customer.rowCount) {
        throw Object.assign(new Error('Customer not found.'), { status: 404, code: 'NOT_FOUND' });
      }
      const referenceId = crypto.randomUUID();
      const movement = await postWalletMovement(client, {
        userId: parsedId.data,
        amount: parsedBody.data.amount,
        direction: 'DEBIT',
        transactionType: 'ADJUSTMENT',
        insufficientBalanceMessage: 'Penalty exceeds the customer’s available balance.',
        referenceId,
        referenceType: 'customer_penalty',
        externalReference: `customer-penalty:${referenceId}`,
        description: `Admin penalty: ${parsedBody.data.comment}`,
      });
      await client.query(
        "INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Balance penalty', $2, 'CUSTOMER_PENALTY')",
        [parsedId.data, `${parsedBody.data.amount} ETB was deducted from your available balance. Reason: ${parsedBody.data.comment}`],
      );
      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [request.auth.userId, 'CUSTOMER_PENALTY', 'user', parsedId.data, null, {
          amount: parsedBody.data.amount,
          comment: parsedBody.data.comment,
          availableBalance: movement.availableBalance,
          referenceId,
        }],
      );
      return {
        status: 200,
        body: {
          success: true,
          data: { customerId: parsedId.data, amount: parsedBody.data.amount, availableBalance: movement.availableBalance },
        },
      };
    }));
    response.status(outcome.status).json(outcome.body);
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/customers/:id/status', requireAdminPrivilege('CUSTOMER_MANAGE'), async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const parsedBody = customerStatusSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      return response.status(400).json({
        success: false,
        message: parsedBody.success ? 'Invalid customer ID.' : parsedBody.error.issues[0]?.message ?? 'Invalid status payload.',
        code: 'VALIDATION_ERROR',
      });
    }

    const { status: targetStatus, reason, adminPassword } = parsedBody.data;

    if (parsedId.data === request.auth.userId) {
      return response.status(400).json({
        success: false,
        message: 'You cannot deactivate your own administrative account.',
        code: 'CANNOT_DEACTIVATE_SELF',
      });
    }

    const result = await inTransaction(async (client) => {
      if (adminPassword) {
        const adminRes = await client.query("SELECT password_hash FROM users WHERE id = $1 AND role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE", [request.auth.userId]);
        if (!adminRes.rowCount || !await argon2.verify(adminRes.rows[0].password_hash, adminPassword)) {
          throw Object.assign(new Error('Admin password is incorrect.'), { status: 403, code: 'INVALID_ADMIN_PASSWORD' });
        }
      }

      const existingRes = await client.query("SELECT id, full_name, phone_number, role, status FROM users WHERE id = $1 FOR UPDATE", [parsedId.data]);
      if (!existingRes.rowCount) {
        throw Object.assign(new Error('Customer not found.'), { status: 404, code: 'NOT_FOUND' });
      }

      const customer = existingRes.rows[0];
      if (customer.role !== 'CUSTOMER') {
        throw Object.assign(new Error('Only customer accounts can be modified through this action.'), { status: 403, code: 'NOT_A_CUSTOMER' });
      }

      if (customer.status === targetStatus) {
        throw Object.assign(new Error(`Customer is already ${targetStatus.toLowerCase()}.`), { status: 409, code: 'CUSTOMER_ALREADY_IN_STATUS' });
      }

      await client.query("UPDATE users SET status = $1, updated_at = now() WHERE id = $2", [targetStatus, customer.id]);

      let sessionsRevoked = 0;
      if (targetStatus !== 'ACTIVE') {
        const sessionRes = await client.query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [customer.id]);
        sessionsRevoked = sessionRes.rowCount;
      }

      const action = targetStatus === 'ACTIVE' ? 'CUSTOMER_REACTIVATE' : 'CUSTOMER_DEACTIVATE';
      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          request.auth.userId,
          action,
          'user',
          customer.id,
          { status: customer.status },
          { status: targetStatus, reason: reason || null, sessionsRevoked },
        ],
      );

      return {
        id: customer.id,
        fullName: customer.full_name,
        status: targetStatus,
        sessionsRevoked,
      };
    });

    response.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete('/customers/:id', requireAdminPrivilege('CUSTOMER_MANAGE'), async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) {
      return response.status(400).json({ success: false, message: 'Invalid customer ID.', code: 'VALIDATION_ERROR' });
    }

    if (parsedId.data === request.auth.userId) {
      return response.status(400).json({
        success: false,
        message: 'You cannot deactivate your own administrative account.',
        code: 'CANNOT_DEACTIVATE_SELF',
      });
    }

    const adminPassword = typeof request.body?.adminPassword === 'string' ? request.body.adminPassword : undefined;
    const reason = typeof request.body?.reason === 'string' ? request.body.reason : 'Customer deactivated by admin';

    const result = await inTransaction(async (client) => {
      if (adminPassword) {
        const adminRes = await client.query("SELECT password_hash FROM users WHERE id = $1 AND role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE", [request.auth.userId]);
        if (!adminRes.rowCount || !await argon2.verify(adminRes.rows[0].password_hash, adminPassword)) {
          throw Object.assign(new Error('Admin password is incorrect.'), { status: 403, code: 'INVALID_ADMIN_PASSWORD' });
        }
      }

      const existingRes = await client.query("SELECT id, full_name, role, status FROM users WHERE id = $1 FOR UPDATE", [parsedId.data]);
      if (!existingRes.rowCount) {
        throw Object.assign(new Error('Customer not found.'), { status: 404, code: 'NOT_FOUND' });
      }

      const customer = existingRes.rows[0];
      if (customer.role !== 'CUSTOMER') {
        throw Object.assign(new Error('Only customer accounts can be deactivated through this action.'), { status: 403, code: 'NOT_A_CUSTOMER' });
      }

      if (customer.status === 'DEACTIVATED') {
        throw Object.assign(new Error('Customer is already deactivated.'), { status: 409, code: 'CUSTOMER_ALREADY_IN_STATUS' });
      }

      await client.query("UPDATE users SET status = 'DEACTIVATED', updated_at = now() WHERE id = $1", [customer.id]);
      const sessionRes = await client.query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [customer.id]);

      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          request.auth.userId,
          'CUSTOMER_DEACTIVATE',
          'user',
          customer.id,
          { status: customer.status },
          { status: 'DEACTIVATED', reason, sessionsRevoked: sessionRes.rowCount },
        ],
      );

      return {
        id: customer.id,
        fullName: customer.full_name,
        status: 'DEACTIVATED',
        sessionsRevoked: sessionRes.rowCount,
      };
    });

    response.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

adminRouter.put('/customers/:id/profile', async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const parsed = z.object({
      adminPassword: z.string().min(1).max(128),
      fullName: z.string().trim().min(2).max(120),
      phoneNumber: z.string().regex(/^[97][0-9]{8}$/, 'Enter a valid 9-digit Ethiopian phone number.'),
    }).safeParse(request.body);
    if (!parsedId.success || !parsed.success) {
      return response.status(400).json({
        success: false,
        message: parsed.success ? 'Invalid customer.' : parsed.error.issues[0]?.message ?? 'Check the customer details.',
        code: 'VALIDATION_ERROR',
      });
    }
    const updated = await inTransaction(async (client) => {
      const admin = await client.query("SELECT password_hash FROM users WHERE id = $1 AND role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE", [request.auth.userId]);
      if (!admin.rowCount || !await argon2.verify(admin.rows[0].password_hash, parsed.data.adminPassword)) {
        throw Object.assign(new Error('Admin password is incorrect.'), { status: 403, code: 'INVALID_ADMIN_PASSWORD' });
      }
      const existing = await client.query("SELECT full_name, phone_number FROM users WHERE id = $1 AND role = 'CUSTOMER' FOR UPDATE", [parsedId.data]);
      if (!existing.rowCount) {
        throw Object.assign(new Error('Customer not found.'), { status: 404, code: 'NOT_FOUND' });
      }
      const result = await client.query(
        `UPDATE users SET full_name = $2, phone_number = $3, updated_at = now()
         WHERE id = $1 RETURNING id, full_name AS "fullName", phone_number AS "phoneNumber"`,
        [parsedId.data, parsed.data.fullName, parsed.data.phoneNumber],
      );
      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [request.auth.userId, 'CUSTOMER_PROFILE_UPDATE', 'user', parsedId.data,
          { fullName: existing.rows[0].full_name, phoneNumber: String(existing.rows[0].phone_number).trim() },
          { fullName: parsed.data.fullName, phoneNumber: parsed.data.phoneNumber }],
      );
      return result.rows[0];
    });
    response.json({ success: true, data: { ...updated, phoneNumber: String(updated.phoneNumber).trim() } });
  } catch (error) {
    next(error);
  }
});

adminRouter.put('/customers/:id/withdrawal-accounts/:accountId', async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const parsedAccountId = z.string().uuid().safeParse(request.params.accountId);
    const parsed = z.object({
      adminPassword: z.string().min(1).max(128),
      paymentMethodId: z.string().uuid(),
      accountHolderName: z.string().trim().min(2).max(120),
      accountNumber: z.string().trim().min(3).max(120),
      phoneNumber: z.string().trim().max(40).nullable().optional(),
    }).safeParse(request.body);
    if (!parsedId.success || !parsedAccountId.success || !parsed.success) {
      return response.status(400).json({
        success: false,
        message: parsed.success ? 'Invalid customer withdrawal account.' : parsed.error.issues[0]?.message ?? 'Check the withdrawal account details.',
        code: 'VALIDATION_ERROR',
      });
    }
    const provider = await pool.query('SELECT name FROM payment_methods WHERE id = $1', [parsed.data.paymentMethodId]);
    if (!provider.rowCount) {
      return response.status(400).json({ success: false, message: 'Select a valid payment provider.', code: 'PAYMENT_METHOD_UNAVAILABLE' });
    }
    if (!validateAccountNumber(provider.rows[0].name, parsed.data.accountNumber)) {
      return response.status(400).json({ success: false, message: 'Account number format is invalid for this payment provider.', code: 'INVALID_ACCOUNT_NUMBER' });
    }
    const account = await inTransaction(async (client) => {
      const admin = await client.query("SELECT password_hash FROM users WHERE id = $1 AND role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE", [request.auth.userId]);
      if (!admin.rowCount || !await argon2.verify(admin.rows[0].password_hash, parsed.data.adminPassword)) {
        throw Object.assign(new Error('Admin password is incorrect.'), { status: 403, code: 'INVALID_ADMIN_PASSWORD' });
      }
      const existing = await client.query(
        `SELECT a.account_holder_name, a.account_number, a.phone_number, p.name AS provider
         FROM withdrawal_accounts a LEFT JOIN payment_methods p ON p.id = a.payment_method_id
         WHERE a.id = $1 AND a.user_id = $2 FOR UPDATE OF a`,
        [parsedAccountId.data, parsedId.data],
      );
      if (!existing.rowCount) {
        throw Object.assign(new Error('Customer withdrawal account not found.'), { status: 404, code: 'NOT_FOUND' });
      }
      const updated = await client.query(
        `UPDATE withdrawal_accounts SET payment_method_id = $3, account_holder_name = $4, account_number = $5,
           phone_number = $6, updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING id, payment_method_id AS "paymentMethodId", account_holder_name AS "accountHolderName",
           account_number AS "accountNumber", phone_number AS "phoneNumber"`,
        [parsedAccountId.data, parsedId.data, parsed.data.paymentMethodId, parsed.data.accountHolderName,
          parsed.data.accountNumber, parsed.data.phoneNumber || null],
      );
      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [request.auth.userId, 'CUSTOMER_WITHDRAWAL_ACCOUNT_UPDATE', 'withdrawal_account', parsedAccountId.data,
          {
            customerId: parsedId.data,
            provider: existing.rows[0].provider,
            accountHolderName: existing.rows[0].account_holder_name,
            accountNumber: maskSensitive(existing.rows[0].account_number),
            phoneNumber: maskSensitive(existing.rows[0].phone_number),
          },
          {
            customerId: parsedId.data,
            provider: provider.rows[0].name,
            accountHolderName: parsed.data.accountHolderName,
            accountNumber: maskSensitive(parsed.data.accountNumber),
            phoneNumber: maskSensitive(parsed.data.phoneNumber),
          }],
      );
      return updated.rows[0];
    });
    response.json({ success: true, data: {
      ...account,
      accountNumber: account.accountNumber,
      phoneNumber: account.phoneNumber,
    } });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/customers/:id/password-reset', async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const parsedBody = z.object({
      adminPassword: z.string().min(1).max(128),
      newPassword: z.string().min(6).max(128),
      confirmNewPassword: z.string().min(6).max(128),
    }).refine((value) => value.newPassword === value.confirmNewPassword, {
      path: ['confirmNewPassword'],
      message: 'New passwords do not match.',
    }).safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      return response.status(400).json({
        success: false,
        message: parsedBody.success ? 'Invalid customer.' : parsedBody.error.issues[0]?.message ?? 'Check the password details.',
        code: 'VALIDATION_ERROR',
      });
    }

    await inTransaction(async (client) => {
      const admin = await client.query("SELECT password_hash FROM users WHERE id = $1 AND role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE", [request.auth.userId]);
      if (!admin.rowCount || !await argon2.verify(admin.rows[0].password_hash, parsedBody.data.adminPassword)) {
        throw Object.assign(new Error('Admin password is incorrect.'), { status: 403, code: 'INVALID_ADMIN_PASSWORD' });
      }
      const customer = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'CUSTOMER' FOR UPDATE", [parsedId.data]);
      if (!customer.rowCount) {
        throw Object.assign(new Error('Customer not found.'), { status: 404, code: 'NOT_FOUND' });
      }
      const passwordHash = await argon2.hash(parsedBody.data.newPassword, { type: argon2.argon2id });
      await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, parsedId.data]);
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [parsedId.data]);
      await client.query(
        "INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Password reset', 'An administrator reset your login password. Contact support if you did not request this change.', 'PASSWORD_RESET')",
        [parsedId.data],
      );
      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [request.auth.userId, 'CUSTOMER_PASSWORD_RESET', 'user', parsedId.data, null, { passwordReset: true, sessionsRevoked: true }],
      );
    });
    response.json({ success: true, data: { passwordReset: true, sessionsRevoked: true } });
  } catch (error) {
    next(error);
  }
});

function maskSensitive(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  return text.length <= 4 ? '****' : `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

adminRouter.get('/products', async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT id, name, price::text, daily_rate::text AS "dailyRate", duration_days AS "durationDays",
      description, image_url AS "imageUrl", status, available_from AS "availableFrom", available_until AS "availableUntil",
      display_order AS "displayOrder", created_at AS "createdAt"
      FROM products ORDER BY display_order, created_at DESC`);
    response.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  price: z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/),
  dailyRate: z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/),
  durationDays: z.coerce.number().int().min(1).max(3650),
  description: z.string().trim().max(2000).default(''),
  status: z.enum(['AVAILABLE', 'COMING_SOON', 'DISABLED', 'DRAFT']).default('AVAILABLE'),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  availableFrom: z.string().datetime({ offset: true }).nullable().optional().or(z.literal('')),
  availableUntil: z.string().datetime({ offset: true }).nullable().optional().or(z.literal('')),
  displayOrder: z.coerce.number().int().min(0).default(0),
});

adminRouter.post('/products', async (request, response, next) => {
  try {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the product details.', code: 'VALIDATION_ERROR' });
    }
    const input = parsed.data;
    const result = await pool.query(`INSERT INTO products(
      name, price, daily_rate, duration_days, description, image_url, status, available_from, available_until, display_order
    ) VALUES ($1, $2::numeric, $3::numeric, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, name, price::text, daily_rate::text AS "dailyRate", duration_days AS "durationDays",
      description, image_url AS "imageUrl", status, available_from AS "availableFrom", available_until AS "availableUntil", display_order AS "displayOrder"`,
      [input.name, input.price, input.dailyRate, input.durationDays, input.description, input.imageUrl ?? null, input.status, input.availableFrom || null, input.availableUntil || null, input.displayOrder]);
    response.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

adminRouter.put('/products/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) {
      return response.status(400).json({ success: false, message: 'Invalid product.', code: 'VALIDATION_ERROR' });
    }
    const parsed = productSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the product update.', code: 'VALIDATION_ERROR' });
    }
    const updateData = { ...parsed.data };
    if (updateData.status === 'COMING_SOON'
      && (!updateData.availableFrom || new Date(updateData.availableFrom) <= new Date())) {
      updateData.availableFrom = null;
      updateData.availableUntil = null;
    }
    const values = [];
    const entries = [];
    for (const [key, value] of Object.entries(updateData)) {
      const column = {
        name: 'name',
        price: 'price',
        dailyRate: 'daily_rate',
        durationDays: 'duration_days',
        description: 'description',
        status: 'status',
        imageUrl: 'image_url',
        availableFrom: 'available_from',
        availableUntil: 'available_until',
        displayOrder: 'display_order',
      }[key];
      if (!column) continue;
      values.push(value ?? null);
      entries.push(`${column} = $${values.length}`);
    }
    if (!entries.length) {
      return response.status(400).json({ success: false, message: 'No product changes were provided.', code: 'VALIDATION_ERROR' });
    }
    values.push(id.data);
    const result = await pool.query(`UPDATE products SET ${entries.join(', ')}, updated_at = now() WHERE id = $${values.length}
      RETURNING id, name, price::text, daily_rate::text AS "dailyRate", duration_days AS "durationDays",
      description, image_url AS "imageUrl", status, available_from AS "availableFrom", available_until AS "availableUntil", display_order AS "displayOrder"`, values);
    if (!result.rowCount) {
      return response.status(404).json({ success: false, message: 'Product not found.', code: 'NOT_FOUND' });
    }
    response.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/payment-methods', async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT id, name, type, account_number AS "accountNumber", account_name AS "accountName",
      bank_code AS "bankCode", phone_number AS "phoneNumber", instructions, logo_url AS "logoUrl", is_active AS "isActive",
      display_order AS "displayOrder" FROM payment_methods ORDER BY display_order, name`);
    response.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

const paymentMethodSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.string().trim().min(2).max(40),
  accountNumber: z.string().trim().max(120).nullable().optional(),
  accountName: z.string().trim().max(120).nullable().optional(),
  bankCode: z.string().trim().max(40).nullable().optional(),
  phoneNumber: z.string().trim().max(40).nullable().optional(),
  instructions: z.string().trim().max(2000).default(''),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).default(0),
});

adminRouter.post('/payment-methods', async (request, response, next) => {
  try {
    const parsed = paymentMethodSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the payment method.', code: 'VALIDATION_ERROR' });
    }
    const input = parsed.data;
    const result = await pool.query(`INSERT INTO payment_methods(name, type, account_number, account_name, bank_code, phone_number, instructions, is_active, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, type, account_number AS "accountNumber", account_name AS "accountName", bank_code AS "bankCode",
      phone_number AS "phoneNumber", instructions, is_active AS "isActive", display_order AS "displayOrder"`,
      [input.name, input.type, input.accountNumber ?? null, input.accountName ?? null, input.bankCode ?? null, input.phoneNumber ?? null, input.instructions, input.isActive, input.displayOrder]);
    response.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

adminRouter.put('/payment-methods/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) {
      return response.status(400).json({ success: false, message: 'Invalid payment method.', code: 'VALIDATION_ERROR' });
    }
    const parsed = paymentMethodSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the payment method update.', code: 'VALIDATION_ERROR' });
    }
    const values = [];
    const entries = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      const column = {
        name: 'name',
        type: 'type',
        accountNumber: 'account_number',
        accountName: 'account_name',
        bankCode: 'bank_code',
        phoneNumber: 'phone_number',
        instructions: 'instructions',
        isActive: 'is_active',
        displayOrder: 'display_order',
      }[key];
      if (!column) continue;
      values.push(value ?? null);
      entries.push(`${column} = $${values.length}`);
    }
    if (!entries.length) {
      return response.status(400).json({ success: false, message: 'No payment-method changes were provided.', code: 'VALIDATION_ERROR' });
    }
    values.push(id.data);
    const result = await pool.query(`UPDATE payment_methods SET ${entries.join(', ')}, updated_at = now() WHERE id = $${values.length}
      RETURNING id, name, type, account_number AS "accountNumber", account_name AS "accountName", bank_code AS "bankCode",
      phone_number AS "phoneNumber", instructions, is_active AS "isActive", display_order AS "displayOrder"`, values);
    if (!result.rowCount) {
      return response.status(404).json({ success: false, message: 'Payment method not found.', code: 'NOT_FOUND' });
    }
    response.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/audit-logs', async (request, response, next) => {
  try {
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().refine((value) => [5, 10, 25, 50, 100].includes(value)).default(25),
      action: z.string().trim().max(120).optional(),
      entityType: z.string().trim().max(80).optional(),
      search: z.string().trim().max(120).optional(),
    }).safeParse(request.query);
    if (!query.success) {
      return response.status(400).json({ success: false, message: 'Invalid pagination.', code: 'VALIDATION_ERROR' });
    }
    const { page, limit, action, entityType, search } = query.data;
    const offset = (page - 1) * limit;
    const values = [];
    const conditions = [];
    const bind = (value) => { values.push(value); return `$${values.length}`; };
    if (action) conditions.push(`audit.action ILIKE ${bind(`%${action}%`)}`);
    if (entityType) conditions.push(`audit.entity_type ILIKE ${bind(`%${entityType}%`)}`);
    if (search) conditions.push(`(audit.action ILIKE ${bind(`%${search}%`)} OR audit.entity_type ILIKE ${bind(`%${search}%`)} OR admin.full_name ILIKE ${bind(`%${search}%`)})`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParameter = bind(limit);
    const offsetParameter = bind(offset);
    const result = await pool.query(`SELECT audit.id, audit.admin_id AS "adminId", admin.full_name AS "adminName",
      audit.action, audit.entity_type AS "entityType", audit.entity_id AS "entityId",
      audit.old_value AS "oldValue", audit.new_value AS "newValue", audit.created_at AS "createdAt"
      FROM audit_logs audit
      LEFT JOIN users admin ON admin.id = audit.admin_id
      ${where} ORDER BY audit.created_at DESC LIMIT ${limitParameter} OFFSET ${offsetParameter}`, values);
    const total = await pool.query(`SELECT count(*)::int AS total FROM audit_logs audit LEFT JOIN users admin ON admin.id = audit.admin_id ${where}`, values.slice(0, values.length - 2));
    response.json({ success: true, data: { items: result.rows, pagination: { page, limit, total: total.rows[0].total, pages: Math.ceil(total.rows[0].total / limit) } } });
  } catch (error) {
    next(error);
  }
});

const adminSettingsKeys = [
  'registration_bonus',
  'minimum_withdrawal_balance',
  'minimum_recharge_amount',
  'maximum_recharge_amount',
  'daily_recharge_limit',
  'monthly_recharge_limit',
  'maximum_pending_recharges',
  'maximum_withdrawal',
  'withdrawal_fee',
  'milestone_recharge_threshold',
  'milestone_reward_amount',
  'secondary_milestone_threshold',
  'weekly_reward_rate',
  'referral_rates',
  'app_download_url',
];

const adminSettingsSchema = z.object({
  registrationBonus: z.coerce.number().min(0).optional(),
  minimumWithdrawalBalance: z.coerce.number().min(0).optional(),
  minimumRechargeAmount: z.coerce.number().min(0).optional(),
  maximumRechargeAmount: z.coerce.number().min(0).optional(),
  dailyRechargeLimit: z.coerce.number().min(0).optional(),
  monthlyRechargeLimit: z.coerce.number().min(0).optional(),
  maximumPendingRecharges: z.coerce.number().int().min(0).optional(),
  maximumWithdrawal: z.coerce.number().min(0).optional(),
  withdrawalFee: z.coerce.number().min(0).max(100).optional(),
  milestoneRechargeThreshold: z.coerce.number().min(0).optional(),
  milestoneRewardAmount: z.coerce.number().min(0).optional(),
  secondaryMilestoneThreshold: z.coerce.number().min(0).optional(),
  weeklyRewardRate: z.coerce.number().min(0).optional(),
  referralRates: z.object({ A: z.coerce.number().min(0), B: z.coerce.number().min(0), C: z.coerce.number().min(0) }).optional(),
  appDownloadUrl: z.string().trim().max(500).nullish(),
});

adminRouter.get('/settings', async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT key, value #>> '{}' AS value FROM settings WHERE key = ANY($1::text[])`, [adminSettingsKeys]);
    const payload = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
    response.json({ success: true, data: normalizeAdminSettings(payload) });
  } catch (error) {
    next(error);
  }
});

adminRouter.put('/settings', async (request, response, next) => {
  try {
    const parsed = adminSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the admin settings.', code: 'VALIDATION_ERROR' });
    }

    const incoming = parsed.data;
    const updates = [
      ['registration_bonus', incoming.registrationBonus],
      ['minimum_withdrawal_balance', incoming.minimumWithdrawalBalance],
      ['minimum_recharge_amount', incoming.minimumRechargeAmount],
      ['maximum_recharge_amount', incoming.maximumRechargeAmount],
      ['daily_recharge_limit', incoming.dailyRechargeLimit],
      ['monthly_recharge_limit', incoming.monthlyRechargeLimit],
      ['maximum_pending_recharges', incoming.maximumPendingRecharges],
      ['maximum_withdrawal', incoming.maximumWithdrawal],
      ['withdrawal_fee', incoming.withdrawalFee],
      ['milestone_recharge_threshold', incoming.milestoneRechargeThreshold],
      ['milestone_reward_amount', incoming.milestoneRewardAmount],
      ['secondary_milestone_threshold', incoming.secondaryMilestoneThreshold],
      ['weekly_reward_rate', incoming.weeklyRewardRate],
      ['referral_rates', incoming.referralRates ? JSON.stringify(incoming.referralRates) : undefined],
      ['app_download_url', incoming.appDownloadUrl ?? undefined],
    ].filter(([, value]) => value !== undefined);

    if (!updates.length) {
      return response.status(400).json({ success: false, message: 'No settings were provided.', code: 'VALIDATION_ERROR' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of updates) {
        await client.query(
          `INSERT INTO settings(key, value, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), request.auth.userId],
        );
      }
      await client.query('COMMIT');
      response.json({ success: true, data: { updated: updates.length } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

const publicLinksSchema = z.array(z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(500),
  description: z.string().trim().max(400).default(''),
  enabled: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).default(0),
  target: z.enum(['_blank', '_self']).default('_blank'),
})).max(200);

adminRouter.get('/settings/links', async (_request, response, next) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'public_links'");
    const payload = result.rows[0]?.value ?? [];
    const normalized = normalizePublicLinks(payload);
    response.json({ success: true, data: { items: normalized } });
  } catch (error) {
    next(error);
  }
});

adminRouter.put('/settings/links', async (request, response, next) => {
  try {
    const source = Array.isArray(request.body) ? request.body : request.body?.publicLinks ?? [];
    const parsed = publicLinksSchema.safeParse(source);
    if (!parsed.success) {
      return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the public links.', code: 'VALIDATION_ERROR' });
    }

    const sanitized = normalizePublicLinks(parsed.data);
    await pool.query(
      `INSERT INTO settings(key, value, updated_by, updated_at)
       VALUES ('public_links', $1::jsonb, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(sanitized), request.auth.userId],
    );

    response.json({ success: true, data: { items: sanitized } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// ADMIN PROFILE MANAGEMENT
// ---------------------------------------------------------------------------

adminRouter.get('/profile', async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name AS "fullName", phone_number AS "phoneNumber",
              referral_code AS "referralCode", role, status,
              coalesce(is_super_admin, false) AS "isSuperAdmin",
              coalesce(privileges, '[]'::jsonb) AS privileges,
              created_at AS "registeredAt"
       FROM users WHERE id = $1 AND role = 'ADMIN'`,
      [request.auth.userId],
    );
    if (!result.rowCount) {
      return response.status(404).json({ success: false, message: 'Admin profile not found.', code: 'NOT_FOUND' });
    }
    const admin = result.rows[0];
    response.json({
      success: true,
      data: {
        ...admin,
        phoneNumber: String(admin.phoneNumber ?? '').trim(),
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/profile', async (request, response, next) => {
  try {
    const parsed = z.object({
      fullName: z.string().trim().min(2).max(120),
      phoneNumber: z.string().regex(/^[97][0-9]{8}$/, 'Enter a valid 9-digit Ethiopian phone number.').optional(),
    }).safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? 'Invalid profile input.',
        code: 'VALIDATION_ERROR',
      });
    }

    const { fullName, phoneNumber } = parsed.data;

    const updated = await inTransaction(async (client) => {
      const existing = await client.query("SELECT full_name, phone_number FROM users WHERE id = $1 AND role = 'ADMIN' FOR UPDATE", [request.auth.userId]);
      if (!existing.rowCount) {
        throw Object.assign(new Error('Admin not found.'), { status: 404, code: 'NOT_FOUND' });
      }

      if (phoneNumber && phoneNumber !== String(existing.rows[0].phone_number).trim()) {
        const phoneCheck = await client.query("SELECT 1 FROM users WHERE phone_number = $1 AND id <> $2", [phoneNumber, request.auth.userId]);
        if (phoneCheck.rowCount) {
          throw Object.assign(new Error('That phone number is already registered to another account.'), { status: 409, code: 'PHONE_NUMBER_IN_USE' });
        }
      }

      const phoneToSet = phoneNumber || String(existing.rows[0].phone_number).trim();
      const res = await client.query(
        `UPDATE users SET full_name = $2, phone_number = $3, updated_at = now()
         WHERE id = $1
         RETURNING id, full_name AS "fullName", phone_number AS "phoneNumber", referral_code AS "referralCode",
                   role, status, coalesce(is_super_admin, false) AS "isSuperAdmin", coalesce(privileges, '[]'::jsonb) AS privileges,
                   created_at AS "registeredAt"`,
        [request.auth.userId, fullName, phoneToSet],
      );

      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          request.auth.userId,
          'ADMIN_PROFILE_UPDATE',
          'user',
          request.auth.userId,
          { fullName: existing.rows[0].full_name, phoneNumber: String(existing.rows[0].phone_number).trim() },
          { fullName, phoneNumber: phoneToSet },
        ],
      );

      return res.rows[0];
    });

    response.json({
      success: true,
      data: {
        ...updated,
        phoneNumber: String(updated.phoneNumber ?? '').trim(),
      },
    });
  } catch (error) {
    next(error);
  }
});

const adminPasswordRateLimit = createUserRateLimit({ limit: 10 });
adminRouter.patch('/profile/password', adminPasswordRateLimit, async (request, response, next) => {
  try {
    const parsed = z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: z.string().min(6).max(128),
      confirmNewPassword: z.string().min(6).max(128),
    }).refine((value) => value.newPassword === value.confirmNewPassword, {
      path: ['confirmNewPassword'],
      message: 'New passwords do not match.',
    }).safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? 'Invalid password details.',
        code: 'VALIDATION_ERROR',
      });
    }

    await inTransaction(async (client) => {
      const userRes = await client.query("SELECT password_hash FROM users WHERE id = $1 AND role = 'ADMIN' FOR UPDATE", [request.auth.userId]);
      if (!userRes.rowCount) {
        throw Object.assign(new Error('Admin not found.'), { status: 404, code: 'NOT_FOUND' });
      }

      const verified = await argon2.verify(userRes.rows[0].password_hash, parsed.data.currentPassword);
      if (!verified) {
        throw Object.assign(new Error('Current password is incorrect.'), { status: 400, code: 'INVALID_PASSWORD' });
      }

      const newHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
      await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [newHash, request.auth.userId]);
      await client.query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [request.auth.userId, request.auth.sessionId]);

      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [request.auth.userId, 'ADMIN_PASSWORD_CHANGE', 'user', request.auth.userId, null, { passwordChanged: true, otherSessionsRevoked: true }],
      );
    });

    response.json({ success: true, data: { passwordChanged: true, otherSessionsRevoked: true } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// ADMIN USER & PRIVILEGE MANAGEMENT
// ---------------------------------------------------------------------------

const adminCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phoneNumber: z.string().regex(/^[97][0-9]{8}$/, 'Enter a valid 9-digit Ethiopian phone number.'),
  password: z.string().min(6).max(128),
  confirmPassword: z.string().min(6).max(128),
  isSuperAdmin: z.boolean().default(false),
  privileges: z.array(z.string()).default([]),
}).refine((data) => data.password === data.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Passwords do not match.',
});

adminRouter.get('/admins', requireAdminPrivilege('ADMIN_VIEW'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT id, full_name AS "fullName", phone_number AS "phoneNumber",
             role, status, coalesce(is_super_admin, false) AS "isSuperAdmin",
             coalesce(privileges, '[]'::jsonb) AS privileges,
             created_at AS "registeredAt"
      FROM users
      WHERE role = 'ADMIN'
      ORDER BY is_super_admin DESC, created_at ASC
    `);
    response.json({
      success: true,
      data: result.rows.map((row) => ({
        ...row,
        phoneNumber: String(row.phoneNumber ?? '').trim(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/admins', requireAdminPrivilege('ADMIN_CREATE'), async (request, response, next) => {
  try {
    const parsed = adminCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? 'Invalid admin payload.',
        code: 'VALIDATION_ERROR',
      });
    }

    const { fullName, phoneNumber, password, isSuperAdmin, privileges } = parsed.data;

    // Privilege escalation prevention
    if (isSuperAdmin && !request.auth.isSuperAdmin) {
      return response.status(403).json({
        success: false,
        message: 'Only a Super Administrator can create another Super Administrator.',
        code: 'SUPER_ADMIN_REQUIRED',
      });
    }

    const normalizedPrivs = normalizePrivileges(privileges);
    if (!request.auth.isSuperAdmin) {
      const allowedSet = new Set(request.auth.privileges ?? []);
      for (const priv of normalizedPrivs) {
        if (!allowedSet.has(priv) && !allowedSet.has('*')) {
          return response.status(403).json({
            success: false,
            message: `You cannot grant privilege '${priv}' which you do not possess.`,
            code: 'CANNOT_GRANT_UNOWNED_PRIVILEGE',
          });
        }
      }
    }

    const newAdmin = await inTransaction(async (client) => {
      const phoneCheck = await client.query('SELECT 1 FROM users WHERE phone_number = $1', [phoneNumber]);
      if (phoneCheck.rowCount) {
        throw Object.assign(new Error('That phone number is already registered.'), { status: 409, code: 'PHONE_NUMBER_IN_USE' });
      }

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const referralCode = 'ADM-' + crypto.randomBytes(4).toString('hex').toUpperCase();

      const insertRes = await client.query(
        `INSERT INTO users (full_name, phone_number, password_hash, referral_code, role, status, is_super_admin, privileges)
         VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE', $5, $6::jsonb)
         RETURNING id, full_name AS "fullName", phone_number AS "phoneNumber", role, status,
                   is_super_admin AS "isSuperAdmin", privileges, created_at AS "registeredAt"`,
        [fullName, phoneNumber, passwordHash, referralCode, isSuperAdmin, JSON.stringify(isSuperAdmin ? ['*'] : normalizedPrivs)],
      );

      const created = insertRes.rows[0];
      await client.query('INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [created.id]);

      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          request.auth.userId,
          'ADMIN_CREATE',
          'user',
          created.id,
          null,
          { fullName, phoneNumber, role: 'ADMIN', isSuperAdmin, privileges: isSuperAdmin ? ['*'] : normalizedPrivs },
        ],
      );

      return created;
    });

    response.status(201).json({
      success: true,
      data: {
        ...newAdmin,
        phoneNumber: String(newAdmin.phoneNumber ?? '').trim(),
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/admins/:id', requireAdminPrivilege('ADMIN_MANAGE'), async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) {
      return response.status(400).json({ success: false, message: 'Invalid admin ID.', code: 'VALIDATION_ERROR' });
    }

    const parsedBody = z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      phoneNumber: z.string().regex(/^[97][0-9]{8}$/, 'Enter a valid 9-digit Ethiopian phone number.').optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
      isSuperAdmin: z.boolean().optional(),
      privileges: z.array(z.string()).optional(),
    }).safeParse(request.body);

    if (!parsedBody.success) {
      return response.status(400).json({
        success: false,
        message: parsedBody.error.issues[0]?.message ?? 'Invalid update payload.',
        code: 'VALIDATION_ERROR',
      });
    }

    const { fullName, phoneNumber, status: newStatus, isSuperAdmin, privileges } = parsedBody.data;

    const updated = await inTransaction(async (client) => {
      const existingRes = await client.query(
        "SELECT id, full_name, phone_number, role, status, is_super_admin, privileges FROM users WHERE id = $1 AND role = 'ADMIN' FOR UPDATE",
        [parsedId.data],
      );
      if (!existingRes.rowCount) {
        throw Object.assign(new Error('Admin not found.'), { status: 404, code: 'NOT_FOUND' });
      }
      const target = existingRes.rows[0];

      // Super admin protection: non-super admin cannot edit a super admin
      if (target.is_super_admin && !request.auth.isSuperAdmin) {
        throw Object.assign(new Error('Only a Super Administrator can modify another Super Administrator.'), {
          status: 403,
          code: 'CANNOT_MODIFY_SUPER_ADMIN',
        });
      }

      // Cannot promote to super admin if not super admin
      if (isSuperAdmin === true && !request.auth.isSuperAdmin) {
        throw Object.assign(new Error('Only a Super Administrator can grant Super Administrator privileges.'), {
          status: 403,
          code: 'SUPER_ADMIN_REQUIRED',
        });
      }

      // Self-modification safety
      const isSelf = target.id === request.auth.userId;
      if (isSelf) {
        if (newStatus && newStatus !== 'ACTIVE') {
          throw Object.assign(new Error('You cannot deactivate or suspend your own administrative account.'), {
            status: 400,
            code: 'CANNOT_DEACTIVATE_SELF',
          });
        }
        if (isSuperAdmin === false && target.is_super_admin) {
          throw Object.assign(new Error('You cannot remove your own Super Administrator status.'), {
            status: 400,
            code: 'CANNOT_DEMOTE_SELF',
          });
        }
      }

      // Last admin protection: check remaining active super admins or admin managers
      if ((newStatus && newStatus !== 'ACTIVE') || (isSuperAdmin === false && target.is_super_admin)) {
        const remainingCheck = await client.query(
          `SELECT count(*)::int AS count FROM users
           WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1
             AND (is_super_admin = true OR privileges ? 'ADMIN_MANAGE' OR privileges ? '*')`,
          [target.id],
        );
        if (remainingCheck.rows[0].count === 0) {
          throw Object.assign(new Error('Cannot deactivate or remove privileges from the last active administrator with management rights.'), {
            status: 400,
            code: 'LAST_ADMIN_PROTECTION',
          });
        }
      }

      // Check privileges being granted
      let normalizedPrivs = undefined;
      if (privileges !== undefined) {
        normalizedPrivs = normalizePrivileges(privileges);
        if (!request.auth.isSuperAdmin) {
          const allowedSet = new Set(request.auth.privileges ?? []);
          for (const priv of normalizedPrivs) {
            if (!allowedSet.has(priv) && !allowedSet.has('*')) {
              throw Object.assign(new Error(`You cannot grant privilege '${priv}' which you do not possess.`), {
                status: 403,
                code: 'CANNOT_GRANT_UNOWNED_PRIVILEGE',
              });
            }
          }
        }
      }

      // Phone uniqueness check
      if (phoneNumber && phoneNumber !== String(target.phone_number).trim()) {
        const phoneCheck = await client.query('SELECT 1 FROM users WHERE phone_number = $1 AND id <> $2', [phoneNumber, target.id]);
        if (phoneCheck.rowCount) {
          throw Object.assign(new Error('That phone number is already in use.'), { status: 409, code: 'PHONE_NUMBER_IN_USE' });
        }
      }

      const nextName = fullName ?? target.full_name;
      const nextPhone = phoneNumber ?? String(target.phone_number).trim();
      const nextStatus = newStatus ?? target.status;
      const nextSuper = isSuperAdmin ?? target.is_super_admin;
      const nextPrivs = nextSuper ? ['*'] : (normalizedPrivs ?? target.privileges);

      const updateRes = await client.query(
        `UPDATE users
         SET full_name = $2, phone_number = $3, status = $4, is_super_admin = $5, privileges = $6::jsonb, updated_at = now()
         WHERE id = $1
         RETURNING id, full_name AS "fullName", phone_number AS "phoneNumber", role, status,
                   is_super_admin AS "isSuperAdmin", privileges, created_at AS "registeredAt"`,
        [target.id, nextName, nextPhone, nextStatus, nextSuper, JSON.stringify(nextPrivs)],
      );

      // If status became inactive, revoke sessions
      let sessionsRevoked = 0;
      if (nextStatus !== 'ACTIVE') {
        const sessionRes = await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [target.id]);
        sessionsRevoked = sessionRes.rowCount;
      }

      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          request.auth.userId,
          nextStatus !== 'ACTIVE' ? 'ADMIN_DEACTIVATE' : 'ADMIN_UPDATE',
          'user',
          target.id,
          { fullName: target.full_name, phoneNumber: target.phone_number, status: target.status, isSuperAdmin: target.is_super_admin, privileges: target.privileges },
          { fullName: nextName, phoneNumber: nextPhone, status: nextStatus, isSuperAdmin: nextSuper, privileges: nextPrivs, sessionsRevoked },
        ],
      );

      return updateRes.rows[0];
    });

    response.json({
      success: true,
      data: {
        ...updated,
        phoneNumber: String(updated.phoneNumber ?? '').trim(),
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete('/admins/:id', requireAdminPrivilege('ADMIN_MANAGE'), async (request, response, next) => {
  try {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) {
      return response.status(400).json({ success: false, message: 'Invalid admin ID.', code: 'VALIDATION_ERROR' });
    }

    if (parsedId.data === request.auth.userId) {
      return response.status(400).json({
        success: false,
        message: 'You cannot deactivate your own administrative account.',
        code: 'CANNOT_DEACTIVATE_SELF',
      });
    }

    const updated = await inTransaction(async (client) => {
      const existingRes = await client.query(
        "SELECT id, full_name, phone_number, role, status, is_super_admin FROM users WHERE id = $1 AND role = 'ADMIN' FOR UPDATE",
        [parsedId.data],
      );
      if (!existingRes.rowCount) {
        throw Object.assign(new Error('Admin not found.'), { status: 404, code: 'NOT_FOUND' });
      }
      const target = existingRes.rows[0];

      if (target.is_super_admin && !request.auth.isSuperAdmin) {
        throw Object.assign(new Error('Only a Super Administrator can deactivate another Super Administrator.'), {
          status: 403,
          code: 'CANNOT_MODIFY_SUPER_ADMIN',
        });
      }

      if (target.status === 'DEACTIVATED') {
        throw Object.assign(new Error('Admin is already deactivated.'), { status: 409, code: 'ADMIN_ALREADY_DEACTIVATED' });
      }

      // Last admin check
      const remainingCheck = await client.query(
        `SELECT count(*)::int AS count FROM users
         WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1
           AND (is_super_admin = true OR privileges ? 'ADMIN_MANAGE' OR privileges ? '*')`,
        [target.id],
      );
      if (remainingCheck.rows[0].count === 0) {
        throw Object.assign(new Error('Cannot deactivate the last active administrator with management rights.'), {
          status: 400,
          code: 'LAST_ADMIN_PROTECTION',
        });
      }

      await client.query("UPDATE users SET status = 'DEACTIVATED', updated_at = now() WHERE id = $1", [target.id]);
      const sessionRes = await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [target.id]);

      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          request.auth.userId,
          'ADMIN_DEACTIVATE',
          'user',
          target.id,
          { status: target.status },
          { status: 'DEACTIVATED', sessionsRevoked: sessionRes.rowCount },
        ],
      );

      return {
        id: target.id,
        fullName: target.full_name,
        status: 'DEACTIVATED',
        sessionsRevoked: sessionRes.rowCount,
      };
    });

    response.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});
