ALTER TABLE product_purchases
  ADD CONSTRAINT product_purchases_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE daily_task_records
  ADD CONSTRAINT daily_task_records_purchase_user_fkey
  FOREIGN KEY (product_purchase_id, user_id)
  REFERENCES product_purchases(id, user_id)
  ON DELETE RESTRICT;

ALTER TABLE wallet_ledger
  ADD CONSTRAINT wallet_ledger_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE transactions
  ADD CONSTRAINT transactions_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE referral_commissions
  ADD CONSTRAINT referral_commissions_ledger_beneficiary_fkey
  FOREIGN KEY (wallet_ledger_id, beneficiary_user_id)
  REFERENCES wallet_ledger(id, user_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT referral_commissions_transaction_beneficiary_fkey
  FOREIGN KEY (transaction_id, beneficiary_user_id)
  REFERENCES transactions(id, user_id)
  ON DELETE RESTRICT;