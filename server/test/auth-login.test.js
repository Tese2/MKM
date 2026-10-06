import assert from 'node:assert/strict';
import test from 'node:test';
import { cookieOptions, inactiveCustomerMessage, isInactiveCustomer } from '../src/routes/auth.js';

test('deactivated account login message includes the admin reason', () => {
  assert.equal(
    inactiveCustomerMessage('  Verification documents were incomplete.  ', 'DEACTIVATED'),
    'Your account has been deactivated. Reason: Verification documents were incomplete.',
  );
});

test('deactivated account login message provides support guidance when no reason was recorded', () => {
  assert.equal(
    inactiveCustomerMessage(null, 'DEACTIVATED'),
    'Your account has been deactivated by an administrator. Please contact support for assistance.',
  );
});

test('inactive customer statuses are eligible for the deactivation reason response', () => {
  assert.equal(isInactiveCustomer({ role: 'CUSTOMER', status: 'DEACTIVATED' }), true);
  assert.equal(isInactiveCustomer({ role: 'CUSTOMER', status: 'SUSPENDED' }), true);
  assert.equal(isInactiveCustomer({ role: 'CUSTOMER', status: 'ACTIVE' }), false);
  assert.equal(isInactiveCustomer({ role: 'ADMIN', status: 'DEACTIVATED' }), false);
});

test('suspended customer message reflects the account status', () => {
  assert.equal(
    inactiveCustomerMessage('Additional verification required.', 'SUSPENDED'),
    'Your account has been suspended. Reason: Additional verification required.',
  );
});

test('local development cookies stay browser-compatible while production cookies remain cross-site', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousClientUrl = process.env.CLIENT_URL;

  try {
    delete process.env.NODE_ENV;
    delete process.env.CLIENT_URL;
    const local = cookieOptions();
    assert.equal(local.secure, false);
    assert.equal(local.sameSite, 'lax');

    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mkmroad.netlify.app';
    const production = cookieOptions();
    assert.equal(production.secure, true);
    assert.equal(production.sameSite, 'none');
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousClientUrl === undefined) delete process.env.CLIENT_URL; else process.env.CLIENT_URL = previousClientUrl;
  }
});
