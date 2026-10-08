import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSupportAttachment } from '../src/lib/supportChat.js';

test('support chat accepts UTF-8 text attachments and removes path components', async () => {
  const attachment = await validateSupportAttachment({
    originalname: '..\\private\\question.txt',
    buffer: Buffer.from('Please help with my account.', 'utf8'),
  });

  assert.deepEqual(attachment, { name: 'question.txt', mime: 'text/plain' });
});

test('support chat rejects binary data disguised as a text file', async () => {
  await assert.rejects(
    validateSupportAttachment({
      originalname: 'question.txt',
      buffer: Buffer.from([0x61, 0x00, 0x62]),
    }),
    { status: 400, message: 'Upload a valid UTF-8 text file.' },
  );
});

test('support chat rejects files with unrecognized content', async () => {
  await assert.rejects(
    validateSupportAttachment({
      originalname: 'document.pdf',
      buffer: Buffer.from('not a PDF document'),
    }),
    { status: 400, message: 'Upload an image, PDF, Office document, ZIP, or text file.' },
  );
});

test('support chat identifies image attachments for inline previews', async () => {
  const image = await validateSupportAttachment({
    originalname: 'receipt.png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GocAAAAASUVORK5CYII=', 'base64'),
  });

  assert.equal(image.mime, 'image/png');
});
