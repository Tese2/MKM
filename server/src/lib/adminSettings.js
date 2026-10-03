const DEFAULT_REFERRAL_RATES = { A: 22, B: 2, C: 1 };

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeJsonString(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

function normalizePublicUrl(value) {
  const resolved = normalizeJsonString(value);
  if (!resolved || typeof resolved !== 'string') return null;
  const trimmed = resolved.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeReferralRates(value) {
  const source = value ?? DEFAULT_REFERRAL_RATES;
  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      if (parsed && typeof parsed === 'object') {
        return {
          A: toNumber(parsed.A ?? parsed.a ?? 22, 22),
          B: toNumber(parsed.B ?? parsed.b ?? 2, 2),
          C: toNumber(parsed.C ?? parsed.c ?? 1, 1),
        };
      }
    } catch {
      // fall through to defaults
    }
  }

  if (source && typeof source === 'object') {
    return {
      A: toNumber(source.A ?? source.a ?? 22, 22),
      B: toNumber(source.B ?? source.b ?? 2, 2),
      C: toNumber(source.C ?? source.c ?? 1, 1),
    };
  }

  return { ...DEFAULT_REFERRAL_RATES };
}

export function normalizeAdminSettings(raw = {}) {
  return {
    registrationBonus: toNumber(raw.registrationBonus ?? raw.registration_bonus ?? 70, 70),
    minimumWithdrawalBalance: toNumber(raw.minimumWithdrawalBalance ?? raw.minimum_withdrawal_balance ?? 70, 70),
    minimumRechargeAmount: toNumber(raw.minimumRechargeAmount ?? raw.minimum_recharge_amount ?? 300, 300),
    maximumRechargeAmount: toNumber(raw.maximumRechargeAmount ?? raw.maximum_recharge_amount ?? 1000000, 1000000),
    dailyRechargeLimit: toNumber(raw.dailyRechargeLimit ?? raw.daily_recharge_limit ?? 1000000, 1000000),
    monthlyRechargeLimit: toNumber(raw.monthlyRechargeLimit ?? raw.monthly_recharge_limit ?? 10000000, 10000000),
    maximumPendingRecharges: toNumber(raw.maximumPendingRecharges ?? raw.maximum_pending_recharges ?? 3, 3),
    maximumWithdrawal: toNumber(raw.maximumWithdrawal ?? raw.maximum_withdrawal ?? 1000000, 1000000),
    withdrawalFee: toNumber(raw.withdrawalFee ?? raw.withdrawal_fee ?? 10, 10),
    milestoneRechargeThreshold: toNumber(raw.milestoneRechargeThreshold ?? raw.milestone_recharge_threshold ?? 8000, 8000),
    milestoneRewardAmount: toNumber(raw.milestoneRewardAmount ?? raw.milestone_reward_amount ?? 800, 800),
    secondaryMilestoneThreshold: toNumber(raw.secondaryMilestoneThreshold ?? raw.secondary_milestone_threshold ?? 20000, 20000),
    weeklyRewardRate: toNumber(raw.weeklyRewardRate ?? raw.weekly_reward_rate ?? 10, 10),
    referralRates: normalizeReferralRates(raw.referralRates ?? raw.referral_rates ?? DEFAULT_REFERRAL_RATES),
    appDownloadUrl: normalizePublicUrl(raw.appDownloadUrl ?? raw.app_download_url ?? null),
  };
}
