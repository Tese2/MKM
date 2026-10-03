import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { inTransaction, pool } from './pool.js';
try {
    const paymentMethods = await readFile(new URL('../../../database/seeds/001_payment_methods.sql', import.meta.url), 'utf8');
    const products = await readFile(new URL('../../../database/seeds/002_products.sql', import.meta.url), 'utf8');
    const adminUser = await readFile(new URL('../../../database/seeds/003_admin_user.sql', import.meta.url), 'utf8');
    await inTransaction(async (client) => {
        await client.query(paymentMethods);
        await client.query(products);
        await client.query(adminUser);
        await client.query(`INSERT INTO reward_rules (name, rule_type, threshold_amount, reward_amount, frequency, status)
        VALUES
          ('Daily reward', 'DAILY', 0, 0, 'DAILY', 'ACTIVE'),
          ('Milestone reward', 'MILESTONE', 8000, 800, 'ONCE', 'ACTIVE'),
          ('Weekly reward', 'WEEKLY', 0, 0, 'WEEKLY', 'ACTIVE')`);
    });
    console.log('Initial payment methods, products, admin account, and default reward rules are available.');
}
finally {
    await pool.end();
}
