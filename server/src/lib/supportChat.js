import { basename } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';

export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

const allowedExtensions = new Set([
  'jpg', 'png', 'webp', 'gif', 'pdf', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

export async function validateSupportAttachment(file) {
  if (!file?.buffer?.length || file.buffer.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
    throw Object.assign(new Error('Choose a file that is 5 MB or smaller.'), { status: 400 });
  }

  const normalizedOriginalName = String(file.originalname ?? '')
    .replaceAll('\\', '/')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  const name = basename(normalizedOriginalName).slice(0, 180) || 'attachment';
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';

  if (['txt', 'csv', 'md'].includes(extension)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      if (text.includes('\0')) throw new Error('Binary content is not allowed.');
      return { name, mime: extension === 'csv' ? 'text/csv' : 'text/plain' };
    } catch {
      throw Object.assign(new Error('Upload a valid UTF-8 text file.'), { status: 400 });
    }
  }

  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !allowedExtensions.has(detected.ext)) {
    throw Object.assign(new Error('Upload an image, PDF, Office document, ZIP, or text file.'), { status: 400 });
  }

  return { name, mime: detected.mime };
}
