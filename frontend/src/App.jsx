import { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000'

const defaultLines = [
  { sku: 'MILK-1L', name: 'Organic Milk 1L', quantity: 1, unit_price: 18.5 },
  { sku: 'BREAD-RYE', name: 'Rye Bread', quantity: 1, unit_price: 29.9 },
]

export function App() {
  const [online, setOnline] = useState(true)
  const [cashierId, setCashierId] = useState('cashier-01')
  const [customerReference, setCustomerReference] = useState('')
  const [itemsJson, setItemsJson] = useState(JSON.stringify(defaultLines, null, 2))
  const [edgeTransactions, setEdgeTransactions] = useState([])
  const [centralTransactions, setCentralTransactions] = useState([])
  const [message, setMessage] = useState('')

  const parsedItems = useMemo(() => {
    try {
      return JSON.parse(itemsJson)
    } catch {
      return null
    }
  }, [itemsJson])

  async function refresh() {
    const edgeRes = await fetch(`${API_BASE}/edge/transactions`)
    const centralRes = await fetch(`${API_BASE}/central/transactions`)
    setEdgeTransactions(await edgeRes.json())
    setCentralTransactions(await centralRes.json())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function submitCheckout() {
    if (!Array.isArray(parsedItems)) {
      setMessage('Items JSON is invalid.')
      return
    }

    const res = await fetch(`${API_BASE}/edge/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cashier_id: cashierId,
        customer_reference: customerReference || null,
        items: parsedItems,
        currency: 'SEK',
      }),
    })

    const body = await res.json()
    setMessage(body.message || `Recorded edge tx #${body.edge_transaction_id}`)
    await refresh()

    if (online) {
      await syncNow()
    }
  }

  async function syncNow() {
    const res = await fetch(`${API_BASE}/edge/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ online }),
    })

    if (!res.ok) {
      const err = await res.json()
      setMessage(err.detail || 'Sync failed')
      return
    }

    const body = await res.json()
    setMessage(`Sync complete: pushed=${body.pushed}, skipped=${body.skipped}`)
    await refresh()
  }

  const pendingCount = edgeTransactions.filter((x) => !x.synced_at).length

  return (
    <main>
      <h1>Always-On Checkout (ICA Challenge)</h1>
      <p>
        Network state:
        <button className={online ? 'online' : 'offline'} onClick={() => setOnline((x) => !x)}>
          {online ? 'Online' : 'Offline'}
        </button>
      </p>

      <section>
        <h2>Checkout Form</h2>
        <label>
          Cashier ID
          <input value={cashierId} onChange={(e) => setCashierId(e.target.value)} />
        </label>
        <label>
          Customer reference (optional)
          <input value={customerReference} onChange={(e) => setCustomerReference(e.target.value)} />
        </label>
        <label>
          Items JSON
          <textarea rows={8} value={itemsJson} onChange={(e) => setItemsJson(e.target.value)} />
        </label>
        <div className="row">
          <button onClick={submitCheckout}>Record transaction on edge</button>
          <button onClick={syncNow}>Sync pending transactions</button>
        </div>
      </section>

      <p className="status">{message}</p>

      <section>
        <h2>Edge Store Queue</h2>
        <p>Pending unsynced transactions: {pendingCount}</p>
        <ul>
          {edgeTransactions.slice(0, 8).map((tx) => (
            <li key={tx.id}>
              #{tx.id} {tx.amount_total} {tx.currency} · synced: {tx.synced_at ? 'yes' : 'no'}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Central System Ledger</h2>
        <ul>
          {centralTransactions.slice(0, 8).map((tx) => (
            <li key={tx.id}>
              #{tx.id} from edge #{tx.edge_transaction_id} · {tx.amount_total} {tx.currency}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
