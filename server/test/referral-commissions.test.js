import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReferralCommissions } from '../src/lib/referralEngine.js';

test('referral commission totals match the configured level rates', () => {
  const commissions = buildReferralCommissions({
    rechargeAmount: '2000.00',
    sponsorLevels: [
      { userId: '11111111-1111-4111-8111-111111111111', level: 'A' },
      { userId: '22222222-2222-4222-8222-222222222222', level: 'B' },
      { userId: '33333333-3333-4333-8333-333333333333', level: 'C' },
    ],
    rates: { A: 22, B: 2, C: 1 },
  });

  assert.deepEqual(commissions.map((item) => ({ userId: item.userId, level: item.level, amount: item.amount })), [
    { userId: '11111111-1111-4111-8111-111111111111', level: 'A', amount: '440.00' },
    { userId: '22222222-2222-4222-8222-222222222222', level: 'B', amount: '40.00' },
    { userId: '33333333-3333-4333-8333-333333333333', level: 'C', amount: '20.00' },
  ]);
});
