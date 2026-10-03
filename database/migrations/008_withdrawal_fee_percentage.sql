INSERT INTO settings(key, value)
VALUES ('withdrawal_fee', '10'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = '10'::jsonb, updated_at = now()
WHERE settings.value = '0'::jsonb;
