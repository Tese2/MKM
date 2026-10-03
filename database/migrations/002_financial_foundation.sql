ALTER TABLE wallets
  ADD CONSTRAINT wallets_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE wallet_ledger
  ADD CONSTRAINT wallet_ledger_wallet_user_fkey
  FOREIGN KEY (wallet_id, user_id)
  REFERENCES wallets(id, user_id)
  ON DELETE RESTRICT;

CREATE TABLE referral_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recharge_id UUID NOT NULL REFERENCES recharge_requests(id) ON DELETE RESTRICT,
  beneficiary_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referral_level TEXT NOT NULL CHECK (referral_level IN ('A', 'B', 'C')),
  rate NUMERIC(9,6) NOT NULL CHECK (rate > 0 AND rate <= 100),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  wallet_ledger_id UUID NOT NULL UNIQUE REFERENCES wallet_ledger(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recharge_id, beneficiary_user_id, referral_level)
);

CREATE INDEX referral_commissions_beneficiary_created_idx
  ON referral_commissions(beneficiary_user_id, created_at DESC);

ALTER TABLE reward_claims
  DROP CONSTRAINT reward_claims_user_id_reward_rule_id_key,
  ADD COLUMN period_start DATE,
  ADD CONSTRAINT reward_claims_period_start_monday_check
    CHECK (period_start IS NULL OR EXTRACT(ISODOW FROM period_start) = 1);

CREATE UNIQUE INDEX reward_claims_once_per_user_rule
  ON reward_claims(user_id, reward_rule_id)
  WHERE period_start IS NULL;

CREATE UNIQUE INDEX reward_claims_period_once
  ON reward_claims(user_id, reward_rule_id, period_start)
  WHERE period_start IS NOT NULL;