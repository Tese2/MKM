import { createHash } from 'node:crypto';

const keyLifetimeMs = 24 * 60 * 60 * 1000;

export async function runIdempotent(client, { userId, operation, key, payload }, execute) {
    if (key === undefined || key === null)
        return execute();
    if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
        throw Object.assign(new Error('Idempotency-Key must be between 8 and 200 characters.'), {
            status: 400,
            code: 'INVALID_IDEMPOTENCY_KEY',
        });
    }

    const idempotencyKey = hash(`${userId}\0${operation}\0${key}`);
    const requestHash = hash(stableSerialize(payload));
    const expiresAt = new Date(Date.now() + keyLifetimeMs);
        const claimed = await client.query(`INSERT INTO idempotency_keys(key, user_id, operation, request_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE SET
       user_id = EXCLUDED.user_id,
             operation = EXCLUDED.operation,
       request_hash = EXCLUDED.request_hash,
       response_status = NULL,
       response_body = NULL,
       created_at = now(),
       expires_at = EXCLUDED.expires_at
     WHERE idempotency_keys.expires_at <= now()
         RETURNING key`, [idempotencyKey, userId, operation, requestHash, expiresAt]);

    if (claimed.rowCount) {
        const result = await execute();
        if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 299) {
            throw new TypeError('Idempotent operations must return a successful HTTP status and response body.');
        }
        const saved = await client.query(`UPDATE idempotency_keys
       SET response_status = $2, response_body = $3::jsonb
       WHERE key = $1 AND user_id = $4`, [idempotencyKey, result.status, JSON.stringify(result.body), userId]);
        if (!saved.rowCount)
            throw new Error('Could not persist the idempotent response.');
        return { ...result, replayed: false };
    }

    const existing = await client.query(`SELECT user_id, operation, request_hash, response_status, response_body
     FROM idempotency_keys WHERE key = $1 FOR UPDATE`, [idempotencyKey]);
    const row = existing.rows[0];
    if (!row || row.user_id !== userId || row.operation !== operation || row.request_hash !== requestHash) {
        throw Object.assign(new Error('This idempotency key was already used with a different request.'), {
            status: 409,
            code: 'IDEMPOTENCY_KEY_CONFLICT',
        });
    }
    if (!row.response_status || row.response_body === null) {
        throw Object.assign(new Error('This idempotent request has no completed response.'), {
            status: 409,
            code: 'IDEMPOTENCY_REQUEST_INCOMPLETE',
        });
    }
    return { status: row.response_status, body: row.response_body, replayed: true };
}

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

function stableSerialize(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableSerialize).join(',')}]`;
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}