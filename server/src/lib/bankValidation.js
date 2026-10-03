function normalizeProviderName(provider) {
  return String(provider ?? '').trim().toLowerCase();
}

export function validateAccountNumber(provider, accountNumber) {
  const raw = String(accountNumber ?? '').trim();
  if (!raw) return false;
  if (!/^\d+$/.test(raw)) return false;

  switch (normalizeProviderName(provider)) {
    case 'awash bank':
      return /^[0-9]{14,15}$/.test(raw);
    case 'cbe':
      return /^[0-9]{13}$/.test(raw);
    case 'telebirr':
      return /^[0-9]{10}$/.test(raw);
    case 'abyssinia bank':
      return /^[0-9]{6,9}$/.test(raw);
    default:
      return raw.length >= 6;
  }
}
