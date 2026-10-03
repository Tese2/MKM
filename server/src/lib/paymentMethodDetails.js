export function resolvePaymentMethodDetails(method = {}) {
  const name = String(method.name ?? '').trim();
  const accountNumber = String(method.account_number ?? method.accountNumber ?? '').trim();
  const accountName = String(method.account_name ?? method.accountName ?? '').trim();
  const phoneNumber = String(method.phone_number ?? method.phoneNumber ?? '').trim();
  const isTelebirr = /telebirr/i.test(name);
  const primaryFieldLabel = isTelebirr ? 'Phone Number' : 'Account Number';
  const primaryValue = isTelebirr ? (phoneNumber || accountNumber) : (accountNumber || phoneNumber);
  const copyLabel = isTelebirr ? 'Copy phone' : 'Copy account number';
  const copyValue = isTelebirr ? (phoneNumber || accountNumber) : (accountNumber || phoneNumber);

  return {
    name,
    accountName: accountName || '—',
    accountNumber: accountNumber || null,
    phoneNumber: phoneNumber || null,
    primaryFieldLabel,
    primaryValue,
    copyLabel,
    copyValue,
    instructions: method.instructions ?? '',
  };
}
