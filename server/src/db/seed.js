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
        SELECT defaults.name, defaults.rule_type, defaults.threshold_amount, defaults.reward_amount, defaults.frequency, defaults.status
        FROM (VALUES
          ('Daily reward', 'DAILY', 0::numeric, 0::numeric, 'DAILY', 'ACTIVE'),
          ('5,000 ETB friends recharge reward', 'MILESTONE', 5000::numeric, 500::numeric, 'ONCE', 'ACTIVE'),
          ('8,000 ETB friends recharge reward', 'MILESTONE', 8000::numeric, 800::numeric, 'ONCE', 'ACTIVE'),
          ('20,000 ETB friends recharge reward', 'MILESTONE', 20000::numeric, 2000::numeric, 'ONCE', 'ACTIVE'),
          ('50,000 ETB friends recharge reward', 'MILESTONE', 50000::numeric, 8000::numeric, 'ONCE', 'ACTIVE'),
          ('Weekly reward', 'WEEKLY', 0::numeric, 0::numeric, 'WEEKLY', 'ACTIVE')
        ) AS defaults(name, rule_type, threshold_amount, reward_amount, frequency, status)
        WHERE NOT EXISTS (
          SELECT 1 FROM reward_rules existing
          WHERE existing.rule_type = defaults.rule_type
            AND existing.threshold_amount = defaults.threshold_amount
        )`);
    });
    console.log('Initial payment methods, products, admin account, and default reward rules are available.');
}
finally {
    await pool.end();
}
