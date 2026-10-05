import assert from 'node:assert/strict';
import test from 'node:test';
import { inactiveCustomerMessage, isInactiveCustomer } from '../src/routes/auth.js';

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
