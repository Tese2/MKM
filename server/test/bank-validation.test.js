import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAccountNumber } from '../src/lib/bankValidation.js';

test('Awash account numbers accept the project’s real account lengths without malformed values', () => {
  assert.equal(validateAccountNumber('Awash Bank', '013201013577300'), true);
  assert.equal(validateAccountNumber('Awash Bank', '01320101357730'), true);
  assert.equal(validateAccountNumber('Awash Bank', '0132010135773'), false);
  assert.equal(validateAccountNumber('Awash Bank', '013201013577300A'), false);
});

test('CBE account numbers must be exactly 13 digits', () => {
  assert.equal(validateAccountNumber('CBE', '1000419637649'), true);
  assert.equal(validateAccountNumber('CBE', '100041963764'), false);
});

test('Telebirr account numbers must be exactly 10 digits', () => {
  assert.equal(validateAccountNumber('Telebirr', '0929688828'), true);
  assert.equal(validateAccountNumber('Telebirr', '929688828'), false);
});

test('Abyssinia account numbers must be 6 to 9 digits', () => {
  assert.equal(validateAccountNumber('Abyssinia Bank', '221759389'), true);
  assert.equal(validateAccountNumber('Abyssinia Bank', '12345'), false);
  assert.equal(validateAccountNumber('Abyssinia Bank', '1234567890'), false);
});
