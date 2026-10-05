ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privileges JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'));

-- Ensure any existing administrators have full administrative privileges
UPDATE users
SET is_super_admin = true,
    privileges = '["*"]'::jsonb
WHERE role = 'ADMIN';
