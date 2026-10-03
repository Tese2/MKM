import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePaymentMethodDetails } from '../src/lib/paymentMethodDetails.js';

test('bank methods resolve to account-based copy values', () => {
  const details = resolvePaymentMethodDetails({
    name: 'CBE',
    account_number: '1000419637649',
    account_name: 'Tesema',
    phone_number: null,
  });

  assert.equal(details.copyLabel, 'Copy account number');
  assert.equal(details.copyValue, '1000419637649');
  assert.equal(details.primaryFieldLabel, 'Account Number');
});

test('telebirr resolves to phone-based copy values', () => {
  const details = resolvePaymentMethodDetails({
    name: 'Telebirr',
    phone_number: '0929688828',
    account_name: 'Markos',
  });

  assert.equal(details.copyLabel, 'Copy phone');
  assert.equal(details.copyValue, '0929688828');
  assert.equal(details.primaryFieldLabel, 'Phone Number');
});
