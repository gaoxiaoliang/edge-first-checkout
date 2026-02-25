import { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
const CATALOG = [
  { id: 'milk', name: 'ICA Milk 1L', price: 19.9 },
  { id: 'bread', name: 'Sourdough Bread', price: 34.5 },
  { id: 'banana', name: 'Banana (kg)', price: 24.0 },
  { id: 'coffee', name: 'Ground Coffee 500g', price: 72.0 },
  { id: 'apple', name: 'Swedish Apple (kg)', price: 29.0 }
]

const OFFLINE_KEY = 'ica_offline_transactions'
const TOKEN_KEY = 'ica_token'

export function App() {
  const [terminalCode, setTerminalCode] = useState('terminal-001')
  const [password, setPassword] = useState('password123')
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '')
  const [cart, setCart] = useState([])
  const [networkOnline, setNetworkOnline] = useState(false)
  const [syncCount, setSyncCount] = useState(0)
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeView, setActiveView] = useState('checkout')

  const pendingTransactions = useMemo(
    () => JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'),
    [syncCount]
  )

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  useEffect(() => {
    const checkHeartbeat = async () => {
      if (!token) return
      try {
        const res = await fetch(`${API_BASE}/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ current_load: pendingTransactions.length })
        })
        setNetworkOnline(res.ok)
      } catch {
        setNetworkOnline(false)
      }
    }

    checkHeartbeat()
    const interval = setInterval(checkHeartbeat, 5000)
    return () => clearInterval(interval)
  }, [token, pendingTransactions.length])

  useEffect(() => {
    if (!token) {
      setNetworkOnline(false)
    }
  }, [token])

  useEffect(() => {
    const syncOfflineTransactions = async () => {
      if (!networkOnline || !token) return
      const queue = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')
      if (!queue.length) return

      try {
        const res = await fetch(`${API_BASE}/sync/offline`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ transactions: queue })
        })

        if (res.ok) {
          localStorage.removeItem(OFFLINE_KEY)
          setSyncCount((prev) => prev + 1)
          setStatusMessage(`Synchronized ${queue.length} offline transaction(s).`)
        }
      } catch {
        setStatusMessage('Synchronization failed. Retrying in background...')
      }
    }

    const interval = setInterval(syncOfflineTransactions, 4000)
    syncOfflineTransactions()
    return () => clearInterval(interval)
  }, [networkOnline, token])

  const login = async () => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminal_code: terminalCode, password })
    })
    if (!res.ok) {
      window.alert('Login failed. Verify terminal credentials.')
      return
    }

    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.access_token)
    setToken(data.access_token)
    setStatusMessage('Terminal authenticated.')
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setMenuOpen(false)
    setCart([])
    setStatusMessage('Logged out.')
    setActiveView('checkout')
  }

  const showTerminalInfo = () => {
    window.alert(
      [
        `Terminal Code: ${terminalCode}`,
        `Authentication: ${token ? 'Signed in' : 'Signed out'}`,
        `Network: ${networkOnline ? 'Online' : 'Offline'}`,
        `Pending Sync: ${pendingTransactions.length}`
      ].join('\n')
    )
    setMenuOpen(false)
  }

  const goToPendingTransactions = () => {
    setActiveView('pending')
    setMenuOpen(false)
  }

  const addProduct = (product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id)
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      }
      return [...prev, { ...product, quantity: 1 }]
    })
  }

  const updateQuantity = (id, quantity) => {
    const value = Math.max(1, Number(quantity) || 1)
    setCart((prev) => prev.map((item) => (item.id === id ? { ...item, quantity: value } : item)))
  }

  const checkout = async () => {
    if (!cart.length || !token) return
    const payload = {
      idempotency_key: crypto.randomUUID(),
      total_amount: Number(total.toFixed(2)),
      occurred_at: new Date().toISOString(),
      items: cart.map(({ id, name, price, quantity }) => ({ product_id: id, name, price, quantity }))
    }

    if (networkOnline) {
      const res = await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        setStatusMessage('Payment successful and stored online.')
        setCart([])
      } else {
        setStatusMessage('Online write failed. Saved offline to avoid lost sale.')
        saveOffline(payload)
      }
      return
    }

    saveOffline(payload)
    setStatusMessage('Offline mode: transaction cached locally for sync.')
    setCart([])
  }

  const saveOffline = (payload) => {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')
    localStorage.setItem(OFFLINE_KEY, JSON.stringify([...queue, payload]))
    setSyncCount((prev) => prev + 1)
  }

  return (
    <div className="app-shell">
      <header>
        <h1>ICA Self-Checkout</h1>
        <div className="header-actions">
          <span className={networkOnline ? 'status online' : 'status offline'}>
            {networkOnline ? 'Network: Online' : 'Network: Offline'}
          </span>
          {token && (
            <div className="menu-wrap">
              <button className="menu-button" onClick={() => setMenuOpen((prev) => !prev)}>
                Terminal Menu ▾
              </button>
              {menuOpen && (
                <div className="menu-dropdown">
                  <button onClick={showTerminalInfo}>Terminal Info</button>
                  <button onClick={goToPendingTransactions}>
                    Pending Transactions ({pendingTransactions.length})
                  </button>
                  <button onClick={logout}>Sign Out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {activeView === 'pending' ? (
        <section className="panel">
          <div className="pending-header">
            <h2>Pending Offline Transactions</h2>
            <button onClick={() => setActiveView('checkout')}>Back to Checkout</button>
          </div>
          {pendingTransactions.length === 0 && <p>No pending transactions.</p>}
          {pendingTransactions.length > 0 && (
            <div className="pending-list">
              {pendingTransactions.map((item, index) => (
                <div key={item.idempotency_key || index} className="pending-item">
                  <strong>{item.idempotency_key || `Offline transaction ${index + 1}`}</strong>
                  <span>Amount: {Number(item.total_amount || 0).toFixed(2)} SEK</span>
                  <span>Items: {item.items?.length || 0}</span>
                  <span>Occurred at: {item.occurred_at || 'Unknown'}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="layout">
          <div className="panel">
            <h2>Product Catalog</h2>
            <div className="catalog-grid">
              {CATALOG.map((product) => (
                <button
                  key={product.id}
                  className="product-card"
                  onClick={() => addProduct(product)}
                  disabled={!token}
                >
                  <strong>{product.name}</strong>
                  <span>{product.price.toFixed(2)} SEK</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Current Basket</h2>
            {cart.length === 0 && <p>No products selected.</p>}
            {cart.map((item) => (
              <div key={item.id} className="cart-row">
                <span>{item.name}</span>
                <input
                  type="number"
                  value={item.quantity}
                  min="1"
                  onChange={(e) => updateQuantity(item.id, e.target.value)}
                  disabled={!token}
                />
                <strong>{(item.quantity * item.price).toFixed(2)} SEK</strong>
              </div>
            ))}
            <div className="checkout-row">
              <strong>Total: {total.toFixed(2)} SEK</strong>
              <button onClick={checkout} disabled={!token}>Checkout</button>
            </div>
            <p>Pending offline sync: {pendingTransactions.length}</p>
          </div>
        </section>
      )}

      {!token && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Terminal Login</h2>
            <p>Sign in to start checkout operations.</p>
            <div className="column-form">
              <input
                value={terminalCode}
                onChange={(e) => setTerminalCode(e.target.value)}
                placeholder="Terminal code"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
              />
              <button onClick={login}>Login</button>
            </div>
          </div>
        </div>
      )}

      <footer>{statusMessage}</footer>
    </div>
  )
}
