import { useEffect, useMemo, useRef, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000'
const KIOSK_ID = import.meta.env.VITE_KIOSK_ID || 'kiosk-01'

function makeIdempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function App() {
  const [catalog, setCatalog] = useState([])
  const [cart, setCart] = useState([])
  const [linkUp, setLinkUp] = useState(true)
  const [heartbeat, setHeartbeat] = useState('unknown')
  const [lastAction, setLastAction] = useState('Ready')
  const [paymentMethod, setPaymentMethod] = useState('card')
  const [pendingOrders, setPendingOrders] = useState([])
  const timerRef = useRef(null)

  const total = useMemo(
    () => cart.reduce((sum, x) => sum + x.quantity * x.unit_price, 0).toFixed(2),
    [cart],
  )

  async function fetchCatalog() {
    const res = await fetch(`${API_BASE}/catalog`)
    setCatalog(await res.json())
  }

  async function loadPending() {
    const res = await fetch(`${API_BASE}/edge/orders?kiosk_id=${KIOSK_ID}&pending_only=true`)
    setPendingOrders(await res.json())
  }

  async function sendHeartbeat(up = linkUp) {
    try {
      const res = await fetch(`${API_BASE}/edge/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kiosk_id: KIOSK_ID, central_link_up: up }),
      })
      if (!res.ok) throw new Error('heartbeat failed')
      setHeartbeat(up ? 'online-to-central' : 'offline-to-central')
    } catch {
      setHeartbeat('edge-api-unreachable')
    }
  }

  async function syncNow() {
    try {
      const res = await fetch(`${API_BASE}/edge/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kiosk_id: KIOSK_ID }),
      })
      const body = await res.json()
      if (!res.ok) {
        setLastAction(body.detail || 'Sync failed')
        return
      }
      setLastAction(`Sync pushed=${body.pushed}, duplicates=${body.duplicates}`)
      await loadPending()
    } catch {
      setLastAction('Sync failed: edge API unavailable')
    }
  }

  useEffect(() => {
    fetchCatalog()
    loadPending()
    sendHeartbeat(linkUp)

    timerRef.current = setInterval(async () => {
      await sendHeartbeat(linkUp)
    }, 5000)

    return () => clearInterval(timerRef.current)
  }, [])

  useEffect(() => {
    sendHeartbeat(linkUp)
    if (linkUp) {
      syncNow()
    }
  }, [linkUp])

  function addToCart(item) {
    setCart((prev) => {
      const existing = prev.find((x) => x.sku === item.sku)
      if (existing) {
        return prev.map((x) => (x.sku === item.sku ? { ...x, quantity: x.quantity + 1 } : x))
      }
      return [...prev, { sku: item.sku, name: item.name, unit_price: item.price, quantity: 1 }]
    })
  }

  function updateQty(sku, quantity) {
    const qty = Number(quantity)
    if (Number.isNaN(qty)) return
    setCart((prev) =>
      prev
        .map((x) => (x.sku === sku ? { ...x, quantity: Math.max(0, Math.min(99, qty)) } : x))
        .filter((x) => x.quantity > 0),
    )
  }

  async function checkout() {
    if (cart.length === 0) {
      setLastAction('Cart is empty')
      return
    }

    const payload = {
      kiosk_id: KIOSK_ID,
      idempotency_key: makeIdempotencyKey(),
      payment_method: paymentMethod,
      currency: 'SEK',
      lines: cart,
    }

    const res = await fetch(`${API_BASE}/edge/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    setLastAction(body.message || `Captured order ${body.order_uuid}`)
    setCart([])
    await loadPending()

    if (linkUp) {
      await syncNow()
    }
  }

  return (
    <main>
      <header>
        <h1>ICA Self-Checkout Simulator</h1>
        <div className="pill-row">
          <span className="pill">Kiosk: {KIOSK_ID}</span>
          <button className={linkUp ? 'ok' : 'bad'} onClick={() => setLinkUp((x) => !x)}>
            Central Link: {linkUp ? 'UP' : 'DOWN'}
          </button>
          <span className="pill">Heartbeat: {heartbeat}</span>
          <a href="http://127.0.0.1:5174" target="_blank" rel="noreferrer">
            Open Dashboard
          </a>
        </div>
      </header>

      <section>
        <h2>Product Catalog</h2>
        <div className="grid">
          {catalog.map((item) => (
            <button key={item.sku} onClick={() => addToCart(item)} className="product">
              <strong>{item.name}</strong>
              <span>{item.sku}</span>
              <span>{item.price.toFixed(2)} SEK</span>
              <small>Add</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Cart</h2>
        {cart.length === 0 && <p>No items yet.</p>}
        {cart.map((line) => (
          <div key={line.sku} className="line">
            <span>{line.name}</span>
            <span>{line.unit_price.toFixed(2)} SEK</span>
            <input type="number" min="0" max="99" value={line.quantity} onChange={(e) => updateQty(line.sku, e.target.value)} />
            <span>{(line.quantity * line.unit_price).toFixed(2)} SEK</span>
          </div>
        ))}
        <div className="checkout-row">
          <label>
            Payment
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="card">Card</option>
              <option value="mobile">Mobile</option>
              <option value="cash">Cash</option>
            </select>
          </label>
          <strong>Total: {total} SEK</strong>
          <button onClick={checkout}>Pay & Checkout</button>
          <button onClick={syncNow}>Manual Sync</button>
        </div>
      </section>

      <section>
        <h2>Offline Queue</h2>
        <p>Pending sync orders: {pendingOrders.length}</p>
        <ul>
          {pendingOrders.slice(0, 10).map((o) => (
            <li key={o.order_uuid}>
              {o.order_uuid} · {o.amount_total} {o.currency} · {o.sync_state}
            </li>
          ))}
        </ul>
      </section>

      <p className="status">{lastAction}</p>
    </main>
  )
}
