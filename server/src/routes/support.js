import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { normalizeSupportSettings } from '../lib/supportSettings.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

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
