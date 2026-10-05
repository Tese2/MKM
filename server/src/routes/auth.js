import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { inTransaction, pool } from '../db/pool.js';
import { postWalletMovement } from '../services/wallet.js';
import { requireAuth, sessionToken } from '../middleware/auth.js';
export const authRouter = Router();
const phoneSchema = z.string().regex(/^[97][0-9]{8}$/, 'Enter a valid 9-digit phone number starting with 9 or 7.');
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many attempts. Try again later.', code: 'RATE_LIMITED' } });
export function inactiveCustomerMessage(reason, status) {
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    const statusMessage = status === 'SUSPENDED' ? 'suspended' : 'deactivated';
    return normalizedReason
        ? `Your account has been ${statusMessage}. Reason: ${normalizedReason}`
        : `Your account has been ${statusMessage} by an administrator. Please contact support for assistance.`;
}
export function isInactiveCustomer(user) {
    return user?.role === 'CUSTOMER' && user.status !== 'ACTIVE';
}
export function normalizeReferralCode(value) {
    const source = String(value ?? '').trim();
    if (!source) return '';
    const normalized = source.toUpperCase();
    if (!/^MKM-[A-Z0-9]{4,20}$/.test(normalized)) {
        throw Object.assign(new Error('Referral code is invalid.'), { status: 400, code: 'INVALID_REFERRAL' });
    }
    return normalized;
}
const registrationSchema = z.object({
    fullName: z.string().trim().min(2).max(120),
    phoneNumber: phoneSchema,
    password: z.string().min(6).max(128),
    confirmPassword: z.string().min(6).max(128),
    referralCode: z.string().trim().max(40).optional().or(z.literal('')),
    acceptedTerms: z.literal(true),
}).refine((input) => input.password === input.confirmPassword, { path: ['confirmPassword'], message: 'Login passwords do not match.' })
;
authRouter.post('/register', authLimiter, async (request, response, next) => {
    try {
        const parsed = registrationSchema.safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? 'Check the registration details.', code: 'VALIDATION_ERROR' });
        const input = parsed.data;
        const referralCode = input.referralCode ? normalizeReferralCode(input.referralCode) : '';
        const loginHash = await argon2.hash(input.password, { type: argon2.argon2id });
        const result = await inTransaction(async (client) => {
            let sponsorId = null;
            if (referralCode) {
                const sponsor = await client.query('SELECT id, referral_code FROM users WHERE referral_code = $1 AND status = $2', [referralCode, 'ACTIVE']);
                if (!sponsor.rowCount)
                    throw Object.assign(new Error('That invite code is not valid.'), { status: 400, code: 'INVALID_REFERRAL' });
                if (sponsor.rows[0].referral_code === referralCode && referralCode === referralCode.toUpperCase()) {
                    sponsorId = sponsor.rows[0].id;
                }
            }
            let nextReferralCode = '';
            for (let attempt = 0; attempt < 5; attempt += 1) {
                nextReferralCode = `MKM-${randomBytes(4).toString('hex').toUpperCase()}`;
                const exists = await client.query('SELECT 1 FROM users WHERE referral_code = $1', [nextReferralCode]);
                if (!exists.rowCount)
                    break;
            }
             let userResult;

try {
    userResult = await client.query(
        `INSERT INTO users(full_name, phone_number, password_hash, referral_code)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name, phone_number, referral_code, role, status`,
        [input.fullName, input.phoneNumber, loginHash, nextReferralCode],
    );
} catch (error) {
    if (error?.code === '23505') {
        throw Object.assign(
            new Error('This phone number is already registered.'),
            { status: 409, code: 'PHONE_ALREADY_REGISTERED' },
        );
    }
    throw error;
}
            const user = userResult.rows[0];
            await client.query('INSERT INTO wallets(user_id) VALUES ($1)', [user.id]);
            if (sponsorId)
                await client.query('INSERT INTO referrals(referrer_id, referred_user_id) VALUES ($1, $2)', [sponsorId, user.id]);
            const setting = await client.query("SELECT value #>> '{}' AS amount FROM settings WHERE key = 'registration_bonus'");
            const bonus = setting.rows[0]?.amount ?? '70';
            if (Number(bonus) > 0) {
                await postWalletMovement(client, {
                    userId: user.id,
                    amount: bonus,
                    direction: 'CREDIT',
                    transactionType: 'REGISTRATION_BONUS',
                    referenceId: user.id,
                    referenceType: 'wallet_ledger',
                    description: 'Registration bonus',
                });
            }
            await client.query("INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Welcome to MKM', 'Your account is ready.', 'REGISTRATION')", [user.id]);
            const session = await client.query("INSERT INTO auth_sessions(user_id, expires_at) VALUES ($1, now() + interval '7 days') RETURNING id", [user.id]);
            return { user, sessionId: session.rows[0].id };
        });
        setSessionCookie(response, result.user.id, result.sessionId);
        response.status(201).json({ success: true, data: sanitizeUser(result.user) });
    }
    catch (error) {
        next(error);
    }
});
authRouter.post('/login', authLimiter, async (request, response, next) => {
    try {
        const parsed = z.object({ phoneNumber: phoneSchema, password: z.string().min(1).max(128) }).safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ success: false, message: 'Enter your phone number and password.', code: 'VALIDATION_ERROR' });
        const result = await pool.query("SELECT id, full_name, phone_number, referral_code, role, status, password_hash FROM users WHERE phone_number = $1", [parsed.data.phoneNumber]);
        const user = result.rows[0];
        const validPassword = user ? await argon2.verify(user.password_hash, parsed.data.password) : false;
        if (!user || !validPassword)
            return response.status(401).json({ success: false, message: 'Phone number or password is incorrect.', code: 'INVALID_CREDENTIALS' });
        if (isInactiveCustomer(user)) {
            const deactivation = await pool.query(
                `SELECT new_value->>'reason' AS reason
                 FROM audit_logs
                 WHERE entity_type = 'user' AND entity_id = $1 AND action = 'CUSTOMER_DEACTIVATE'
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [user.id],
            );
            return response.status(403).json({
                success: false,
                message: inactiveCustomerMessage(deactivation.rows[0]?.reason, user.status),
                code: 'ACCOUNT_DEACTIVATED',
            });
        }
        if (user.status !== 'ACTIVE')
            return response.status(401).json({ success: false, message: 'Phone number or password is incorrect.', code: 'INVALID_CREDENTIALS' });
        const session = await pool.query("INSERT INTO auth_sessions(user_id, expires_at) VALUES ($1, now() + interval '7 days') RETURNING id", [user.id]);
        setSessionCookie(response, user.id, session.rows[0].id);
        response.json({ success: true, data: sanitizeUser(user) });
    }
    catch (error) {
        next(error);
    }
});
authRouter.post('/logout', async (request, response) => {
    const token = request.signedCookies?.mkm_session ?? request.cookies?.mkm_session;
    let claims = null;
    if (typeof token === 'string') {
        try {
            claims = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'mkm-api', audience: 'mkm-client' });
        } catch {
            claims = null;
        }
    }
    if (typeof claims?.sid === 'string' && typeof claims.sub === 'string') {
        try {
            await pool.query(
                'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
                [claims.sid, claims.sub],
            );
        } catch {
            console.error('Logout failed while revoking the active session.');
            return response.status(500).json({
                success: false,
                message: 'Could not complete logout. Please try again.',
                code: 'LOGOUT_FAILED',
            });
        }
    }
    response.clearCookie('mkm_session', clearCookieOptions());
    response.json({ success: true, data: { loggedOut: true } });
});
authRouter.get('/me', requireAuth, async (request, response, next) => {
    try {
        const result = await pool.query(`SELECT u.id, u.full_name, u.phone_number, u.referral_code, u.role, u.status, u.created_at,
        s.full_name AS sponsor_name FROM users u LEFT JOIN users s ON s.id = (
          SELECT referrer_id FROM referrals WHERE referred_user_id = u.id
        ) WHERE u.id = $1`, [request.auth.userId]);
        response.json({ success: true, data: sanitizeUser(result.rows[0]) });
    }
    catch (error) {
        next(error);
    }
});
function sanitizeUser(user) {
    return {
        id: user.id, fullName: user.full_name, phoneNumber: String(user.phone_number).trim(),
        referralCode: user.referral_code, role: user.role, status: user.status,
        ...(user.created_at ? { registeredAt: user.created_at } : {}),
        ...(user.sponsor_name !== undefined ? { sponsorName: user.sponsor_name } : {}),
    };
}
function cookieOptions() {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none', signed: true, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 };
}
function clearCookieOptions() {
    const options = cookieOptions();
    delete options.maxAge;
    return options;
}
function setSessionCookie(response, userId, sessionId) {
    response.cookie('mkm_session', sessionToken(userId, sessionId), cookieOptions());
}
