import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { publicUploadDirectory } from '../lib/publicUploads.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { createUserRateLimit } from '../middleware/userRateLimit.js';

export const adminUploadsRouter = Router();
adminUploadsRouter.use(requireAuth, requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const adminImageUploadLimiter = createUserRateLimit({ limit: 20 });
const imageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

adminUploadsRouter.post('/image', adminImageUploadLimiter, (request, response, next) => {
  upload.single('image')(request, response, async (uploadError) => {
    if (uploadError) return next(uploadError);
    try {
      if (!request.file)
        return response.status(400).json({ success: false, message: 'Choose an image to upload.', code: 'IMAGE_REQUIRED' });
      const detected = await fileTypeFromBuffer(request.file.buffer);
      const extension = imageTypes.get(detected?.mime);
      if (!extension)
        return response.status(400).json({ success: false, message: 'Upload a JPG, PNG, or WEBP image.', code: 'INVALID_IMAGE_TYPE' });

      const filename = `${randomUUID()}.${extension}`;
      await mkdir(publicUploadDirectory, { recursive: true });
      await writeFile(join(publicUploadDirectory, filename), request.file.buffer, { flag: 'wx' });
      response.status(201).json({ success: true, data: { imageUrl: `/uploads/${filename}` } });
    } catch (error) {
      next(error);
    }
  });
});

adminUploadsRouter.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    return response.status(tooLarge ? 413 : 400).json({
      success: false,
      message: tooLarge ? 'Image must be 5 MB or smaller.' : 'Invalid image upload.',
      code: error.code,
    });
  }
  next(error);
});
