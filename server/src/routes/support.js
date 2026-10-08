import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { normalizeSupportSettings } from '../lib/supportSettings.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { createUserRateLimit } from '../middleware/userRateLimit.js';
import { SUPPORT_ATTACHMENT_MAX_BYTES, validateSupportAttachment } from '../lib/supportChat.js';

export const supportRouter = Router();
supportRouter.use(requireAuth);

const SUPPORT_KEYS = [
  'site_name',
  'support_name',
  'support_phone',
  'support_message',
  'support_enabled',
  'customer_support_url',
  'customer_support_label',
  'customer_support_enabled',
  'whatsapp_url',
  'whatsapp_number',
  'whatsapp_enabled',
  'whatsapp_message',
  'official_group_name',
  'official_group_url',
  'official_group_label',
  'official_group_enabled',
  'app_download_url',
  'about_title',
  'about_intro',
  'about_first_heading',
  'about_first_content',
  'about_second_heading',
  'about_second_content',
  'welcome_eyebrow',
  'welcome_title',
  'welcome_intro',
  'welcome_bonus_label',
  'welcome_example_title',
  'welcome_example_price',
  'welcome_example_daily_earnings',
  'welcome_disclaimer',
  'welcome_image_url',
  'welcome_image_alt',
  'welcome_home_button_label',
  'public_links',
];

supportRouter.get('/', async (_request, response, next) => {
  try {
    const result = await getPool().query(
      `SELECT key, value #>> '{}' AS value FROM settings WHERE key = ANY($1::text[])`,
      [SUPPORT_KEYS],
    );
    const payload = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
    response.json({
      success: true,
      data: normalizeSupportSettings(payload),
    });
  } catch (error) {
    next(error);
  }
});

const supportMessageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SUPPORT_ATTACHMENT_MAX_BYTES, files: 1 },
});
const supportMessageLimiter = createUserRateLimit({ limit: 20 });
const messageSchema = z.object({
  text: z.string().trim().max(2000).optional(),
});

function uploadSupportMessage(request, response, next, handler) {
  supportMessageUpload.single('file')(request, response, async (error) => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return response.status(tooLarge ? 413 : 400).json({
        success: false,
        message: tooLarge ? 'Files must be 5 MB or smaller.' : 'Invalid file upload.',
        code: error.code,
      });
    }
    if (error) return next(error);
    try {
      await handler();
    } catch (cause) {
      next(cause);
    }
  });
}

function requireCustomerChat(request, response, next) {
  if (request.auth.role !== 'CUSTOMER') {
    return response.status(403).json({ success: false, message: 'Customer access is required.', code: 'FORBIDDEN' });
  }
  next();
}

async function prepareMessage(request) {
  const parsed = messageSchema.safeParse(request.body);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues[0]?.message ?? 'Enter a message or attach a file.'), { status: 400 });
  }
  const text = parsed.data.text || null;
  const attachment = request.file ? await validateSupportAttachment(request.file) : null;
  if (!text && !attachment) {
    throw Object.assign(new Error('Enter a message or attach a file.'), { status: 400 });
  }
  return {
    text,
    attachment,
    buffer: request.file?.buffer ?? null,
    size: request.file?.size ?? null,
  };
}

async function insertSupportMessage({ customerId, senderId, senderRole, message }) {
  const result = await getPool().query(
    `INSERT INTO support_messages(
       customer_id, sender_id, sender_role, message_text,
       attachment_data, attachment_name, attachment_mime, attachment_size
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, sender_role AS "senderRole", message_text AS text,
               attachment_name AS "attachmentName",
               attachment_mime AS "attachmentMime",
               (attachment_data IS NOT NULL) AS "hasAttachment",
               created_at AS "createdAt"`,
    [
      customerId,
      senderId,
      senderRole,
      message.text,
      message.buffer,
      message.attachment?.name ?? null,
      message.attachment?.mime ?? null,
      message.size,
    ],
  );
  return result.rows[0];
}

function mapSupportMessage(row) {
  return {
    id: row.id,
    senderRole: row.senderRole,
    text: row.text,
    attachmentName: row.attachmentName,
    attachmentMime: row.attachmentMime,
    hasAttachment: row.hasAttachment,
    createdAt: row.createdAt,
  };
}

async function getSupportMessages(customerId) {
  const result = await getPool().query(
    `SELECT id, sender_role AS "senderRole", message_text AS text,
            attachment_name AS "attachmentName",
            attachment_mime AS "attachmentMime",
            (attachment_data IS NOT NULL) AS "hasAttachment",
            created_at AS "createdAt"
     FROM (
       SELECT id, sender_role, message_text, attachment_name, attachment_mime,
              attachment_data, created_at
       FROM support_messages
       WHERE customer_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100
     ) recent
     ORDER BY "createdAt" ASC, id ASC`,
    [customerId],
  );
  return result.rows.map(mapSupportMessage);
}

supportRouter.get('/chat/unread-count', requireCustomerChat, async (request, response, next) => {
  try {
    const result = await getPool().query(
      `SELECT count(*)::int AS "unreadCount"
       FROM support_messages
       WHERE customer_id = $1 AND sender_role = 'ADMIN' AND customer_read_at IS NULL`,
      [request.auth.userId],
    );
    response.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

async function sendSupportAttachment(response, messageId, customerId, forceDownload = false) {
  const result = await getPool().query(
    `SELECT attachment_data AS data, attachment_name AS name,
            attachment_mime AS mime
     FROM support_messages
     WHERE id = $1 AND customer_id = $2 AND attachment_data IS NOT NULL`,
    [messageId, customerId],
  );
  if (!result.rowCount) {
    return response.status(404).json({ success: false, message: 'Attachment not found.', code: 'NOT_FOUND' });
  }
  const attachment = result.rows[0];
  const isInlineImage = !forceDownload && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(attachment.mime);
  response.set({
    'Content-Type': attachment.mime,
    'Content-Disposition': `${isInlineImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    'Content-Length': attachment.data.length,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.send(attachment.data);
}

supportRouter.get('/chat/messages', requireCustomerChat, async (request, response, next) => {
  try {
    await getPool().query(
      `UPDATE support_messages SET customer_read_at = now()
       WHERE customer_id = $1 AND sender_role = 'ADMIN' AND customer_read_at IS NULL`,
      [request.auth.userId],
    );
    response.json({ success: true, data: await getSupportMessages(request.auth.userId) });
  } catch (error) {
    next(error);
  }
});

supportRouter.post('/chat/messages', requireCustomerChat, supportMessageLimiter, (request, response, next) => {
  uploadSupportMessage(request, response, next, async () => {
    const message = await prepareMessage(request);
    const saved = await insertSupportMessage({
      customerId: request.auth.userId,
      senderId: request.auth.userId,
      senderRole: 'CUSTOMER',
      message,
    });
    response.status(201).json({ success: true, data: mapSupportMessage(saved) });
  });
});

supportRouter.get('/chat/messages/:messageId/attachment', requireCustomerChat, async (request, response, next) => {
  const parsedId = z.string().uuid().safeParse(request.params.messageId);
  if (!parsedId.success) {
    return response.status(400).json({ success: false, message: 'Invalid message ID.', code: 'VALIDATION_ERROR' });
  }
  try {
    await sendSupportAttachment(response, parsedId.data, request.auth.userId, request.query.download === '1');
  } catch (error) {
    next(error);
  }
});

const adminSupportSchema = z.object({
  siteName: z.string().trim().max(120).optional(),
  supportName: z.string().trim().max(120).optional(),
  supportPhone: z.string().trim().max(40).optional(),
  supportMessage: z.string().trim().max(500).optional(),
  supportEnabled: z.boolean().optional(),
  customerSupportUrl: z.string().trim().max(500).optional(),
  customerSupportLabel: z.string().trim().max(120).optional(),
  customerSupportEnabled: z.boolean().optional(),
  whatsappUrl: z.string().trim().max(500).optional(),
  whatsappNumber: z.string().trim().max(40).optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappMessage: z.string().trim().max(200).optional(),
  officialGroupName: z.string().trim().max(120).optional(),
  officialGroupUrl: z.string().trim().max(500).optional(),
  officialGroupLabel: z.string().trim().max(120).optional(),
  officialGroupEnabled: z.boolean().optional(),
  appDownloadUrl: z.string().trim().max(500).optional(),
});

export const adminSupportRouter = Router();
adminSupportRouter.use(requireAuth, requireAdmin);

adminSupportRouter.get('/chats', async (_request, response, next) => {
  try {
    const result = await getPool().query(
      `SELECT u.id AS "customerId", u.full_name AS "customerName",
              u.phone_number AS "phoneNumber",
              latest.message_text AS "lastText",
              latest.attachment_name AS "lastAttachmentName",
              latest.sender_role AS "lastSenderRole",
              latest.created_at AS "lastMessageAt",
              unread.count AS "unreadCount"
       FROM (SELECT DISTINCT customer_id FROM support_messages) conversations
       JOIN users u ON u.id = conversations.customer_id
       LEFT JOIN LATERAL (
         SELECT message_text, attachment_name, sender_role, created_at
         FROM support_messages
         WHERE customer_id = conversations.customer_id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) latest ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS count
         FROM support_messages
         WHERE customer_id = conversations.customer_id
           AND sender_role = 'CUSTOMER' AND admin_read_at IS NULL
       ) unread ON true
       ORDER BY latest.created_at DESC NULLS LAST`,
    );
    response.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

adminSupportRouter.get('/chats/:customerId/messages', async (request, response, next) => {
  const parsedId = z.string().uuid().safeParse(request.params.customerId);
  if (!parsedId.success) {
    return response.status(400).json({ success: false, message: 'Invalid customer ID.', code: 'VALIDATION_ERROR' });
  }
  try {
    const customer = await getPool().query(
      `SELECT id FROM users WHERE id = $1 AND role = 'CUSTOMER'`,
      [parsedId.data],
    );
    if (!customer.rowCount) {
      return response.status(404).json({ success: false, message: 'Customer not found.', code: 'NOT_FOUND' });
    }
    await getPool().query(
      `UPDATE support_messages SET admin_read_at = now()
       WHERE customer_id = $1 AND sender_role = 'CUSTOMER' AND admin_read_at IS NULL`,
      [parsedId.data],
    );
    response.json({ success: true, data: await getSupportMessages(parsedId.data) });
  } catch (error) {
    next(error);
  }
});

adminSupportRouter.post('/chats/:customerId/messages', supportMessageLimiter, (request, response, next) => {
  const parsedId = z.string().uuid().safeParse(request.params.customerId);
  if (!parsedId.success) {
    return response.status(400).json({ success: false, message: 'Invalid customer ID.', code: 'VALIDATION_ERROR' });
  }
  uploadSupportMessage(request, response, next, async () => {
    const customer = await getPool().query(
      `SELECT id FROM users WHERE id = $1 AND role = 'CUSTOMER'`,
      [parsedId.data],
    );
    if (!customer.rowCount) {
      return response.status(404).json({ success: false, message: 'Customer not found.', code: 'NOT_FOUND' });
    }
    const message = await prepareMessage(request);
    const saved = await insertSupportMessage({
      customerId: parsedId.data,
      senderId: request.auth.userId,
      senderRole: 'ADMIN',
      message,
    });
    response.status(201).json({ success: true, data: mapSupportMessage(saved) });
  });
});

adminSupportRouter.get('/chats/:customerId/messages/:messageId/attachment', async (request, response, next) => {
  const parsedCustomerId = z.string().uuid().safeParse(request.params.customerId);
  const parsedMessageId = z.string().uuid().safeParse(request.params.messageId);
  if (!parsedCustomerId.success || !parsedMessageId.success) {
    return response.status(400).json({ success: false, message: 'Invalid attachment ID.', code: 'VALIDATION_ERROR' });
  }
  try {
    await sendSupportAttachment(response, parsedMessageId.data, parsedCustomerId.data, request.query.download === '1');
  } catch (error) {
    next(error);
  }
});

const aboutPageSchema = z.object({
  aboutTitle: z.string().trim().min(1).max(160),
  aboutIntro: z.string().trim().min(1).max(2000),
  aboutFirstHeading: z.string().trim().min(1).max(120),
  aboutFirstContent: z.string().trim().min(1).max(2000),
  aboutSecondHeading: z.string().trim().min(1).max(120),
  aboutSecondContent: z.string().trim().min(1).max(2000),
});

adminSupportRouter.put('/about', async (request, response, next) => {
  try {
    const parsed = aboutPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the About page content.', code: 'VALIDATION_ERROR' });
    }
    const updates = [
      ['about_title', parsed.data.aboutTitle],
      ['about_intro', parsed.data.aboutIntro],
      ['about_first_heading', parsed.data.aboutFirstHeading],
      ['about_first_content', parsed.data.aboutFirstContent],
      ['about_second_heading', parsed.data.aboutSecondHeading],
      ['about_second_content', parsed.data.aboutSecondContent],
    ];
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of updates) {
        await client.query(
          `INSERT INTO settings(key, value, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), request.auth.userId],
        );
      }
      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, old_value, new_value) VALUES ($1, $2, $3, $4, $5)',
        [request.auth.userId, 'PUBLIC_ABOUT_PAGE_UPDATE', 'public_page', null, parsed.data],
      );
      await client.query('COMMIT');
      response.json({ success: true, data: { updated: updates.length } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

const welcomePageSchema = z.object({
  welcomeEyebrow: z.string().trim().min(1).max(120),
  welcomeTitle: z.string().trim().min(1).max(160),
  welcomeIntro: z.string().trim().min(1).max(1000),
  welcomeBonusLabel: z.string().trim().min(1).max(80),
  welcomeExampleTitle: z.string().trim().min(1).max(120),
  welcomeExamplePrice: z.coerce.number().min(0).max(100000000),
  welcomeExampleDailyEarnings: z.coerce.number().min(0).max(100000000),
  welcomeDisclaimer: z.string().trim().min(1).max(1000),
  welcomeImageUrl: z.string().trim().max(500).optional().default(''),
  welcomeImageAlt: z.string().trim().min(1).max(200),
  welcomeHomeButtonLabel: z.string().trim().min(1).max(80),
}).superRefine((value, context) => {
  if (value.welcomeImageUrl && !normalizeSupportSettings({ welcome_image_url: value.welcomeImageUrl }).welcomeImageUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['welcomeImageUrl'], message: 'Enter a valid HTTP or HTTPS image URL.' });
  }
});

adminSupportRouter.put('/welcome', async (request, response, next) => {
  try {
    const parsed = welcomePageSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? 'Check the welcome page content.',
        code: 'VALIDATION_ERROR',
      });
    }
    const incoming = parsed.data;
    const updates = [
      ['welcome_eyebrow', incoming.welcomeEyebrow],
      ['welcome_title', incoming.welcomeTitle],
      ['welcome_intro', incoming.welcomeIntro],
      ['welcome_bonus_label', incoming.welcomeBonusLabel],
      ['welcome_example_title', incoming.welcomeExampleTitle],
      ['welcome_example_price', incoming.welcomeExamplePrice],
      ['welcome_example_daily_earnings', incoming.welcomeExampleDailyEarnings],
      ['welcome_disclaimer', incoming.welcomeDisclaimer],
      ['welcome_image_url', incoming.welcomeImageUrl || null],
      ['welcome_image_alt', incoming.welcomeImageAlt],
      ['welcome_home_button_label', incoming.welcomeHomeButtonLabel],
    ];
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of updates) {
        await client.query(
          `INSERT INTO settings(key, value, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), request.auth.userId],
        );
      }
      await client.query(
        'INSERT INTO audit_logs(admin_id, action, entity_type, old_value, new_value) VALUES ($1, $2, $3, $4, $5)',
        [request.auth.userId, 'WELCOME_PAGE_UPDATE', 'public_page', null, incoming],
      );
      await client.query('COMMIT');
      response.json({ success: true, data: { updated: updates.length } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

adminSupportRouter.get('/', async (_request, response, next) => {
  try {
    const result = await getPool().query(`SELECT key, value #>> '{}' AS value FROM settings WHERE key = ANY($1::text[])`, [SUPPORT_KEYS]);
    const payload = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
    response.json({
      success: true,
      data: normalizeSupportSettings(payload),
    });
  } catch (error) {
    next(error);
  }
});
adminSupportRouter.put('/', async (request, response, next) => {
  try {
    const parsed = adminSupportSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the support settings.', code: 'VALIDATION_ERROR' });
    }
    const incoming = parsed.data;
    const updates = [
      ['site_name', incoming.siteName],
      ['support_name', incoming.supportName],
      ['support_phone', incoming.supportPhone],
      ['support_message', incoming.supportMessage],
      ['support_enabled', incoming.supportEnabled],
      ['customer_support_url', incoming.customerSupportUrl],
      ['customer_support_label', incoming.customerSupportLabel],
      ['customer_support_enabled', incoming.customerSupportEnabled],
      ['whatsapp_url', incoming.whatsappUrl],
      ['whatsapp_number', incoming.whatsappNumber],
      ['whatsapp_enabled', incoming.whatsappEnabled],
      ['whatsapp_message', incoming.whatsappMessage],
      ['official_group_name', incoming.officialGroupName],
      ['official_group_url', incoming.officialGroupUrl],
      ['official_group_label', incoming.officialGroupLabel],
      ['official_group_enabled', incoming.officialGroupEnabled],
      ['app_download_url', incoming.appDownloadUrl],
    ].filter(([, value]) => value !== undefined);

    if (!updates.length) {
      return response.status(400).json({ success: false, message: 'No support settings were provided.', code: 'VALIDATION_ERROR' });
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of updates) {
        await client.query(
          `INSERT INTO settings(key, value, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), request.auth.userId],
        );
      }
      await client.query('COMMIT');
      response.json({ success: true, data: { updated: updates.length } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});
