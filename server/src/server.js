import 'dotenv/config';
import { app } from './app.js';
import { pool } from './db/pool.js';
import { expireOverduePurchases } from './services/dailyTaskProcessor.js';

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => console.log(`MKM API listening on port ${port}`));

// ---------------------------------------------------------------------------
// Background worker — maintenance and expiration checks every 15 minutes.
// Daily rewards require manual customer claim via Action button.
// ---------------------------------------------------------------------------
const WORKER_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let workerRunning = false;

async function dailyTaskWorker() {
    if (workerRunning) return;
    workerRunning = true;
    try {
        await expireOverduePurchases();
    } catch (error) {
        console.error('Maintenance worker error:', error.message);
    } finally {
        workerRunning = false;
    }
}

const workerTimer = setInterval(dailyTaskWorker, WORKER_INTERVAL_MS);

// Run once shortly after startup (give migrations time to complete)
setTimeout(dailyTaskWorker, 10_000);

async function shutdown() {
    clearInterval(workerTimer);
    server.close(async () => {
        await pool.end();
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
