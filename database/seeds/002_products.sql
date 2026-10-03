INSERT INTO products (
  name,
  price,
  daily_rate,
  duration_days,
  description,
  image_url,
  status,
  available_from,
  available_until,
  display_order
)
VALUES
  ('Product 300', 300.00, 0.24, 30, 'Entry level product for daily growth.', NULL, 'AVAILABLE', now(), NULL, 1),
  ('Product 600', 600.00, 0.24, 30, 'Balanced starter package for regular growth.', NULL, 'AVAILABLE', now(), NULL, 2),
  ('Product 1,000', 1000.00, 0.24, 30, 'Balanced purchase for steady progress.', NULL, 'AVAILABLE', now(), NULL, 3),
  ('Product 1,800', 1800.00, 0.24, 30, 'Medium value package with stronger daily return.', NULL, 'AVAILABLE', now(), NULL, 4),
  ('Product 8,000', 8000.00, 0.24, 30, 'Large package for stronger daily accrual.', NULL, 'AVAILABLE', now(), NULL, 5),
  ('Product 20,000', 20000.00, 0.24, 30, 'High-value package for the active customer.', NULL, 'AVAILABLE', now(), NULL, 6),
  ('Product 50,000', 50000.00, 0.24, 30, 'Advanced purchase tier for stronger wallet growth.', NULL, 'AVAILABLE', now(), NULL, 7),
  ('Product 100,000', 100000.00, 0.24, 30, 'Premium package for high-volume customers.', NULL, 'AVAILABLE', now(), NULL, 8)
ON CONFLICT DO NOTHING;
