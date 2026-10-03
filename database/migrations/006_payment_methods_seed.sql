INSERT INTO payment_methods (
  name,
  type,
  account_number,
  account_name,
  bank_code,
  phone_number,
  instructions,
  logo_url,
  is_active,
  display_order
)
SELECT 'Awash Bank', 'BANK_TRANSFER', '013201013577300', 'Tesema', 'AWASH', NULL, 'Transfer the amount to Awash Bank and keep the transaction reference for review.', NULL, true, 1
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods WHERE name = 'Awash Bank' AND account_number = '013201013577300'
);

INSERT INTO payment_methods (
  name,
  type,
  account_number,
  account_name,
  bank_code,
  phone_number,
  instructions,
  logo_url,
  is_active,
  display_order
)
SELECT 'Abyssinia Bank', 'BANK_TRANSFER', '221759389', 'Markos', 'ABYSSINIA', NULL, 'Transfer the amount to Abyssinia Bank and keep the transaction reference for review.', NULL, true, 2
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods WHERE name = 'Abyssinia Bank' AND account_number = '221759389'
);

INSERT INTO payment_methods (
  name,
  type,
  account_number,
  account_name,
  bank_code,
  phone_number,
  instructions,
  logo_url,
  is_active,
  display_order
)
SELECT 'CBE', 'BANK_TRANSFER', '1000419637649', 'Tesema', 'CBE', NULL, 'Transfer the amount to CBE and keep the transaction reference for review.', NULL, true, 3
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods WHERE name = 'CBE' AND account_number = '1000419637649'
);

INSERT INTO payment_methods (
  name,
  type,
  account_number,
  account_name,
  bank_code,
  phone_number,
  instructions,
  logo_url,
  is_active,
  display_order
)
SELECT 'Telebirr', 'MOBILE_MONEY', '0929688828', 'Markos', 'TELEBIRR', NULL, 'Send the amount to Telebirr and keep the transaction reference for review.', NULL, true, 4
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods WHERE name = 'Telebirr' AND account_number = '0929688828'
);
