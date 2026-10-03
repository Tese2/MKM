ALTER TABLE idempotency_keys
  ADD COLUMN operation TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE idempotency_keys
  ALTER COLUMN operation DROP DEFAULT;