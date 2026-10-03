import argon2 from 'argon2';
import { Router } from 'express';
import { z } from 'zod';
import { inTransaction, pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export const profileRouter = Router();
profileRouter.use(requireAuth);

export function toProfileResponse(profile = {}) {
    const fullName = profile.fullName ?? profile.full_name ?? '';
    const phoneNumber = profile.phoneNumber ?? profile.phone_number ?? '';
    const referralCode = profile.referralCode ?? profile.referral_code ?? '';
    const sponsorName = profile.sponsorName ?? profile.sponsor_name ?? null;
    const registeredAt = profile.registeredAt ?? profile.created_at ?? null;
    const referralLink = profile.referralLink ?? (referralCode ? `${(profile.baseUrl ?? '').replace(/\/$/, '')}/register?ref=${encodeURIComponent(referralCode)}` : undefined);

    return {
        id: profile.id,
        fullName: fullName || null,
        phoneNumber: String(phoneNumber ?? '').trim(),
        referralCode: referralCode || null,
        referralLink: referralLink || null,
        sponsorName: sponsorName || null,
        role: profile.role ?? null,
        status: profile.status ?? null,
        registeredAt: registeredAt || null,
        withdrawalPasswordSet: Boolean(profile.withdrawalPasswordSet ?? profile.withdrawal_password_hash ?? false),
    };
}

profileRouter.get('/', async (request, response, next) => {
    try {
        const result = await pool.query(`SELECT u.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber",
            u.referral_code AS "referralCode", u.role, u.status, u.created_at AS "registeredAt",
            u.withdrawal_password_hash IS NOT NULL AS "withdrawalPasswordSet",
            s.full_name AS "sponsorName"
            FROM users u
            LEFT JOIN users s ON s.id = (
                SELECT referrer_id FROM referrals WHERE referred_user_id = u.id ORDER BY created_at DESC LIMIT 1
            )
            WHERE u.id = $1`, [request.auth.userId]);
        if (!result.rowCount)
            return response.status(404).json({ success: false, message: 'Account not found.', code: 'NOT_FOUND' });

        const profile = toProfileResponse({
            ...result.rows[0],
            referralLink: result.rows[0]?.referralCode ? `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/register?ref=${encodeURIComponent(result.rows[0].referralCode)}` : null,
        });
        response.json({ success: true, data: profile });
    }
    catch (error) { next(error); }
});

profileRouter.patch('/', async (request, response, next) => {
    try {
        const parsed = z.object({
            fullName: z.string().trim().min(2).max(120),
        }).safeParse(request.body);

        if (!parsed.success) {
            return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the profile details.', code: 'VALIDATION_ERROR' });
        }

        const result = await pool.query(`UPDATE users
            SET full_name = $2, updated_at = now()
            WHERE id = $1
            RETURNING id, full_name AS "fullName", phone_number AS "phoneNumber", referral_code AS "referralCode",
            role, status, created_at AS "registeredAt", withdrawal_password_hash IS NOT NULL AS "withdrawalPasswordSet"`,
        [request.auth.userId, parsed.data.fullName]);

        if (!result.rowCount)
            return response.status(404).json({ success: false, message: 'Account not found.', code: 'NOT_FOUND' });

        const sponsorResult = await pool.query(`SELECT s.full_name AS "sponsorName"
            FROM users u
            LEFT JOIN users s ON s.id = (
                SELECT referrer_id FROM referrals WHERE referred_user_id = u.id ORDER BY created_at DESC LIMIT 1
            )
            WHERE u.id = $1`, [request.auth.userId]);

        const profile = toProfileResponse({
            ...result.rows[0],
            sponsorName: sponsorResult.rows[0]?.sponsorName ?? null,
            referralLink: result.rows[0]?.referralCode ? `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/register?ref=${encodeURIComponent(result.rows[0].referralCode)}` : null,
        });
        response.json({ success: true, data: profile });
    }
    catch (error) {
        next(error);
    }
});

profileRouter.patch('/password', async (request, response, next) => {
    try {
        const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6).max(128), confirmNewPassword: z.string().min(6).max(128) })
            .refine((value) => value.newPassword === value.confirmNewPassword, { path: ['confirmNewPassword'], message: 'New passwords do not match.' }).safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the new password.', code: 'VALIDATION_ERROR' });
        const changed = await inTransaction(async (client) => {
            const result = await client.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [request.auth.userId]);
            if (!await argon2.verify(result.rows[0].password_hash, parsed.data.currentPassword))
                throw Object.assign(new Error('Current password is incorrect.'), { status: 400, code: 'INVALID_PASSWORD' });
            const hash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
            await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, request.auth.userId]);
            await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [request.auth.userId, request.auth.sessionId]);
            return true;
        });
        response.json({ success: true, data: { changed } });
    }
    catch (error) {
        next(error);
    }
});
profileRouter.patch('/withdrawal-password', async (request, response, next) => {
    try {
        const parsed = z.object({ currentWithdrawalPassword: z.string().min(1).optional(), newWithdrawalPassword: z.string().min(6).max(128), confirmNewWithdrawalPassword: z.string().min(6).max(128) })
            .refine((value) => value.newWithdrawalPassword === value.confirmNewWithdrawalPassword, { path: ['confirmNewWithdrawalPassword'], message: 'New withdrawal passwords do not match.' }).safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the new withdrawal password.', code: 'VALIDATION_ERROR' });
        const changed = await inTransaction(async (client) => {
            const result = await client.query('SELECT withdrawal_password_hash FROM users WHERE id = $1 FOR UPDATE', [request.auth.userId]);
            const currentHash = result.rows[0]?.withdrawal_password_hash;
            if (currentHash && (!parsed.data.currentWithdrawalPassword || !await argon2.verify(currentHash, parsed.data.currentWithdrawalPassword)))
                throw Object.assign(new Error('Current withdrawal password is incorrect.'), { status: 400, code: 'INVALID_PASSWORD' });
            const hash = await argon2.hash(parsed.data.newWithdrawalPassword, { type: argon2.argon2id });
            await client.query('UPDATE users SET withdrawal_password_hash = $1, updated_at = now() WHERE id = $2', [hash, request.auth.userId]);
            return { changed: true, initialized: !currentHash };
        });
        response.json({ success: true, data: changed });
    }
    catch (error) {
        next(error);
    }
});
