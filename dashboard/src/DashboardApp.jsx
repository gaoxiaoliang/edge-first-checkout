import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

export function DashboardApp() {
  const [stats, setStats] = useState(null)
  const [terminals, setTerminals] = useState([])
  const [syncStatus, setSyncStatus] = useState([])
  const [transactions, setTransactions] = useState([])
  const [newTerminal, setNewTerminal] = useState({ terminal_code: 'terminal001', password: 'password', store_name: 'ICA Demo Store 001' })
  const [notice, setNotice] = useState('')
  const [systemPublicKey, setSystemPublicKey] = useState('')

  const load = async () => {
    const [statsRes, terminalsRes, syncRes, txRes, pubKeyRes] = await Promise.all([
      fetch(`${API_BASE}/dashboard/stats`),
      fetch(`${API_BASE}/dashboard/terminals`),
      fetch(`${API_BASE}/dashboard/sync-status`),
      fetch(`${API_BASE}/dashboard/transactions?limit=20`),
      fetch(`${API_BASE}/dashboard/system-public-key`)
    ])

    if (statsRes.ok) setStats(await statsRes.json())
    if (terminalsRes.ok) setTerminals(await terminalsRes.json())
    if (syncRes.ok) setSyncStatus(await syncRes.json())
    if (txRes.ok) setTransactions(await txRes.json())
    if (pubKeyRes.ok) {
      const data = await pubKeyRes.json()
      setSystemPublicKey(data.ecdsa_public_key || '')
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const createTerminal = async (e) => {
    e.preventDefault()
    const res = await fetch(`${API_BASE}/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTerminal)
    })

    if (!res.ok) {
      setNotice('Failed to create terminal. It may already exist.')
      return
    }

    setNotice('Terminal created successfully.')
    setNewTerminal({ terminal_code: 'terminal001', password: 'password', store_name: 'ICA Demo Store 001' })
    load()
  }

  const copyPrivateKey = async (terminalId) => {
    try {
      const res = await fetch(`${API_BASE}/dashboard/terminals/${terminalId}/private-key`)
      if (!res.ok) {
        setNotice('Failed to fetch private key.')
        return
      }
      const data = await res.json()
      await navigator.clipboard.writeText(data.ecdsa_private_key)
      setNotice('Private key copied to clipboard!')
    } catch {
      setNotice('Failed to copy private key.')
    }
  }

  const deleteTerminal = async (terminalId, terminalCode) => {
    if (!window.confirm(`Are you sure you want to delete terminal "${terminalCode}"? This will also delete all its transactions.`)) {
      return
    }

    try {
      const res = await fetch(`${API_BASE}/dashboard/terminals/${terminalId}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        setNotice('Failed to delete terminal.')
        return
      }

      setNotice(`Terminal "${terminalCode}" deleted successfully.`)
      load()
    } catch {
      setNotice('Failed to delete terminal.')
    }
  }

  const copySystemPublicKey = async () => {
    try {
      await navigator.clipboard.writeText(systemPublicKey)
      setNotice('System public key copied to clipboard!')
    } catch {
      setNotice('Failed to copy system public key.')
    }
  }

  return (
    <div className="dashboard-shell">
      <h1>ICA Edge Checkout Dashboard</h1>
      <p>{notice}</p>

      <section className="stats-grid">
        <StatCard title="Total Sales" value={`${stats?.total_sales?.toFixed?.(2) || '0.00'} SEK`} />
        <StatCard title="Transactions" value={stats?.total_transactions ?? 0} />
        <StatCard title="Offline Synced" value={stats?.offline_synced_transactions ?? 0} />
        <StatCard title="Terminals Online" value={stats?.online_terminals ?? 0} />
      </section>

      <section className="panel">
        <h2>System Public Key</h2>
        <p className="key-description">
          Copy this public key to terminals for verifying Scan & Pay payment QR codes offline.
        </p>
        <textarea
          readOnly
          value={systemPublicKey}
          rows={4}
          className="system-key-display"
        />
        <button className="copy-system-key-btn" onClick={copySystemPublicKey}>
          Copy System Public Key
        </button>
      </section>

      <section className="panel">
        <h2>Create Terminal</h2>
        <form className="row" onSubmit={createTerminal}>
          <input
            value={newTerminal.terminal_code}
            onChange={(e) => setNewTerminal({ ...newTerminal, terminal_code: e.target.value })}
            placeholder="terminal-001"
            required
          />
          <input
            type="password"
            value={newTerminal.password}
            onChange={(e) => setNewTerminal({ ...newTerminal, password: e.target.value })}
            placeholder="password"
            required
          />
          <input
            value={newTerminal.store_name}
            onChange={(e) => setNewTerminal({ ...newTerminal, store_name: e.target.value })}
            placeholder="Store name"
            required
          />
          <button type="submit">Create</button>
        </form>
      </section>

      <section className="panel">
        <h2>Terminal Status</h2>
        <table>
          <thead>
            <tr><th>Terminal</th><th>Store</th><th>Status</th><th>Last Seen</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {terminals.map((terminal) => (
              <tr key={terminal.id}>
                <td>{terminal.terminal_code}</td>
                <td>{terminal.store_name}</td>
                <td className={terminal.status}>{terminal.status}</td>
                <td>{terminal.last_seen_at || '-'}</td>
                <td className="actions-cell">
                  <button 
                    className="action-btn copy-btn" 
                    onClick={() => copyPrivateKey(terminal.id)}
                    title="Copy Private Key"
                  >
                    Copy Key
                  </button>
                  <button 
                    className="action-btn delete-btn" 
                    onClick={() => deleteTerminal(terminal.id, terminal.terminal_code)}
                    title="Delete Terminal"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Synchronization Status</h2>
        <table>
          <thead>
            <tr><th>Terminal</th><th>Pending Sync</th><th>Last Synced</th></tr>
          </thead>
          <tbody>
            {syncStatus.map((entry) => (
              <tr key={entry.terminal_code}>
                <td>{entry.terminal_code}</td>
                <td>{entry.pending_sync_count}</td>
                <td>{entry.last_synced_at || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Recent Transactions</h2>
        <table>
          <thead>
            <tr><th>ID</th><th>Terminal ID</th><th>Total</th><th>Items</th><th>Offline Synced</th></tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.id}</td>
                <td>{tx.terminal_id}</td>
                <td>{Number(tx.total_amount).toFixed(2)} SEK</td>
                <td>{tx.item_count}</td>
                <td>{tx.synced_from_offline ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>


    </div>
  )
}

function StatCard({ title, value }) {
  return (
    <article className="stat-card">
      <h3>{title}</h3>
      <p>{value}</p>
    </article>
  )
}
