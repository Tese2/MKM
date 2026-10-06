import { inTransaction, pool } from '../db/pool.js';
import { postWalletMovement } from './wallet.js';

/**
 * Process a single daily task within an existing transaction.
 *
 * Uses true 24-hour intervals from the purchase activation time:
 *   eligible_at = activated_at + (day_offset + 1) × 24 hours
 *
 * Example — purchase activated at 2026-10-04 14:30 UTC:
 *   Day 0 (2026-10-04) → claimable at 2026-10-05 14:30 UTC
 *   Day 1 (2026-10-05) → claimable at 2026-10-06 14:30 UTC
 */
export async function claimDailyTask(client, { taskId, userId }) {
  const taskResult = await client.query(
    `SELECT dtr.id, dtr.user_id, dtr.product_purchase_id, dtr.business_date,
            dtr.calculated_amount::text AS calculated_amount, dtr.status,
           pp.status AS purchase_status, pp.activated_at,
           (pp.expires_at IS NULL OR pp.expires_at > now()) AS purchase_not_expired
     FROM daily_task_records dtr
     INNER JOIN product_purchases pp ON pp.id = dtr.product_purchase_id
     WHERE dtr.id = $1 FOR UPDATE OF dtr`,
    [taskId],
  );

  if (!taskResult.rowCount) {
    throw Object.assign(new Error('Task not found.'), { status: 404, code: 'NOT_FOUND' });
  }

  const task = taskResult.rows[0];

  if (task.user_id !== userId) {
    throw Object.assign(new Error('This task does not belong to your account.'), { status: 403, code: 'FORBIDDEN' });
  }

  if (task.status !== 'WAITING') {
    throw Object.assign(new Error('This task has already been processed.'), { status: 409, code: 'TASK_ALREADY_PROCESSED' });
  }

  if (task.purchase_status !== 'ACTIVE') {
    throw Object.assign(new Error('The associated purchase is no longer active.'), { status: 409, code: 'PURCHASE_INACTIVE' });
  }
  if (task.purchase_not_expired === false) {
    throw Object.assign(new Error('The associated purchase has expired.'), { status: 409, code: 'PURCHASE_INACTIVE' });
  }

  // True 24-hour check: activated_at + (day_offset + 1) × 24h <= now()
  const dateCheck = await client.query(
    `SELECT now() >= $1::timestamptz + (($2::date - $1::date) + 1) * INTERVAL '24 hours' AS eligible`,
    [task.activated_at, task.business_date],
  );
  if (!dateCheck.rows[0].eligible) {
    throw Object.assign(new Error('This task is not eligible yet. Please wait until the 24-hour earning period completes.'), {
      status: 409, code: 'TASK_NOT_YET_ELIGIBLE',
    });
  }

  // Mark the task as completed
  await client.query(
    "UPDATE daily_task_records SET status = 'COMPLETED' WHERE id = $1",
    [task.id],
  );

  // Credit the reward to the wallet (skip if calculated_amount is zero)
  const amount = task.calculated_amount;
  let availableBalance = null;
  if (Number(amount) > 0) {
    const movement = await postWalletMovement(client, {
      userId: task.user_id,
      amount,
      direction: 'CREDIT',
      transactionType: 'DAILY_REWARD',
      referenceId: task.id,
      referenceType: 'daily_task_record',
      description: `Daily reward – ${task.business_date}`,
    });
    availableBalance = movement.availableBalance;
  }

  return { taskId: task.id, businessDate: task.business_date, amount, availableBalance };
}

/**
 * Auto-process all eligible WAITING tasks for a specific customer.
 *
 * Called transparently during GET /api/tasks so the customer sees up-to-date
 * statuses without needing to click each task individually.
 *
 * Each task is processed in its own transaction so one failure does not
 * block the others.
 */
export async function processEligibleTasksForUser(userId) {
  if (!pool) return [];

  const eligible = await pool.query(
    `SELECT dtr.id
     FROM daily_task_records dtr
     INNER JOIN product_purchases pp ON pp.id = dtr.product_purchase_id
     WHERE dtr.user_id = $1
       AND dtr.status = 'WAITING'
       AND pp.status = 'ACTIVE'
       AND (pp.expires_at IS NULL OR pp.expires_at > now())
       AND now() >= pp.activated_at + ((dtr.business_date - pp.activated_at::date) + 1) * INTERVAL '24 hours'
     ORDER BY dtr.business_date ASC`,
    [userId],
  );

  const results = [];
  for (const row of eligible.rows) {
    try {
      const result = await inTransaction((client) =>
        claimDailyTask(client, { taskId: row.id, userId }),
      );
      results.push(result);
    } catch (error) {
      if (error.code !== 'TASK_ALREADY_PROCESSED') {
        console.error(`Task ${row.id} processing failed:`, error.message);
      }
    }
  }
  return results;
}

/**
 * Background worker: process all eligible tasks across all customers.
 *
 * Called periodically by the server's setInterval worker.
 * Processes in small batches to avoid long-running transactions.
 */
export async function processAllEligibleTasks() {
  if (!pool) return 0;

  // Expire overdue purchases first
  await expireOverduePurchases();

  const eligible = await pool.query(
    `SELECT dtr.id, dtr.user_id
     FROM daily_task_records dtr
     INNER JOIN product_purchases pp ON pp.id = dtr.product_purchase_id
     WHERE dtr.status = 'WAITING'
       AND pp.status = 'ACTIVE'
       AND now() >= pp.activated_at + ((dtr.business_date - pp.activated_at::date) + 1) * INTERVAL '24 hours'
     ORDER BY dtr.business_date ASC
     LIMIT 500`,
  );

  let processed = 0;
  for (const row of eligible.rows) {
    try {
      await inTransaction((client) =>
        claimDailyTask(client, { taskId: row.id, userId: row.user_id }),
      );
      processed += 1;
    } catch (error) {
      if (error.code !== 'TASK_ALREADY_PROCESSED') {
        console.error(`Background: task ${row.id} failed:`, error.message);
      }
    }
  }

  if (processed > 0) {
    console.log(`Daily-task worker: processed ${processed} task(s).`);
  }
  return processed;
}

/**
 * Expire purchases past their expiration date and mark their remaining
 * WAITING tasks as NOT_ELIGIBLE.
 */
export async function expireOverduePurchases() {
  if (!pool) return 0;

  return inTransaction(async (client) => {
    const expired = await client.query(
      `UPDATE product_purchases SET status = 'EXPIRED', updated_at = now()
       WHERE status = 'ACTIVE' AND expires_at <= now()
       RETURNING id, user_id`,
    );

    if (expired.rowCount) {
      const ids = expired.rows.map((row) => row.id);
      await client.query(
        `UPDATE daily_task_records SET status = 'NOT_ELIGIBLE'
         WHERE product_purchase_id = ANY($1::uuid[]) AND status = 'WAITING'`,
        [ids],
      );

      const userIds = [...new Set(expired.rows.map((row) => row.user_id))];
      for (const uid of userIds) {
        await client.query(
          "INSERT INTO notifications(user_id, title, message, type) VALUES ($1, 'Product expired', 'One of your product packages has reached its expiration date.', 'PRODUCT_EXPIRED')",
          [uid],
        );
      }

      console.log(`Expired ${expired.rowCount} purchase(s) and notified ${userIds.length} customer(s).`);
    }

    return expired.rowCount;
  });
}
