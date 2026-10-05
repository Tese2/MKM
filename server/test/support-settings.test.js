import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSupportSettings } from '../src/lib/supportSettings.js';

test('support settings normalize the app download URL', () => {
  const normalized = normalizeSupportSettings({
    app_download_url: 'https://example.com/app.apk',
    support_name: 'Support Team',
    support_enabled: 'true',
  });

  assert.equal(normalized.appDownloadUrl, 'https://example.com/app.apk');
  assert.equal(normalized.supportName, 'Support Team');
  assert.equal(normalized.supportEnabled, true);
});

test('support settings reject unsafe app download URLs', () => {
  const normalized = normalizeSupportSettings({
    app_download_url: 'ftp://example.com/app.apk',
  });

  assert.equal(normalized.appDownloadUrl, null);
});

test('support settings include configurable customer, WhatsApp, and official links', () => {
  const normalized = normalizeSupportSettings({
    customer_support_url: 'https://support.example.com',
    customer_support_label: 'Support Portal',
    customer_support_enabled: 'true',
    whatsapp_number: '+251 912 345 678',
    whatsapp_message: 'Hello MKM',
    whatsapp_enabled: 'true',
    official_group_url: 'https://chat.whatsapp.com/demo',
    official_group_label: 'Community Group',
    official_group_enabled: 'true',
  });

  assert.equal(normalized.customerSupportUrl, 'https://support.example.com/');
  assert.equal(normalized.customerSupportLabel, 'Support Portal');
  assert.equal(normalized.customerSupportEnabled, true);
  assert.equal(normalized.whatsappUrl, 'https://wa.me/251912345678?text=Hello+MKM');
  assert.equal(normalized.whatsappEnabled, true);
  assert.equal(normalized.officialGroupUrl, 'https://chat.whatsapp.com/demo');
  assert.equal(normalized.officialGroupLabel, 'Community Group');
  assert.equal(normalized.officialGroupEnabled, true);
});

test('support settings provide editable About page copy with safe defaults', () => {
  const defaults = normalizeSupportSettings({});
  assert.equal(defaults.aboutTitle, 'One place for your member activity.');
  assert.equal(defaults.aboutFirstHeading, 'Account-led');

  const configured = normalizeSupportSettings({
    about_title: 'About our service',
    about_intro: 'A configured introduction.',
    about_first_heading: 'Our mission',
    about_first_content: 'Serve members clearly.',
    about_second_heading: 'Our values',
    about_second_content: 'Trust and service.',
  });
  assert.equal(configured.aboutTitle, 'About our service');
  assert.equal(configured.aboutIntro, 'A configured introduction.');
  assert.equal(configured.aboutFirstHeading, 'Our mission');
  assert.equal(configured.aboutFirstContent, 'Serve members clearly.');
  assert.equal(configured.aboutSecondHeading, 'Our values');
  assert.equal(configured.aboutSecondContent, 'Trust and service.');
});

test('support settings provide configurable welcome page content with safe defaults', () => {
  const defaults = normalizeSupportSettings({});
  assert.equal(defaults.welcomeEyebrow, 'YOUR MEMBER JOURNEY STARTS HERE');
  assert.equal(defaults.welcomeTitle, 'Welcome to MKM');
  assert.equal(defaults.welcomeExamplePrice, 300);
  assert.equal(defaults.welcomeExampleDailyEarnings, 72);
  assert.equal(defaults.welcomeImageUrl, null);

  const configured = normalizeSupportSettings({
    welcome_eyebrow: 'START HERE',
    welcome_title: 'Welcome, member',
    welcome_intro: 'Your account is ready.',
    welcome_bonus_label: 'Account bonus',
    welcome_example_title: 'SAMPLE',
    welcome_example_price: '450',
    welcome_example_daily_earnings: '18.5',
    welcome_disclaimer: 'Example terms apply.',
    welcome_image_url: 'https://example.com/welcome.png',
    welcome_image_alt: 'MKM welcome art',
    welcome_home_button_label: 'Open dashboard',
  });
  assert.equal(configured.welcomeEyebrow, 'START HERE');
  assert.equal(configured.welcomeTitle, 'Welcome, member');
  assert.equal(configured.welcomeIntro, 'Your account is ready.');
  assert.equal(configured.welcomeBonusLabel, 'Account bonus');
  assert.equal(configured.welcomeExampleTitle, 'SAMPLE');
  assert.equal(configured.welcomeExamplePrice, 450);
  assert.equal(configured.welcomeExampleDailyEarnings, 18.5);
  assert.equal(configured.welcomeDisclaimer, 'Example terms apply.');
  assert.equal(configured.welcomeImageUrl, 'https://example.com/welcome.png');
  assert.equal(configured.welcomeImageAlt, 'MKM welcome art');
  assert.equal(configured.welcomeHomeButtonLabel, 'Open dashboard');

  const invalid = normalizeSupportSettings({ welcome_example_price: '-1', welcome_image_url: 'javascript:alert(1)' });
  assert.equal(invalid.welcomeExamplePrice, 300);
  assert.equal(invalid.welcomeImageUrl, null);
});

test('support settings preserve validated uploaded welcome image paths', () => {
  const path = '/uploads/123e4567-e89b-42d3-a456-426614174000.webp';
  assert.equal(normalizeSupportSettings({ welcome_image_url: path }).welcomeImageUrl, path);
  assert.equal(normalizeSupportSettings({ welcome_image_url: '/uploads/not-an-upload.webp' }).welcomeImageUrl, null);
});
