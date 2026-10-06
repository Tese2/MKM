export async function getReferredRechargeTotal(client, userId) {
  const result = await client.query(
    `WITH RECURSIVE team(user_id, depth, path) AS (
       SELECT referred_user_id, 1, ARRAY[$1::uuid, referred_user_id]
       FROM referrals
       WHERE referrer_id = $1 AND status = 'ACTIVE'
       UNION ALL
       SELECT r.referred_user_id, t.depth + 1, t.path || r.referred_user_id
       FROM referrals r
       JOIN team t ON r.referrer_id = t.user_id
       WHERE t.depth < 3
         AND r.status = 'ACTIVE'
         AND NOT r.referred_user_id = ANY(t.path)
     )
     SELECT coalesce(sum(rr.amount), 0)::text AS total
     FROM team t
     JOIN recharge_requests rr ON rr.user_id = t.user_id
     WHERE rr.status = 'APPROVED' AND rr.credited_at IS NOT NULL`,
    [userId],
  );
  return result.rows[0]?.total ?? '0.00';
}
