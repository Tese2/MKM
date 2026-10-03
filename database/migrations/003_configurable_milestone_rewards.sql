INSERT INTO reward_rules (name, rule_type, threshold_amount, reward_amount, frequency, status)
SELECT defaults.name, 'MILESTONE', defaults.threshold_amount, defaults.reward_amount, 'ONCE', 'ACTIVE'
FROM (VALUES
  ('5,000 ETB deposit milestone', 5000::numeric, 500::numeric),
  ('8,000 ETB deposit milestone', 8000::numeric, 800::numeric),
  ('20,000 ETB deposit milestone', 20000::numeric, 2000::numeric),
  ('50,000 ETB deposit milestone', 50000::numeric, 8000::numeric)
) AS defaults(name, threshold_amount, reward_amount)
WHERE NOT EXISTS (
  SELECT 1 FROM reward_rules existing
  WHERE existing.rule_type = 'MILESTONE'
    AND existing.threshold_amount = defaults.threshold_amount
);
