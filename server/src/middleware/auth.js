import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
function jwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32)
        throw new Error('JWT_SECRET must contain at least 32 characters.');
    return secret;
}
export async function requireAuth(request, response, next) {
    try {
        const token = request.signedCookies?.mkm_session ?? request.cookies?.mkm_session;
        if (!token)
            return response.status(401).json({ success: false, message: 'Sign in to continue.', code: 'AUTH_REQUIRED' });
        const claims = jwt.verify(token, jwtSecret(), { issuer: 'mkm-api', audience: 'mkm-client' });
        if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string')
            throw new Error('Invalid session claims.');
        const result = await pool.query(`SELECT u.id, u.role, u.status,
            coalesce(u.is_super_admin, false) AS "isSuperAdmin",
            coalesce(u.privileges, '[]'::jsonb) AS privileges
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
         AND s.expires_at > now() AND u.status = 'ACTIVE'`, [claims.sid, claims.sub]);
        if (!result.rowCount)
            return response.status(401).json({ success: false, message: 'Your session has expired.', code: 'SESSION_EXPIRED' });
        request.auth = {
            userId: result.rows[0].id,
            sessionId: claims.sid,
            role: result.rows[0].role,
            isSuperAdmin: Boolean(result.rows[0].isSuperAdmin),
            privileges: Array.isArray(result.rows[0].privileges) ? result.rows[0].privileges : [],
        };
        next();
    }
    catch {
        response.status(401).json({ success: false, message: 'Please sign in again.', code: 'INVALID_SESSION' });
    }
}
export function requireAdmin(request, response, next) {
    if (request.auth?.role !== 'ADMIN')
        return response.status(403).json({ success: false, message: 'Administrator access is required.', code: 'FORBIDDEN' });
    next();
}
export function requireAdminPrivilege(requiredPrivilege) {
    return (request, response, next) => {
        if (request.auth?.role !== 'ADMIN')
            return response.status(403).json({ success: false, message: 'Administrator access is required.', code: 'FORBIDDEN' });
        if (request.auth.isSuperAdmin || request.auth.privileges?.includes('*') || request.auth.privileges?.includes(requiredPrivilege)) {
            return next();
        }
        return response.status(403).json({
            success: false,
            message: `Permission denied: ${requiredPrivilege} is required.`,
            code: 'FORBIDDEN_PRIVILEGE',
            requiredPrivilege,
        });
    };
}
export function sessionToken(userId, sessionId) {
    return jwt.sign({ sid: sessionId }, jwtSecret(), { subject: userId, expiresIn: '7d', issuer: 'mkm-api', audience: 'mkm-client' });
}
