import { resolve } from 'node:path';

export const publicUploadDirectory = resolve(process.env.PUBLIC_UPLOAD_DIR ?? 'server/public-uploads');
