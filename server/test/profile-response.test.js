import assert from 'node:assert/strict';
import test from 'node:test';
import { toProfileResponse } from '../src/routes/profile.js';

test('profile response includes referral metadata and status details', () => {
  const profile = toProfileResponse({
    id: 'user-1',
    fullName: 'Aster Bekele',
    phoneNumber: '971234567',
    referralCode: 'MKM-ABCD',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    registeredAt: '2025-01-16T09:00:00.000Z',
    sponsorName: 'Mahlet Hailu',
    referralLink: 'https://example.com/register?ref=MKM-ABCD',
  });

  assert.deepEqual(profile, {
    id: 'user-1',
    fullName: 'Aster Bekele',
    phoneNumber: '971234567',
    referralCode: 'MKM-ABCD',
    referralLink: 'https://example.com/register?ref=MKM-ABCD',
    sponsorName: 'Mahlet Hailu',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    registeredAt: '2025-01-16T09:00:00.000Z',
    withdrawalPasswordSet: false,
  });
});
