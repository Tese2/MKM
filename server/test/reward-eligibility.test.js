import assert from 'node:assert/strict';
import test from 'node:test';
import { getReferredRechargeTotal } from '../src/services/rewardEligibility.js';

test('referred recharge total includes approved credited recharges through level C', async () => {
  let query;
  let params;
  const client = {
    async query(sql, values) {
      query = sql;
      params = values;
      return { rows: [{ total: '5000.00' }] };
    },
  };

  assert.equal(await getReferredRechargeTotal(client, 'customer-1'), '5000.00');
  assert.deepEqual(params, ['customer-1']);
  assert.match(query, /WITH RECURSIVE team/);
  assert.match(query, /t\.depth < 3/);
  assert.match(query, /rr\.status = 'APPROVED' AND rr\.credited_at IS NOT NULL/);
});

test('referred recharge total returns zero when the customer has no eligible referrals', async () => {
  const client = { async query() { return { rows: [{ total: '0' }] }; } };

  assert.equal(await getReferredRechargeTotal(client, 'customer-1'), '0');
});
