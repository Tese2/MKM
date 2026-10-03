import pg from 'pg';
import { runInTransaction } from './transaction.js';
export { runInTransaction } from './transaction.js';
const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const useSsl = databaseUrl ? /neon\.tech|sslmode=require/i.test(databaseUrl) || !databaseUrl.includes('localhost') : false;
export const pool = databaseUrl ? new Pool({
    connectionString: databaseUrl,
    max: 15,
    idleTimeoutMillis: 30_000,
    ...(useSsl ? { ssl: { rejectUnauthorized: true } } : {}),
}) : null;
export function getPool() {
    if (!pool) {
        throw new Error('DATABASE_URL must be configured.');
    }
    return pool;
}
export async function inTransaction(operation) {
    const client = await getPool().connect();
    try {
        return await runInTransaction(client, operation);
    }
    finally {
        client.release();
    }
}
