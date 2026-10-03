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
