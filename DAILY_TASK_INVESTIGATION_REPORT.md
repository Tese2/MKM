# MKM — Daily Task Investigation Report

**Date:** 2026-10-04  
**Status:** Investigation complete — NO code changes made  
**Investigator:** Antigravity automated code audit

---

## 1. Existing Purchase Flow

### How a customer purchases a product

| Step | Code Location | What Happens |
|------|--------------|--------------|
| 1 | `POST /api/products/:productId/purchase` | Customer sends purchase request |
| 2 | [`products.js` L55](file:///d:/MKM/server/src/routes/products.js#L55) | Product fetched with `FOR UPDATE` lock |
| 3 | [`products.js` L59](file:///d:/MKM/server/src/routes/products.js#L59) | Product status must be `AVAILABLE` and within availability window |
| 4 | [`products.js` L62](file:///d:/MKM/server/src/routes/products.js#L62) | User must be `ACTIVE` |
| 5 | [`products.js` L65](file:///d:/MKM/server/src/routes/products.js#L65) | Duplicate active-purchase check |
| 6 | [`products.js` L68](file:///d:/MKM/server/src/routes/products.js#L68) | Wallet locked with `FOR UPDATE` |
| 7 | [`products.js` L72-73](file:///d:/MKM/server/src/routes/products.js#L72-L73) | **Purchase inserted as `ACTIVE` immediately**, `activated_at = now()`, `expires_at = now() + duration_days` |
| 8 | [`products.js` L74-85](file:///d:/MKM/server/src/routes/products.js#L74-L85) | Wallet debited via `postWalletMovement()` — full transactional integrity |
| 9 | [`products.js` L86-97](file:///d:/MKM/server/src/routes/products.js#L86-L97) | **All daily task records pre-generated** for the entire product duration |
| 10 | [`products.js` L98](file:///d:/MKM/server/src/routes/products.js#L98) | Notification created: "Product activated" |

### Purchase findings

- ✅ Purchase is created correctly
- ✅ Status is `ACTIVE` immediately (no pending/approval stage)
- ✅ `activated_at` is set to `now()` at purchase time
- ✅ `expires_at` is correctly calculated as `now() + duration_days`
- ✅ Purchase is wrapped in a database transaction with idempotency protection
- ✅ Wallet debit happens inside the same transaction (atomicity guaranteed)
- ✅ Duplicate active purchase is prevented (`SELECT 1 ... WHERE status = 'ACTIVE'`)

---

## 2. Existing Daily-Task Flow

### How daily tasks are generated

Daily tasks are generated **entirely at purchase time** via `buildDailyTaskForecast()`:

```javascript
// rewardEngine.js — lines 26-49
export function buildDailyTaskForecast({ amount, dailyRate, activatedAt, expiresAt }) {
  const start = new Date(activatedAt ?? Date.now());
  const end = new Date(expiresAt ?? activatedAt ?? Date.now());
  const rows = [];
  const startDate = new Date(start);
  startDate.setUTCHours(0, 0, 0, 0);    // ← truncated to UTC midnight
  const endDate = new Date(end);
  endDate.setUTCHours(0, 0, 0, 0);      // ← truncated to UTC midnight
  for (let cursor = new Date(startDate); cursor <= endDate;
       cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const calculatedAmount = Number((Number(amount ?? 0) * Number(dailyRate ?? 0)).toFixed(2));
    rows.push({
      businessDate: cursor.toISOString().slice(0, 10),
      baseAmount: calculatedAmount.toFixed(2),
      configuredRate: Number(dailyRate ?? 0).toFixed(6),
      calculatedAmount: calculatedAmount.toFixed(2),
      status: 'WAITING',       // ← every task starts as WAITING
    });
  }
  return rows;
}
```

Then inserted into `daily_task_records`:

```javascript
// products.js — lines 92-97
for (const row of taskRows) {
  await client.query(
    `INSERT INTO daily_task_records (...) VALUES ($1, $2, $3::date, $4, $5, $6, $7)
     ON CONFLICT (product_purchase_id, business_date) DO NOTHING`,
    [request.auth.userId, record.rows[0].id, row.businessDate, ...]
  );
}
```

### Task generation findings

- ✅ All task records for the full product duration are created at purchase time
- ✅ `ON CONFLICT DO NOTHING` prevents duplicates
- ✅ Each task has a unique `(product_purchase_id, business_date)` constraint
- ✅ Amounts are calculated server-side from the product's actual `price` and `daily_rate`
- ⚠️ **Every task is created with status `WAITING`**
- 🔴 **No code exists anywhere in the codebase to transition tasks from `WAITING` → `COMPLETED`**
- 🔴 **No code exists to credit the daily reward to the customer's wallet**

---

## 3. Exact 24-Hour Logic

### Current implementation

The forecast function uses **calendar-date (UTC midnight) boundaries**, NOT true 24-hour intervals:

```javascript
startDate.setUTCHours(0, 0, 0, 0);  // truncate to midnight UTC
endDate.setUTCHours(0, 0, 0, 0);    // truncate to midnight UTC
```

**Example:**

| Event | Timestamp |
|-------|-----------|
| Purchase | 2026-10-04 14:30 UTC |
| First `business_date` | `2026-10-04` (today, even though only 9.5 hours remain) |
| Second `business_date` | `2026-10-05` |
| Third `business_date` | `2026-10-06` |

This is a **calendar-day model**, not a rolling 24-hour-from-activation model. However, this is consistent across the codebase and works correctly for the task-generation step itself.

### Observation

The `business_date` field uses type `DATE`, not `TIMESTAMPTZ`. The system identifies daily cycles by calendar date, which is a valid design — but note that it means:

- A purchase at 23:59 UTC generates a task for "today" and "tomorrow" as two separate days
- There is no "hours remaining" or "eligible after X hours" logic

This is **not the root cause** of the bug. The tasks are generated correctly. The problem is that nothing ever processes them.

---

## 4. Scheduler / Background-Job Behavior

> [!CAUTION]
> **There is NO scheduler, cron job, worker process, or background task of any kind in the MKM server.**

### Evidence

| Search Term | Files Found |
|-------------|-------------|
| `cron` | 0 matches |
| `setInterval` | 0 matches |
| `setTimeout` | 0 matches |
| `scheduler` | 0 matches |
| `worker` | 0 matches |
| `agenda` | 0 matches |
| `bull` | 0 matches |
| `node-cron` | 0 matches |

The server startup ([`server.js`](file:///d:/MKM/server/src/server.js)) contains only:

```javascript
const server = app.listen(port, () => console.log(`MKM API listening on port ${port}`));
```

No background processes are started. The server is a pure HTTP request/response server.

### Server dependencies

From [`server/package.json`](file:///d:/MKM/server/package.json): no scheduling libraries are installed.

---

## 5. Database Findings

### `product_purchases` schema

```sql
CREATE TABLE product_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_purchases_user_status_idx ON product_purchases(user_id, status);
```

- ✅ Foreign keys to `users` and `products`
- ✅ `activated_at` and `expires_at` timestamps present
- ⚠️ No mechanism to transition `ACTIVE` → `EXPIRED` when `expires_at` passes

### `daily_task_records` schema

```sql
CREATE TABLE daily_task_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_purchase_id UUID NOT NULL REFERENCES product_purchases(id) ON DELETE RESTRICT,
  business_date DATE NOT NULL,
  base_amount NUMERIC(20,2) NOT NULL CHECK (base_amount >= 0),
  configured_rate NUMERIC(9,6) NOT NULL CHECK (configured_rate >= 0),
  calculated_amount NUMERIC(20,2) NOT NULL CHECK (calculated_amount >= 0),
  status TEXT NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'PROCESSING', 'COMPLETED', 'NOT_ELIGIBLE', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_purchase_id, business_date)
);
CREATE INDEX daily_task_records_status_date_idx ON daily_task_records(status, business_date);
```

- ✅ Foreign keys to `users` and `product_purchases`
- ✅ `UNIQUE (product_purchase_id, business_date)` prevents duplicate daily tasks
- ✅ Status values (`WAITING`, `PROCESSING`, `COMPLETED`, `NOT_ELIGIBLE`, `FAILED`) are well-designed
- ✅ Index on `(status, business_date)` is suitable for batch processing queries
- 🔴 **No code ever UPDATEs the `status` column of this table**

### `wallet_ledger` and `transactions`

- ✅ Support `DAILY_REWARD` transaction type
- ✅ `postWalletMovement()` is transactional with balance checks
- 🔴 **`DAILY_REWARD` transaction type is never used anywhere in the codebase**

Searching for `DAILY_REWARD` usage:

| Location | Usage |
|----------|-------|
| `001_initial_schema.sql` L39 | Defined in `transactions.type` CHECK constraint |
| `001_initial_schema.sql` L59 | Defined in `wallet_ledger.transaction_type` CHECK constraint |
| **Application code** | **NEVER USED** |

---

## 6. API Findings

### Customer task retrieval endpoint

```
GET /api/tasks
```

[`portal.js` L96-113](file:///d:/MKM/server/src/routes/portal.js#L96-L113):

```javascript
tasksRouter.get('/', async (request, response, next) => {
    const result = await pool.query(`
      SELECT dtr.id, dtr.business_date AS "businessDate", dtr.status,
             dtr.calculated_amount::text AS "calculatedAmount",
             dtr.base_amount::text AS "baseAmount",
             dtr.configured_rate::text AS "configuredRate",
             p.name AS "productName", count(*) OVER()::int AS "totalCount"
      FROM daily_task_records dtr
      INNER JOIN product_purchases pp ON pp.id = dtr.product_purchase_id
      INNER JOIN products p ON p.id = pp.product_id
      WHERE dtr.user_id = $1
      ORDER BY dtr.business_date DESC, dtr.created_at DESC LIMIT 30`,
      [request.auth.userId]);
    ...
});
```

- ✅ Uses `request.auth.userId` from server-validated JWT session
- ✅ Customer can only see their own tasks (`WHERE dtr.user_id = $1`)
- ✅ Joins through `product_purchases` → `products` for product name
- ⚠️ Does NOT filter by purchase status (shows tasks even for expired purchases)
- ⚠️ Does NOT filter by `business_date <= CURRENT_DATE` (shows future tasks too)
- 🔴 **All tasks will always show as `WAITING`** because nothing transitions them

### Missing endpoints

| Endpoint | Purpose | Exists? |
|----------|---------|---------|
| `POST /api/tasks/:taskId/claim` | Customer claims a daily task | ❌ **DOES NOT EXIST** |
| `POST /api/tasks/:taskId/complete` | Complete/process a daily task | ❌ **DOES NOT EXIST** |
| Any admin task-processing endpoint | Admin or system processes tasks | ❌ **DOES NOT EXIST** |

### Admin task view endpoint

```
GET /api/admin/tasks
```

- Read-only listing of all daily task records
- ✅ Admin-only access
- No action endpoints (approve, process, complete)

---

## 7. Frontend Findings

### Customer Tasks Page

[`App.jsx`](file:///d:/MKM/client/src/App.jsx) — `TasksPage` component:

```javascript
function TasksPage() {
  const [tasks, setTasks] = useState({ items: [], summary: {} });
  useEffect(() => {
    api('/tasks').then(setTasks).catch(() => setTasks({ items: [], summary: {} }));
  }, []);
  // ... renders task list with StatusBadge
}
```

- ✅ Fetches from `/api/tasks` on mount
- ✅ Displays task records with status badges
- ⚠️ No "claim" or "complete" button exists
- ⚠️ No timer, no polling, no frontend-driven task processing
- The frontend is **display-only** for tasks — it cannot trigger task completion

### Summary

The frontend correctly shows the tasks and does NOT attempt to control task lifecycle. This is the correct architecture (server-side processing). However, the server-side processing does not exist.

---

## 8. Exact Root Cause

> [!CAUTION]
> ### ROOT CAUSE: The daily task completion/reward pipeline was never implemented.

The system has two halves of a complete pipeline:

| Half | Status | What exists |
|------|--------|-------------|
| **Task Generation** (at purchase) | ✅ Fully implemented | `buildDailyTaskForecast()` → INSERT into `daily_task_records` |
| **Task Processing** (daily reward credit) | 🔴 **NOT IMPLEMENTED** | No code transitions `WAITING` → `COMPLETED`, no code credits rewards to wallet |

Specifically, the following **do not exist** anywhere in the codebase:

1. **No `UPDATE daily_task_records SET status = ...`** — no code ever changes a task's status
2. **No daily reward wallet credit** — `postWalletMovement()` is never called with `transactionType: 'DAILY_REWARD'`
3. **No task claim/complete API endpoint** — no `POST /api/tasks/:id/claim` or equivalent
4. **No background processor** — no cron, scheduler, or worker
5. **No request-time generation** — the task retrieval endpoint (`GET /api/tasks`) is read-only; it does not process or complete tasks on access

### What happens today

1. Customer purchases product → ✅ works
2. `daily_task_records` rows created with `status = 'WAITING'` → ✅ works
3. Customer opens Tasks page → sees all tasks as `WAITING` forever
4. **No mechanism exists to complete tasks or credit rewards**
5. Customer never receives daily income

### Secondary issue

`product_purchases.status` is never transitioned from `ACTIVE` → `EXPIRED` when `expires_at` passes. This is a separate but related issue — purchases remain `ACTIVE` in the database indefinitely.

---

## 9. Recommended Minimal Fix

> [!IMPORTANT]
> The fix must add a **task completion mechanism** without changing any existing business rules.

### Option A: Request-time processing (RECOMMENDED for initial deployment)

Add a **server-side function** that runs when the customer views their tasks (`GET /api/tasks`) or on a dedicated claim endpoint:

1. Query `daily_task_records` where:
   - `status = 'WAITING'`
   - `business_date < CURRENT_DATE` (the calendar day has fully passed)
   - The associated `product_purchase` is still `ACTIVE` and not expired
   - The task belongs to the requesting user

2. For each eligible task, in a transaction:
   - Update `daily_task_records SET status = 'COMPLETED'`
   - Call `postWalletMovement()` with `transactionType: 'DAILY_REWARD'`, `direction: 'CREDIT'`, `amount: calculated_amount`
   - Record in `wallet_ledger` and `transactions`

3. Return the updated task list

**Pros:** No new infrastructure needed, works with current Express-only deployment.  
**Cons:** Tasks only process when customer visits; slight delay until first visit.

### Option B: Explicit claim endpoint

Add `POST /api/tasks/:taskId/claim`:

1. Customer explicitly clicks "Claim" on an eligible task
2. Server validates eligibility (same checks as Option A)
3. Processes the single task in a transaction
4. Returns result

**Pros:** Customer has explicit control; clear UX.  
**Cons:** Requires frontend "Claim" button addition; tasks still depend on customer action.

### Option C: Scheduled background worker (RECOMMENDED for production)

Add a lightweight cron job (e.g., `node-cron`) in `server.js`:

1. Runs every hour (or every few minutes)
2. Queries all `WAITING` tasks where `business_date < CURRENT_DATE` and purchase is active
3. Processes each in a transaction
4. Completely independent of customer browser activity

**Pros:** Fully automatic; works even if customer never logs in.  
**Cons:** Requires adding a dependency; slightly more complexity.

### Recommended approach

**Combine Options A and C:**

- **Option A** provides immediate processing when the customer checks their tasks (good UX)
- **Option C** ensures processing happens even if the customer doesn't log in (reliability)
- Both must use the same transactional processing function
- Both must respect the `UNIQUE (product_purchase_id, business_date)` constraint and use `status = 'WAITING'` as a guard to prevent double-processing

### Additional fixes needed

1. **Expire purchases:** Add logic to mark `product_purchases` as `EXPIRED` when `expires_at < now()` (either via background job or request-time check)
2. **Filter future tasks:** `GET /api/tasks` should not show tasks with `business_date > CURRENT_DATE`, or should clearly mark them as "upcoming"
3. **Referral commission on daily reward:** Verify whether daily rewards should trigger referral commissions (currently, referral commissions only fire on recharge approval in [`referralEngine.js`](file:///d:/MKM/server/src/lib/referralEngine.js))

---

## 10. Files That Would Need Modification

| File | Change | Scope |
|------|--------|-------|
| [`server/src/routes/portal.js`](file:///d:/MKM/server/src/routes/portal.js) | Add task-processing logic to `GET /api/tasks` or add `POST /api/tasks/:taskId/claim` endpoint | ~50 lines |
| [`server/src/services/wallet.js`](file:///d:/MKM/server/src/services/wallet.js) | No changes needed — `postWalletMovement()` already supports `DAILY_REWARD` | 0 lines |
| [`server/src/lib/rewardEngine.js`](file:///d:/MKM/server/src/lib/rewardEngine.js) | No changes needed — task generation is correct | 0 lines |
| [`server/src/server.js`](file:///d:/MKM/server/src/server.js) | *Optional:* Add background worker/cron for automatic processing | ~30 lines |
| [`server/src/routes/products.js`](file:///d:/MKM/server/src/routes/products.js) | No changes to purchase flow | 0 lines |
| [`client/src/App.jsx`](file:///d:/MKM/client/src/App.jsx) | *Optional:* Add "Claim" button to TasksPage if using Option B | ~20 lines |
| [`server/src/routes/customer.js`](file:///d:/MKM/server/src/routes/customer.js) | *Optional:* Add daily earnings to dashboard summary | ~10 lines |

### Files that must NOT be changed

| File | Reason |
|------|--------|
| `rewardEngine.js` (task forecast) | Task generation logic is correct |
| `wallet.js` (postWalletMovement) | Wallet engine is correct and already supports DAILY_REWARD |
| Recharge routes | Recharge flow (Customer → PENDING → Admin) must not change |
| Withdrawal routes | Withdrawal flow (Customer → PENDING → Admin) must not change |
| Referral engine | Commission rates and logic must not change |
| Database schema (existing tables) | Schema supports the fix without migration changes |

---

## 11. Tests Required After the Fix

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | Purchase a product | Purchase created with `status = 'ACTIVE'`, `activated_at = now()` |
| 2 | Verify daily_task_records | All rows created with `status = 'WAITING'`, correct `business_date` range |
| 3 | Call GET /api/tasks on same day as purchase | Today's task should show (either as WAITING or as processable depending on design) |
| 4 | Call GET /api/tasks after business_date has passed | Past tasks should be processed to `COMPLETED`, wallet credited |
| 5 | Verify wallet_ledger | `DAILY_REWARD` entry with correct `calculated_amount` as credit |
| 6 | Verify transactions | `DAILY_REWARD` transaction recorded |
| 7 | Call GET /api/tasks again | Already-completed tasks remain `COMPLETED` (no duplicate processing) |
| 8 | Attempt to process same task twice | Should be safely rejected (idempotent) |
| 9 | Attempt to claim another user's task | Should fail — ownership enforced via `request.auth.userId` |
| 10 | Attempt to claim task before business_date passes | Should fail — task is not yet eligible |
| 11 | Attempt to claim task after purchase expired | Should fail — purchase no longer `ACTIVE` |
| 12 | Verify wallet balance cannot go negative | Wallet CHECK constraint prevents negative balance (credit-only for rewards, so this is inherently safe) |
| 13 | Concurrent claim attempts | Transaction isolation + unique constraint must prevent double-credit |
| 14 | Purchase expiration | After `expires_at`, purchase should be marked `EXPIRED`, remaining WAITING tasks should be marked `NOT_ELIGIBLE` |

### Recommended test approach

Use controlled timestamps rather than waiting 24 hours:

```sql
-- Create a purchase with backdated activation for testing
INSERT INTO product_purchases(..., activated_at, expires_at)
VALUES (..., now() - INTERVAL '3 days', now() + INTERVAL '27 days');

-- Insert task records with past business_dates
INSERT INTO daily_task_records(..., business_date, status)
VALUES (..., CURRENT_DATE - 2, 'WAITING'),
       (..., CURRENT_DATE - 1, 'WAITING'),
       (..., CURRENT_DATE, 'WAITING');  -- today: should NOT be eligible yet
```

---

## Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     CURRENT STATE                               │
│                                                                 │
│  Purchase ──→ Task Records Created ──→ All status = 'WAITING'  │
│                                           │                     │
│                                           ▼                     │
│                                    ╔═══════════╗               │
│                                    ║  DEAD END  ║               │
│                                    ╚═══════════╝               │
│                                                                 │
│  Missing: WAITING → COMPLETED transition                        │
│  Missing: DAILY_REWARD wallet credit                            │
│  Missing: Background processor OR claim endpoint                │
└─────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────┐
│                     REQUIRED STATE                              │
│                                                                 │
│  Purchase ──→ Task Records Created ──→ status = 'WAITING'      │
│                                           │                     │
│                                     (24h passes)                │
│                                           │                     │
│                                           ▼                     │
│                                  Process eligible task          │
│                                     (server-side)               │
│                                           │                     │
│                                    ┌──────┴──────┐              │
│                                    ▼             ▼              │
│                              status =      postWalletMovement   │
│                             'COMPLETED'    DAILY_REWARD CREDIT  │
│                                    │             │              │
│                                    ▼             ▼              │
│                              wallet_ledger + transactions       │
│                              record the reward credit           │
└─────────────────────────────────────────────────────────────────┘
```

> [!WARNING]
> **No code changes have been made.** This report is investigation-only. The fix should be reviewed and approved before implementation.
