INSERT INTO users (
  full_name,
  phone_number,
  password_hash,
  withdrawal_password_hash,
  referral_code,
  role,
  status
)
SELECT 'MKM Administrator', '900000000', '$argon2id$v=19$m=65536,t=3,p=4$9mW+Uant8ReQdjzh4dqGag$4aH3BtR9oOL7ekJFed1G0eAzGoS7sI+OC4qKiOYN3es', '$argon2id$v=19$m=65536,t=3,p=4$9mW+Uant8ReQdjzh4dqGag$4aH3BtR9oOL7ekJFed1G0eAzGoS7sI+OC4qKiOYN3es', 'MKM-ADMIN', 'ADMIN', 'ACTIVE'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE phone_number = '900000000'
);

INSERT INTO wallets (user_id)
SELECT u.id
FROM users u
LEFT JOIN wallets w ON w.user_id = u.id
WHERE u.phone_number = '900000000' AND w.id IS NULL;
