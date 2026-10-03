import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pool } from './db/pool.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { customerRouter } from './routes/customer.js';
import { adminRewardsRouter, adminTasksRouter, notificationsRouter, rewardsRouter, tasksRouter, transactionsRouter } from './routes/portal.js';
import { referralsRouter } from './routes/referrals.js';
import { paymentMethodsRouter, productsRouter } from './routes/products.js';
import { adminRechargesRouter, rechargesRouter } from './routes/recharges.js';
import { profileRouter } from './routes/profile.js';
import { supportRouter, adminSupportRouter } from './routes/support.js';
import { adminWithdrawalsRouter, withdrawalsRouter } from './routes/withdrawals.js';
import { withdrawalAccountsRouter } from './routes/withdrawalAccounts.js';
import { requireTrustedOrigin } from './middleware/trustedOrigin.js';
export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173', credentials: true }));
app.use('/api', requireTrustedOrigin);
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser(process.env.SESSION_SECRET ?? process.env.JWT_SECRET));
app.get('/health', async (_request, response) => {
    const database = pool
        ? await pool.query('SELECT 1 AS ok').then(() => 'ok').catch(() => 'unavailable')
        : 'not-configured';
    response.json({ success: true, data: { status: 'ok', database } });
});
app.get('/api/health', (_request, response) => response.json({ success: true, data: { status: 'ok' } }));
app.use('/api/auth', authRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/products', productsRouter);
app.use('/api/payment-methods', paymentMethodsRouter);
app.use('/api/recharges', rechargesRouter);
app.use('/api/admin/recharges', adminRechargesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/profile', profileRouter);
app.use('/api/withdrawal-accounts', withdrawalAccountsRouter);
app.use('/api/withdrawals', withdrawalsRouter);
app.use('/api/admin/withdrawals', adminWithdrawalsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/rewards', rewardsRouter);
app.use('/api/admin/tasks', adminTasksRouter);
app.use('/api/admin/rewards', adminRewardsRouter);
app.use('/api/support', supportRouter);
app.use('/api/admin/support', adminSupportRouter);
app.use('/api', customerRouter);
app.use((_request, response) => response.status(404).json({ success: false, message: 'This endpoint does not exist.', code: 'NOT_FOUND' }));
const errors = (error, _request, response, _next) => {
    if (error?.code === '23505')
        return response.status(409).json({ success: false, message: 'That phone number or payment reference is already in use.', code: 'CONFLICT' });
    const status = Number(error?.status) || 500;
    if (status >= 500)
        console.error('API request failed:', error);
    response.status(status).json({ success: false, message: status >= 500 ? 'An unexpected error occurred.' : error.message, code: error?.code ?? 'REQUEST_FAILED' });
};
app.use(errors);
