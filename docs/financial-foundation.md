# Financial Foundation

## Invariants

- Wallet available, pending, and locked balances remain non-negative.
- Every available-balance movement is committed with a matching wallet-ledger row and transaction record.
- Balance, ledger, transaction, business status, and idempotency response changes share one database transaction.
- Wallet-changing operations lock the wallet row and use conditional non-negative balance updates.
- A recharge credits the wallet only when approval and credited timestamps/status are committed together. Rejected and pending requests do not credit.
- Recharge approval, withdrawal status transitions, and product purchase preserve their row locks and state checks in addition to optional idempotency keys.
- A withdrawal reservation debits available balance and increases locked balance atomically; cancellation/rejection refunds available balance and releases locked balance atomically. Completion consumes only the existing locked reservation.
- Wallet-ledger `(wallet_id, user_id)` must reference a wallet owned by that user.
- Future referral commission uniqueness is `(recharge_id, beneficiary_user_id, referral_level)`; calculation and payout are not implemented in Phase 1.
- Daily-task uniqueness remains `(product_purchase_id, business_date)`; the existing unique constraint prevents duplicate task rows for that pair.
- Reward claim periods use `period_start`: `NULL` for one-time claims and the Monday date for a weekly claim. Unique partial indexes prevent duplicate one-time claims and duplicate claims for the same week.

## Idempotency

Clients may send `Idempotency-Key` on supported financial POST operations. The server scopes a hashed key to the authenticated actor and operation, stores the operation name, a request hash, and successful response, and commits it with the business operation. Raw keys and request payloads are not persisted. Same-key payload changes are rejected. The current replay window is 24 hours; requests without the header retain existing endpoint behavior and state/unique protections.

## TLS Follow-Up

TODO: Review Neon TLS certificate verification separately. `server/src/db/pool.js` currently uses `rejectUnauthorized: false`; this Phase 1 change intentionally leaves it untouched.

## Test Isolation

The default Node test suite uses in-memory test doubles and never connects to Neon. PostgreSQL concurrency and constraint integration tests require a separately provisioned test database; production credentials must not be used for tests.