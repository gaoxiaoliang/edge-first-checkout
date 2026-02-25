import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000'

export function DashboardApp() {
  const [overview, setOverview] = useState(null)
  const [kiosks, setKiosks] = useState([])
  const [error, setError] = useState('')

  async function refresh() {
    try {
      const [overviewRes, kioskRes] = await Promise.all([
        fetch(`${API_BASE}/dashboard/overview`),
        fetch(`${API_BASE}/dashboard/kiosks`),
      ])
      setOverview(await overviewRes.json())
      setKiosks(await kioskRes.json())
      setError('')
    } catch {
      setError('Dashboard cannot reach API')
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [])

  return (
    <main>
      <h1>ICA Self-Checkout Fleet Dashboard</h1>
      <button onClick={refresh}>Refresh now</button>
      {error && <p className="err">{error}</p>}

      {overview && (
        <section className="cards">
          <article>Total kiosks: {overview.total_kiosks}</article>
          <article>Online kiosks: {overview.online_kiosks}</article>
          <article>Offline kiosks: {overview.offline_kiosks}</article>
          <article>Pending sync orders: {overview.pending_sync_orders}</article>
          <article>Central orders: {overview.central_orders}</article>
          <article>Central revenue: {overview.central_revenue.toFixed(2)} SEK</article>
        </section>
      )}

      <section>
        <h2>Kiosk-Level Metrics</h2>
        <table>
          <thead>
            <tr>
              <th>Kiosk</th>
              <th>Status</th>
              <th>Central Link</th>
              <th>Edge Orders</th>
              <th>Edge Amount</th>
              <th>Central Orders</th>
              <th>Central Amount</th>
              <th>Pending Sync</th>
              <th>Last Heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {kiosks.map((k) => (
              <tr key={k.kiosk_id}>
                <td>{k.kiosk_id}</td>
                <td>{k.status}</td>
                <td>{k.central_link_up ? 'UP' : 'DOWN'}</td>
                <td>{k.edge_order_count}</td>
                <td>{k.edge_order_amount.toFixed(2)}</td>
                <td>{k.central_order_count}</td>
                <td>{k.central_order_amount.toFixed(2)}</td>
                <td>{k.pending_sync}</td>
                <td>{k.last_heartbeat_at || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
