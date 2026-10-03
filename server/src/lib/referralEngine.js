function decimalToCents(value) {
  const [whole, fraction = ''] = String(value ?? '0').split('.');
  return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
}

function centsToDecimal(value) {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

export async function fetchSponsorLevels(client, userId) {
  const result = await client.query(`WITH RECURSIVE sponsor_chain AS (
    SELECT referred_user_id, referrer_id, 1 AS depth
    FROM referrals
    WHERE referred_user_id = $1 AND status = 'ACTIVE'
    UNION ALL
    SELECT sc.referred_user_id, r.referrer_id, sc.depth + 1
    FROM referrals r
    JOIN sponsor_chain sc ON sc.referrer_id = r.referred_user_id
    WHERE sc.depth < 3 AND r.status = 'ACTIVE'
  )
  SELECT referrer_id AS "userId",
         CASE depth
           WHEN 1 THEN 'A'
           WHEN 2 THEN 'B'
           ELSE 'C'
         END AS level
  FROM sponsor_chain
  WHERE depth <= 3
  ORDER BY depth ASC`, [userId]);

  return result.rows.map((row) => ({ userId: row.userId, level: String(row.level) }));
}

export function buildReferralCommissions({ rechargeAmount, sponsorLevels, rates }) {
  const rateMap = {
    A: Number(rates?.A ?? 22),
    B: Number(rates?.B ?? 2),
    C: Number(rates?.C ?? 1),
  };

  return sponsorLevels
    .map(({ userId, level }) => {
      const levelCode = String(level ?? '').toUpperCase();
      const rate = Number(rateMap[levelCode] ?? 0);
      const commissionCents = decimalToCents(rechargeAmount) * BigInt(Math.round(rate * 100)) / 10000n;
      return {
        userId,
        level: levelCode,
        rate,
        amount: centsToDecimal(commissionCents),
      };
    })
    .filter((item) => item.amount !== '0.00');
}
