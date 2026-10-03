CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  phone_number CHAR(9) NOT NULL UNIQUE CHECK (phone_number ~ '^[97][0-9]{8}$'),
  password_hash TEXT NOT NULL,
  withdrawal_password_hash TEXT NOT NULL,
  referral_code VARCHAR(20) NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER', 'ADMIN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_full_name_idx ON users USING gin (to_tsvector('simple', full_name));

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  available_balance NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  pending_balance NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
  locked_balance NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'PRODUCT_PURCHASE', 'DAILY_REWARD', 'REFERRAL_COMMISSION', 'REGISTRATION_BONUS', 'MILESTONE_REWARD', 'WEEKLY_REWARD', 'REFUND', 'ADJUSTMENT', 'WITHDRAWAL_FEE')),
  amount NUMERIC(20,2) NOT NULL CHECK (amount >= 0),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'REVERSED')),
  reference_type TEXT,
  reference_id UUID,
  payment_method_id UUID,
  external_reference TEXT,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transactions_user_created_idx ON transactions(user_id, created_at DESC);
CREATE INDEX transactions_type_status_idx ON transactions(type, status);
CREATE UNIQUE INDEX transactions_external_reference_unique ON transactions(lower(external_reference)) WHERE external_reference IS NOT NULL;

CREATE TABLE wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('REGISTRATION_BONUS', 'DEPOSIT', 'PRODUCT_PURCHASE', 'DAILY_REWARD', 'REFERRAL_COMMISSION', 'MILESTONE_REWARD', 'WEEKLY_REWARD', 'WITHDRAWAL', 'WITHDRAWAL_FEE', 'REFUND', 'ADJUSTMENT')),
  reference_id UUID,
  credit NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  debit NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  balance_after NUMERIC(20,2) NOT NULL CHECK (balance_after >= 0),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING', 'COMPLETED', 'REVERSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((credit > 0 AND debit = 0) OR (debit > 0 AND credit = 0))
);
CREATE INDEX wallet_ledger_user_created_idx ON wallet_ledger(user_id, created_at DESC);
CREATE UNIQUE INDEX wallet_ledger_registration_bonus_once ON wallet_ledger(user_id) WHERE transaction_type = 'REGISTRATION_BONUS';

CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  level TEXT NOT NULL DEFAULT 'A' CHECK (level = 'A'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, referred_user_id),
  CHECK (referrer_id <> referred_user_id)
);
CREATE INDEX referrals_referrer_id_idx ON referrals(referrer_id);
CREATE INDEX referrals_level_idx ON referrals(level);
CREATE INDEX referrals_status_idx ON referrals(status);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price NUMERIC(20,2) NOT NULL CHECK (price > 0),
  daily_rate NUMERIC(9,6) NOT NULL CHECK (daily_rate >= 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMING_SOON', 'AVAILABLE', 'DISABLED', 'EXPIRED')),
  available_from TIMESTAMPTZ,
  available_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (available_until IS NULL OR available_from IS NULL OR available_until > available_from)
);
CREATE INDEX products_status_availability_idx ON products(status, available_from, available_until);

CREATE TABLE product_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_purchases_user_status_idx ON product_purchases(user_id, status);

CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  account_number TEXT,
  account_name TEXT,
  bank_code TEXT,
  phone_number TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recharge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  transaction_reference TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_account TEXT NOT NULL,
  payment_date DATE NOT NULL,
  proof_storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')),
  admin_note TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_method_id, transaction_reference)
);
CREATE INDEX recharge_requests_user_created_idx ON recharge_requests(user_id, created_at DESC);
CREATE INDEX recharge_requests_status_created_idx ON recharge_requests(status, created_at DESC);

CREATE TABLE withdrawal_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method_id UUID REFERENCES payment_methods(id) ON DELETE RESTRICT,
  account_holder_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  phone_number TEXT,
  additional_details TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX withdrawal_accounts_user_idx ON withdrawal_accounts(user_id);
CREATE UNIQUE INDEX withdrawal_accounts_one_default_per_user ON withdrawal_accounts(user_id) WHERE is_default;

CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  withdrawal_account_id UUID REFERENCES withdrawal_accounts(id) ON DELETE SET NULL,
  account_holder_name_snapshot TEXT NOT NULL,
  payment_method_snapshot TEXT NOT NULL,
  account_number_snapshot TEXT NOT NULL,
  phone_number_snapshot TEXT,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  fee NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  net_amount NUMERIC(20,2) NOT NULL CHECK (net_amount >= 0),
  withdrawal_password_verified BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')),
  admin_note TEXT,
  processed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_amount = amount - fee)
);
CREATE INDEX withdrawals_user_created_idx ON withdrawals(user_id, created_at DESC);
CREATE INDEX withdrawals_status_created_idx ON withdrawals(status, created_at DESC);
CREATE UNIQUE INDEX withdrawals_one_pending_per_user ON withdrawals(user_id) WHERE status IN ('PENDING', 'PROCESSING');

CREATE TABLE daily_task_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_purchase_id UUID NOT NULL REFERENCES product_purchases(id) ON DELETE RESTRICT,
  business_date DATE NOT NULL,
  base_amount NUMERIC(20,2) NOT NULL CHECK (base_amount >= 0),
  configured_rate NUMERIC(9,6) NOT NULL CHECK (configured_rate >= 0),
  calculated_amount NUMERIC(20,2) NOT NULL CHECK (calculated_amount >= 0),
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'PROCESSING', 'COMPLETED', 'NOT_ELIGIBLE', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_purchase_id, business_date)
);
CREATE INDEX daily_task_records_status_date_idx ON daily_task_records(status, business_date);

CREATE TABLE reward_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  threshold_amount NUMERIC(20,2) NOT NULL CHECK (threshold_amount >= 0),
  reward_amount NUMERIC(20,2) NOT NULL CHECK (reward_amount >= 0),
  frequency TEXT NOT NULL DEFAULT 'ONCE',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reward_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reward_rule_id UUID NOT NULL REFERENCES reward_rules(id) ON DELETE RESTRICT,
  amount NUMERIC(20,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'CLAIMABLE' CHECK (status IN ('CLAIMABLE', 'PENDING', 'APPROVED', 'REJECTED', 'PAID')),
  requested_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, reward_rule_id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON notifications(user_id, created_at DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings(key, value) VALUES
  ('registration_bonus', '70'::jsonb),
  ('minimum_withdrawal_balance', '70'::jsonb),
  ('minimum_recharge_amount', '1'::jsonb),
  ('maximum_recharge_amount', '1000000'::jsonb),
  ('daily_recharge_limit', '1000000'::jsonb),
  ('monthly_recharge_limit', '10000000'::jsonb),
  ('maximum_pending_recharges', '3'::jsonb),
  ('maximum_withdrawal', '1000000'::jsonb),
  ('withdrawal_fee', '10'::jsonb),
  ('milestone_recharge_threshold', '8000'::jsonb),
  ('milestone_reward_amount', '800'::jsonb),
  ('secondary_milestone_threshold', '20000'::jsonb),
  ('weekly_reward_rate', '10'::jsonb),
  ('referral_rates', '{"A":22,"B":2,"C":1}'::jsonb),
  ('app_download_url', 'null'::jsonb);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys(expires_at);
