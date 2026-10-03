import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReferralCode } from '../src/routes/auth.js';

test('referral codes are normalized to the MKM format', () => {
  assert.equal(normalizeReferralCode('mkm-abc123'), 'MKM-ABC123');
});

test('invalid referral codes are rejected', () => {
  assert.throws(() => normalizeReferralCode('bad-code'), /Referral code is invalid/);
});
