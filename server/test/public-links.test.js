import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicLinks } from '../src/lib/supportSettings.js';

test('normalize public links validates secure URLs and ordering', () => {
  const links = normalizePublicLinks([
    { name: 'Support', url: 'support.example.com', description: 'Customer support', enabled: 'true', displayOrder: '2', target: '_blank' },
    { name: 'Privacy', url: 'http://example.com/privacy', description: 'Privacy policy', enabled: true, displayOrder: 1, target: '_self' },
    { name: 'Bad', url: 'ftp://example.com', description: 'Blocked', enabled: true, displayOrder: 9, target: '_blank' },
  ]);

  assert.deepEqual(links.map((link) => ({
    name: link.name,
    url: link.url,
    enabled: link.enabled,
    displayOrder: link.displayOrder,
    target: link.target,
  })), [
    { name: 'Privacy', url: 'http://example.com/privacy', enabled: true, displayOrder: 1, target: '_self' },
    { name: 'Support', url: 'https://support.example.com/', enabled: true, displayOrder: 2, target: '_blank' },
  ]);
});
