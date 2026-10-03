import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { pool } from './pool.js';
try {
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const directory = new URL('../../../database/migrations/', import.meta.url);
    const migrations = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    let appliedCount = 0;
    for (const filename of migrations) {
        const id = filename.slice(0, -4);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SELECT pg_advisory_xact_lock(hashtext('mkm-schema-migrations'))");
            const existing = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [id]);
            if (existing.rowCount) {
                await client.query('COMMIT');
                continue;
            }
            const migration = await readFile(new URL(filename, directory), 'utf8');
            await client.query(migration);
            await client.query('INSERT INTO schema_migrations(id) VALUES ($1)', [id]);
            await client.query('COMMIT');
            appliedCount += 1;
            console.log(`Applied migration ${id}.`);
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    if (!appliedCount)
        console.log('MKM database schema is up to date.');
}
finally {
    await pool.end();
}
