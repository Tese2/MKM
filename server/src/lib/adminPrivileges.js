export const ADMIN_PRIVILEGES = [
  'CUSTOMER_VIEW',
  'CUSTOMER_MANAGE',
  'PRODUCT_VIEW',
  'PRODUCT_MANAGE',
  'RECHARGE_VIEW',
  'RECHARGE_APPROVE',
  'WITHDRAWAL_VIEW',
  'WITHDRAWAL_APPROVE',
  'TRANSACTION_VIEW',
  'TASK_VIEW',
  'TASK_MANAGE',
  'REFERRAL_VIEW',
  'SETTINGS_VIEW',
  'SETTINGS_MANAGE',
  'ADMIN_VIEW',
  'ADMIN_CREATE',
  'ADMIN_MANAGE',
];

export function normalizePrivileges(privileges) {
  if (!Array.isArray(privileges)) return [];
  const validSet = new Set(ADMIN_PRIVILEGES);
  const normalized = [];
  for (const item of privileges) {
    if (typeof item === 'string') {
      const trimmed = item.trim().toUpperCase();
      if (trimmed === '*' || validSet.has(trimmed)) {
        if (!normalized.includes(trimmed)) {
          normalized.push(trimmed);
        }
      }
    }
  }
  return normalized;
}

export function hasPrivilege(auth, privilege) {
  if (!auth || auth.role !== 'ADMIN') return false;
  if (auth.isSuperAdmin) return true;
  const list = Array.isArray(auth.privileges) ? auth.privileges : [];
  return list.includes('*') || list.includes(privilege);
}
