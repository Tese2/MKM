UPDATE reward_rules
SET name = regexp_replace(name, ' ETB deposit milestone$', ' ETB friends recharge reward'),
    updated_at = now()
WHERE rule_type = 'MILESTONE'
  AND name ~ ' ETB deposit milestone$';
