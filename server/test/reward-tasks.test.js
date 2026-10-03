import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyTaskForecast, buildDefaultRewardRules } from '../src/lib/rewardEngine.js';
import { getMilestoneRewardStatus, summarizeRewardData, summarizeTaskData } from '../src/lib/rewardMetrics.js';

test('reward summaries aggregate claimable totals and statuses', () => {
  const summary = summarizeRewardData([
    { name: 'Milestone reward', ruleType: 'MILESTONE', status: 'CLAIMABLE', amount: '800.00' },
    { name: 'Weekly reward', ruleType: 'WEEKLY', status: 'PENDING', amount: '120.00' },
    { name: 'Daily reward', ruleType: 'DAILY', status: 'COMPLETED', amount: '35.00' },
  ]);

  assert.equal(summary.totalClaimable, '800.00');
  assert.equal(summary.totalPending, '120.00');
  assert.equal(summary.totalCompleted, '35.00');
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.completedCount, 1);
});

test('task summaries report completion progress', () => {
  const summary = summarizeTaskData([
    { status: 'COMPLETED' },
    { status: 'WAITING' },
    { status: 'FAILED' },
    { status: 'COMPLETED' },
  ]);

  assert.equal(summary.totalTasks, 4);
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.completionRate, 50);
});

test('daily task forecast generates one record per active day', () => {
  const rows = buildDailyTaskForecast({
    amount: 1200,
    dailyRate: 0.08,
    activatedAt: '2026-10-01T08:00:00.000Z',
    expiresAt: '2026-10-03T08:00:00.000Z',
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].calculatedAmount, '96.00');
  assert.equal(rows[0].status, 'WAITING');
  assert.equal(rows.at(-1).businessDate, '2026-10-03');
});

test('default reward rules include the project core reward types', () => {
  const rules = buildDefaultRewardRules();

  assert.ok(rules.some((rule) => rule.ruleType === 'DAILY'));
  assert.ok(rules.some((rule) => rule.ruleType === 'MILESTONE'));
  assert.ok(rules.some((rule) => rule.ruleType === 'WEEKLY'));
  assert.deepEqual(
    rules.filter((rule) => rule.ruleType === 'MILESTONE').map(({ thresholdAmount, rewardAmount }) => [thresholdAmount, rewardAmount]),
    [[5000, 500], [8000, 800], [20000, 2000], [50000, 8000]],
  );
});

test('milestone eligibility uses approved deposit totals and preserves claim status', () => {
  const rule = { ruleStatus: 'ACTIVE', ruleType: 'MILESTONE', thresholdAmount: '5000.00' };
  assert.equal(getMilestoneRewardStatus({ ...rule, qualifyingDeposits: '4999.99' }), 'NOT_ELIGIBLE');
  assert.equal(getMilestoneRewardStatus({ ...rule, qualifyingDeposits: '5000.00' }), 'CLAIMABLE');
  assert.equal(getMilestoneRewardStatus({ ...rule, qualifyingDeposits: '9000', claimStatus: 'PENDING' }), 'PENDING');
  assert.equal(getMilestoneRewardStatus({ ...rule, ruleStatus: 'DISABLED', qualifyingDeposits: '9000' }), 'NOT_ELIGIBLE');
  assert.equal(getMilestoneRewardStatus({ ...rule, ruleType: 'DAILY', qualifyingDeposits: '9000' }), 'NOT_ELIGIBLE');
});
