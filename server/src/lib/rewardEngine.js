export function buildDefaultRewardRules() {
  return [
    {
      name: 'Daily reward',
      ruleType: 'DAILY',
      thresholdAmount: 0,
      rewardAmount: 0,
      frequency: 'DAILY',
      status: 'ACTIVE',
    },
    {
      name: 'Milestone reward',
      ruleType: 'MILESTONE',
      thresholdAmount: 8000,
      rewardAmount: 800,
      frequency: 'ONCE',
      status: 'ACTIVE',
    },
    {
      name: 'Weekly reward',
      ruleType: 'WEEKLY',
      thresholdAmount: 0,
      rewardAmount: 0,
      frequency: 'WEEKLY',
      status: 'ACTIVE',
    },
  ];
}

export function buildDailyTaskForecast({ amount, dailyRate, activatedAt, expiresAt }) {
  const start = new Date(activatedAt ?? Date.now());
  const end = new Date(expiresAt ?? activatedAt ?? Date.now());
  const rows = [];

  const startDate = new Date(start);
  startDate.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(end);
  endDate.setUTCHours(0, 0, 0, 0);

  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const calculatedAmount = Number((Number(amount ?? 0) * Number(dailyRate ?? 0)).toFixed(2));
    rows.push({
      businessDate: cursor.toISOString().slice(0, 10),
      baseAmount: calculatedAmount.toFixed(2),
      configuredRate: Number(dailyRate ?? 0).toFixed(6),
      calculatedAmount: calculatedAmount.toFixed(2),
      status: 'WAITING',
    });
  }

  return rows;
}
