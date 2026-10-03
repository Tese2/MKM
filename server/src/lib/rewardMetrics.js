function toNumber(value) {
  const parsed = Number.parseFloat(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return Number(value ?? 0).toFixed(2);
}

export function getMilestoneRewardStatus({ ruleStatus, ruleType, claimStatus, qualifyingDeposits, thresholdAmount }) {
  if (claimStatus) return String(claimStatus).toUpperCase();
  if (ruleStatus !== 'ACTIVE' || ruleType !== 'MILESTONE') return 'NOT_ELIGIBLE';
  return toNumber(qualifyingDeposits) >= toNumber(thresholdAmount) ? 'CLAIMABLE' : 'NOT_ELIGIBLE';
}

export function summarizeRewardData(rows = []) {
  const normalized = rows.map((row) => ({
    ...row,
    status: String(row?.status ?? '').toUpperCase(),
    amount: toNumber(row?.amount ?? row?.rewardAmount ?? 0),
  }));

  const claimable = normalized.filter((item) => item.status === 'CLAIMABLE').reduce((sum, item) => sum + item.amount, 0);
  const pending = normalized.filter((item) => item.status === 'PENDING').reduce((sum, item) => sum + item.amount, 0);
  const completed = normalized.filter((item) => ['APPROVED', 'PAID', 'COMPLETED'].includes(item.status)).reduce((sum, item) => sum + item.amount, 0);

  return {
    totalRewards: normalized.length,
    totalClaimable: formatMoney(claimable),
    totalPending: formatMoney(pending),
    totalCompleted: formatMoney(completed),
    claimableCount: normalized.filter((item) => item.status === 'CLAIMABLE').length,
    pendingCount: normalized.filter((item) => item.status === 'PENDING').length,
    completedCount: normalized.filter((item) => ['APPROVED', 'PAID', 'COMPLETED'].includes(item.status)).length,
  };
}

export function summarizeTaskData(rows = []) {
  const normalized = rows.map((row) => ({
    ...row,
    status: String(row?.status ?? '').toUpperCase(),
  }));

  const totalTasks = normalized.length;
  const completedCount = normalized.filter((item) => item.status === 'COMPLETED').length;
  const completionRate = totalTasks === 0 ? 0 : Math.round((completedCount / totalTasks) * 100);

  return {
    totalTasks,
    completedCount,
    waitingCount: normalized.filter((item) => item.status === 'WAITING').length,
    failedCount: normalized.filter((item) => item.status === 'FAILED').length,
    processingCount: normalized.filter((item) => item.status === 'PROCESSING').length,
    completionRate,
  };
}
