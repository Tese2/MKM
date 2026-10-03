const money = (amount) => `${Number(amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;

function Metric({ label, value, tone = 'default' }) {
  return (
    <div className='metric'>
      <span>{label}</span>
      <strong className={tone === 'success' ? 'green' : ''}>{value}</strong>
      <small>LIVE</small>
    </div>
  );
}

export default function AdminDashboard({ stats }) {
  const data = stats ?? {};

  return (
    <>
      <div className='metric-grid'>
        <Metric label='Total customers' value={data.total_customers ?? 0} />
        <Metric label='Active customers' value={data.active_customers ?? 0} />
        <Metric label='Pending recharges' value={data.pending_recharges ?? 0} tone='success' />
        <Metric label='Approved recharge total' value={money(data.approved_recharge_total ?? 0)} tone='success' />
        <Metric label='Pending withdrawals' value={data.pending_withdrawals ?? 0} />
        <Metric label='Completed withdrawal total' value={money(data.completed_withdrawal_total ?? 0)} tone='success' />
        <Metric label='Total products' value={data.total_products ?? 0} />
        <Metric label='Active products' value={data.active_products ?? 0} tone='success' />
      </div>

      <section className='surface'>
        <div className='surface-heading'>
          <div>
            <p className='eyebrow'>SUMMARY</p>
            <h3>Financial overview</h3>
          </div>
        </div>
        <div className='metric-grid'>
          <Metric label='Available wallet balance' value={money(data.total_available_balance ?? 0)} />
          <Metric label='Locked wallet balance' value={money(data.total_locked_balance ?? 0)} />
          <Metric label='Rejected recharges' value={data.rejected_recharges ?? 0} />
          <Metric label='Remaining active inventory' value={data.active_products ?? 0} />
        </div>
      </section>
    </>
  );
}
