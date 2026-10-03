import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAdminSettings } from '../src/lib/adminSettings.js';

test('admin settings normalize numeric values and referral rates', () => {
  const normalized = normalizeAdminSettings({
    registration_bonus: '70',
    minimum_withdrawal_balance: '70',
    minimum_recharge_amount: '300',
    referral_rates: JSON.stringify({ A: 22, B: 2, C: 1 }),
    app_download_url: JSON.stringify('https://example.com/app.apk'),
  });

  assert.equal(normalized.registrationBonus, 70);
  assert.equal(normalized.minimumWithdrawalBalance, 70);
  assert.equal(normalized.minimumRechargeAmount, 300);
  assert.deepEqual(normalized.referralRates, { A: 22, B: 2, C: 1 });
  assert.equal(normalized.appDownloadUrl, 'https://example.com/app.apk');
});

test('admin settings default minimum recharge is 300 ETB', () => {
  const normalized = normalizeAdminSettings({});
  assert.equal(normalized.minimumRechargeAmount, 300);
});

test('admin settings default withdrawal fee is 10 percent and can be configured', () => {
  assert.equal(normalizeAdminSettings({}).withdrawalFee, 10);
  assert.equal(normalizeAdminSettings({ withdrawal_fee: '7.5' }).withdrawalFee, 7.5);
});

test('admin settings omit invalid values safely', () => {
  const normalized = normalizeAdminSettings({
    app_download_url: 'ftp://example.com/app.apk',
    referral_rates: '{bad-json}',
  });

  assert.equal(normalized.appDownloadUrl, null);
  assert.deepEqual(normalized.referralRates, { A: 22, B: 2, C: 1 });
});
