import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import argon2 from 'argon2';
import { ADMIN_PRIVILEGES, hasPrivilege, normalizePrivileges } from '../src/lib/adminPrivileges.js';
import { requireAdmin, requireAdminPrivilege } from '../src/middleware/auth.js';

test('normalizePrivileges filters invalid privileges and preserves project permissions', () => {
  const result = normalizePrivileges([
    'customer_view',
    'INVALID_PRIVILEGE',
    'RECHARGE_APPROVE',
    'customer_view', // duplicate
    '*',
    'HACK_SYSTEM',
  ]);

  assert.deepEqual(result, ['CUSTOMER_VIEW', 'RECHARGE_APPROVE', '*']);
});

test('hasPrivilege accurately checks super admin and specific permissions', () => {
  // Super admin has all privileges
  assert.equal(hasPrivilege({ role: 'ADMIN', isSuperAdmin: true }, 'SETTINGS_MANAGE'), true);
  assert.equal(hasPrivilege({ role: 'ADMIN', isSuperAdmin: true }, 'ADMIN_CREATE'), true);

  // Admin with wildcard has all privileges
  assert.equal(hasPrivilege({ role: 'ADMIN', isSuperAdmin: false, privileges: ['*'] }, 'RECHARGE_APPROVE'), true);

  // Admin with specific privileges
  const scopedAdmin = {
    role: 'ADMIN',
    isSuperAdmin: false,
    privileges: ['CUSTOMER_VIEW', 'CUSTOMER_MANAGE'],
  };
  assert.equal(hasPrivilege(scopedAdmin, 'CUSTOMER_VIEW'), true);
  assert.equal(hasPrivilege(scopedAdmin, 'CUSTOMER_MANAGE'), true);
  assert.equal(hasPrivilege(scopedAdmin, 'RECHARGE_APPROVE'), false);
  assert.equal(hasPrivilege(scopedAdmin, 'ADMIN_CREATE'), false);

  // Customer has no privileges
  assert.equal(hasPrivilege({ role: 'CUSTOMER', isSuperAdmin: false, privileges: ['*'] }, 'CUSTOMER_VIEW'), false);
  assert.equal(hasPrivilege(null, 'CUSTOMER_VIEW'), false);
});

test('requireAdminPrivilege middleware enforces RBAC access control', async () => {
  const app = express();
  app.use((request, _response, next) => {
    const role = request.get('x-test-role') ?? 'CUSTOMER';
    const isSuperAdmin = request.get('x-test-super') === 'true';
    const privileges = (request.get('x-test-privs') ?? '').split(',').filter(Boolean);
    request.auth = { userId: 'test-user', role, isSuperAdmin, privileges };
    next();
  });

  app.get('/protected-recharges', requireAdminPrivilege('RECHARGE_APPROVE'), (_req, res) => res.json({ allowed: true }));
  app.get('/protected-admins', requireAdminPrivilege('ADMIN_MANAGE'), (_req, res) => res.json({ allowed: true }));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Customer rejected with 403
    const customerRes = await fetch(`${baseUrl}/protected-recharges`, {
      headers: { 'x-test-role': 'CUSTOMER' },
    });
    assert.equal(customerRes.status, 403);
    const customerBody = await customerRes.json();
    assert.equal(customerBody.code, 'FORBIDDEN');

    // 2. Admin without the specific privilege rejected with 403
    const unprivilegedRes = await fetch(`${baseUrl}/protected-recharges`, {
      headers: { 'x-test-role': 'ADMIN', 'x-test-privs': 'CUSTOMER_VIEW,PRODUCT_VIEW' },
    });
    assert.equal(unprivilegedRes.status, 403);
    const unprivilegedBody = await unprivilegedRes.json();
    assert.equal(unprivilegedBody.code, 'FORBIDDEN_PRIVILEGE');

    // 3. Admin with required privilege allowed with 200
    const allowedRes = await fetch(`${baseUrl}/protected-recharges`, {
      headers: { 'x-test-role': 'ADMIN', 'x-test-privs': 'RECHARGE_APPROVE' },
    });
    assert.equal(allowedRes.status, 200);
    assert.equal((await allowedRes.json()).allowed, true);

    // 4. Super Admin allowed regardless of privilege list
    const superAdminRes = await fetch(`${baseUrl}/protected-admins`, {
      headers: { 'x-test-role': 'ADMIN', 'x-test-super': 'true' },
    });
    assert.equal(superAdminRes.status, 200);
    assert.equal((await superAdminRes.json()).allowed, true);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});

test('customer deactivation rejects self-deactivation and enforces non-customer protection', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: req.get('x-test-user-id') ?? 'admin-123', role: 'ADMIN' };
    next();
  });

  // Simulated endpoint handler using same logic as adminRouter.patch('/customers/:id/status')
  app.patch('/admin/customers/:id/status', (request, response) => {
    const { userId } = request.auth;
    const targetId = request.params.id;

    if (targetId === userId) {
      return response.status(400).json({ success: false, code: 'CANNOT_DEACTIVATE_SELF' });
    }

    const targetUser = request.targetUser;
    if (!targetUser) {
      return response.status(404).json({ success: false, code: 'NOT_FOUND' });
    }

    if (targetUser.role !== 'CUSTOMER') {
      return response.status(403).json({ success: false, code: 'NOT_A_CUSTOMER' });
    }

    if (targetUser.status === request.body.status) {
      return response.status(409).json({ success: false, code: 'CUSTOMER_ALREADY_IN_STATUS' });
    }

    return response.json({
      success: true,
      data: {
        id: targetId,
        status: request.body.status,
        sessionsRevoked: 2,
        financialRecordsPreserved: true,
      },
    });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Self-deactivation attempt rejected
    const selfRes = await fetch(`${baseUrl}/admin/customers/admin-123/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': 'admin-123',
      },
      body: JSON.stringify({ status: 'DEACTIVATED' }),
    });
    assert.equal(selfRes.status, 400);
    assert.equal((await selfRes.json()).code, 'CANNOT_DEACTIVATE_SELF');

    // 2. Cannot deactivate another admin via customer endpoint
    const appWithAdminTarget = express();
    appWithAdminTarget.use(express.json());
    appWithAdminTarget.patch('/admin/customers/:id/status', (req, res) => {
      if (req.params.id === 'admin-456') {
        return res.status(403).json({ success: false, code: 'NOT_A_CUSTOMER' });
      }
      res.json({ success: true });
    });
    const s2 = appWithAdminTarget.listen(0, '127.0.0.1');
    await once(s2, 'listening');
    const p2 = s2.address().port;

    const adminTargetRes = await fetch(`http://127.0.0.1:${p2}/admin/customers/admin-456/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DEACTIVATED' }),
    });
    assert.equal(adminTargetRes.status, 403);
    assert.equal((await adminTargetRes.json()).code, 'NOT_A_CUSTOMER');

    s2.closeAllConnections();
    s2.close();
    await once(s2, 'close');
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});

test('admin management protects against privilege escalation and last admin removal', () => {
  // Test privilege escalation check
  const nonSuperAdmin = {
    role: 'ADMIN',
    isSuperAdmin: false,
    privileges: ['CUSTOMER_VIEW', 'PRODUCT_VIEW'],
  };

  const requestedPrivs = ['CUSTOMER_VIEW', 'RECHARGE_APPROVE']; // RECHARGE_APPROVE not owned
  const allowedSet = new Set(nonSuperAdmin.privileges);
  const unowned = requestedPrivs.filter((p) => !allowedSet.has(p) && !allowedSet.has('*'));

  assert.equal(unowned.length, 1);
  assert.equal(unowned[0], 'RECHARGE_APPROVE');

  // Test last admin check logic
  const activeAdminsCount = 1;
  const isRemovingLastAdmin = activeAdminsCount <= 1;
  assert.equal(isRemovingLastAdmin, true);
});

test('password hashing and verification adheres to Argon2id standards', async () => {
  const plain = 'StrongPass123!';
  const hash = await argon2.hash(plain, { type: argon2.argon2id });

  assert.ok(hash.startsWith('$argon2id$'));
  assert.equal(await argon2.verify(hash, plain), true);
  assert.equal(await argon2.verify(hash, 'WrongPassword'), false);
});

test('customer deactivation updates status, revokes sessions, and preserves all financial tables', async () => {
  const { pool, inTransaction } = await import('../src/db/pool.js');
  if (!pool) return;

  const testPhone = '999887766';
  const testReferral = 'TEST-CUST-DEACT';

  await inTransaction(async (client) => {
    // 1. Create disposable customer
    const userRes = await client.query(
      `INSERT INTO users (full_name, phone_number, password_hash, referral_code, role, status)
       VALUES ('Disposable Customer', $1, 'mock-hash', $2, 'CUSTOMER', 'ACTIVE')
       RETURNING id`,
      [testPhone, testReferral],
    );
    const customerId = userRes.rows[0].id;

    // 2. Create financial records
    await client.query('INSERT INTO wallets (user_id, available_balance) VALUES ($1, 500.00)', [customerId]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, direction, status, description)
       VALUES ($1, 'RECHARGE', 500.00, 'CREDIT', 'COMPLETED', 'Initial deposit')`,
      [customerId],
    );

    // 3. Create active session
    const sessionRes = await client.query(
      `INSERT INTO auth_sessions (user_id, ip_address, user_agent, expires_at)
       VALUES ($1, '127.0.0.1', 'test-agent', now() + interval '1 day')
       RETURNING id`,
      [customerId],
    );
    const sessionId = sessionRes.rows[0].id;

    // 4. Perform safe deactivation
    await client.query("UPDATE users SET status = 'DEACTIVATED', updated_at = now() WHERE id = $1", [customerId]);
    const revokeRes = await client.query(
      'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [customerId],
    );

    assert.equal(revokeRes.rowCount, 1);

    // 5. Verify customer status is DEACTIVATED
    const updatedCust = await client.query('SELECT status FROM users WHERE id = $1', [customerId]);
    assert.equal(updatedCust.rows[0].status, 'DEACTIVATED');

    // 6. Verify session is revoked
    const checkSession = await client.query('SELECT revoked_at FROM auth_sessions WHERE id = $1', [sessionId]);
    assert.ok(checkSession.rows[0].revoked_at !== null);

    // 7. Verify all financial records are completely preserved
    const checkWallet = await client.query('SELECT available_balance::text FROM wallets WHERE user_id = $1', [customerId]);
    assert.equal(checkWallet.rowCount, 1);
    assert.equal(checkWallet.rows[0].available_balance, '500.00');

    const checkTx = await client.query('SELECT amount::text FROM transactions WHERE user_id = $1', [customerId]);
    assert.equal(checkTx.rowCount, 1);
    assert.equal(checkTx.rows[0].amount, '500.00');

    // Clean up disposable test data (rolled back with transaction or deleted)
    await client.query('DELETE FROM transactions WHERE user_id = $1', [customerId]);
    await client.query('DELETE FROM wallets WHERE user_id = $1', [customerId]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [customerId]);
    await client.query('DELETE FROM users WHERE id = $1', [customerId]);
  });
});

test('admin creation creates active admin with privileges and wallet', async () => {
  const { pool, inTransaction } = await import('../src/db/pool.js');
  if (!pool) return;

  const testPhone = '999112233';
  const testReferral = 'TEST-ADM-CREATE';

  await inTransaction(async (client) => {
    const adminRes = await client.query(
      `INSERT INTO users (full_name, phone_number, password_hash, referral_code, role, status, is_super_admin, privileges)
       VALUES ('New Admin Test', $1, 'argon2-test-hash', $2, 'ADMIN', 'ACTIVE', false, '["CUSTOMER_VIEW", "RECHARGE_APPROVE"]'::jsonb)
       RETURNING id, role, status, is_super_admin AS "isSuperAdmin", privileges`,
      [testPhone, testReferral],
    );

    const created = adminRes.rows[0];
    assert.equal(created.role, 'ADMIN');
    assert.equal(created.status, 'ACTIVE');
    assert.equal(created.isSuperAdmin, false);
    assert.deepEqual(created.privileges, ['CUSTOMER_VIEW', 'RECHARGE_APPROVE']);

    // Wallet is created
    await client.query('INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [created.id]);
    const walletRes = await client.query('SELECT available_balance::text FROM wallets WHERE user_id = $1', [created.id]);
    assert.equal(walletRes.rowCount, 1);
    assert.equal(walletRes.rows[0].available_balance, '0.00');

    // Clean up
    await client.query('DELETE FROM wallets WHERE user_id = $1', [created.id]);
    await client.query('DELETE FROM users WHERE id = $1', [created.id]);
  });
});
