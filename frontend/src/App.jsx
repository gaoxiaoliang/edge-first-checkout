import { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
const CATALOG = [
  { id: 'milk', name: 'ICA Milk 1L', price: 19.9 },
  { id: 'bread', name: 'Sourdough Bread', price: 34.5 },
  { id: 'banana', name: 'Banana (kg)', price: 24.0 },
  { id: 'coffee', name: 'Ground Coffee 500g', price: 72.0 },
  { id: 'apple', name: 'Swedish Apple (kg)', price: 29.0 }
]

const PAYMENT_TYPES = [
  { id: 'cash', name: 'Cash', icon: '💵', color: '#16a34a' },
  { id: 'credit_card', name: 'Credit Card', icon: '💳', color: '#2563eb' },
  { id: 'swish', name: 'Swish', icon: '📱', color: '#7c3aed' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', color: '#0f172a' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', color: '#ea580c' }
]

const OFFLINE_KEY = 'ica_offline_transactions'
const TOKEN_KEY = 'ica_token'
const PRIVATE_KEY_KEY = 'ica_terminal_private_key'

// Generate random credit card number (masked format)
const generateCardNumber = () => {
  const last4 = Math.floor(1000 + Math.random() * 9000)
  return `****-****-****-${last4}`
}

// Generate random card type
const generateCardType = () => {
  const types = ['Visa', 'Mastercard', 'American Express']
  return types[Math.floor(Math.random() * types.length)]
}

// Generate random Swedish phone number for Swish
const generateSwishPhone = () => {
  const prefix = '07'
  const rest = Math.floor(10000000 + Math.random() * 90000000)
  return `${prefix}${rest}`
}

// Generate random transaction token
const generateToken = () => {
  return crypto.randomUUID().substring(0, 16).toUpperCase()
}

// Generate payment details based on payment type
const generatePaymentDetails = (paymentType, totalAmount) => {
  const payment = { payment_type: paymentType }

  switch (paymentType) {
    case 'cash': {
      const roundTo = totalAmount > 100 ? 50 : 10
      const tendered = Math.ceil(totalAmount / roundTo) * roundTo
      payment.cash_tendered = tendered
      payment.cash_change = Number((tendered - totalAmount).toFixed(2))
      break
    }
    case 'credit_card': {
      payment.credit_card = {
        card_number: generateCardNumber(),
        card_type: generateCardType(),
        expiry_month: Math.floor(1 + Math.random() * 12),
        expiry_year: 2025 + Math.floor(Math.random() * 5)
      }
      break
    }
    case 'swish': {
      payment.swish = {
        phone_number: generateSwishPhone(),
        transaction_id: `SWISH-${generateToken()}`
      }
      break
    }
    case 'apple_pay':
    case 'google_pay': {
      payment.mobile_pay = {
        device_id: `DEV-${generateToken()}`,
        transaction_token: `TXN-${generateToken()}`
      }
      break
    }
  }

  return payment
}

export function App() {
  const [terminalCode, setTerminalCode] = useState('terminal-001')
  const [password, setPassword] = useState('password123')
  const [privateKey, setPrivateKey] = useState(localStorage.getItem(PRIVATE_KEY_KEY) || '')
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '')
  const [cart, setCart] = useState([])
  const [networkOnline, setNetworkOnline] = useState(false)
  const [syncCount, setSyncCount] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeView, setActiveView] = useState('checkout')
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutSuccess, setCheckoutSuccess] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [paymentProcessing, setPaymentProcessing] = useState(false)
  const [paymentDetails, setPaymentDetails] = useState(null)

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
        if (res.status === 401) {
          handleUnauthorized()
          return
        }
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
        } else if (res.status === 401) {
          handleUnauthorized()
          return
        }
      } catch {
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
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PRIVATE_KEY_KEY)
    setToken('')
    setPrivateKey('')
    setMenuOpen(false)
    setCart([])
    setActiveView('checkout')
  }

  const goToTerminalInfo = () => {
    setActiveView('terminal-info')
    setMenuOpen(false)
  }

  const savePrivateKey = () => {
    if (privateKey.trim()) {
      localStorage.setItem(PRIVATE_KEY_KEY, privateKey)
      window.alert('Private key saved successfully!')
    } else {
      localStorage.removeItem(PRIVATE_KEY_KEY)
      window.alert('Private key cleared.')
    }
  }

  const handleUnauthorized = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setCart([])
    console.warn('Token expired, logged out')
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

  // Open payment selection modal
  const initiateCheckout = () => {
    if (!cart.length || !token) return
    setShowPaymentModal(true)
    setSelectedPayment(null)
    setPaymentDetails(null)
  }

  // Process payment after selection
  const processPayment = async (paymentType) => {
    setSelectedPayment(paymentType)
    setPaymentProcessing(true)

    // Generate payment details
    const payment = generatePaymentDetails(paymentType, total)
    setPaymentDetails(payment)

    // Simulate payment processing delay
    await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1000))

    setPaymentProcessing(false)
    setShowPaymentModal(false)

    // Now proceed with checkout
    completeCheckout(payment)
  }

  const completeCheckout = async (payment) => {
    if (!cart.length || !token) return

    setCheckoutLoading(true)
    setCheckoutSuccess(false)

    const payload = {
      idempotency_key: crypto.randomUUID(),
      total_amount: Number(total.toFixed(2)),
      occurred_at: new Date().toISOString(),
      items: cart.map(({ id, name, price, quantity }) => ({ product_id: id, name, price, quantity })),
      payment
    }

    if (networkOnline) {
      fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      }).then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            handleUnauthorized()
            return
          }
          saveOffline(payload)
        }
      })
    } else {
      saveOffline(payload)
    }

    const delay = Math.random() * 500 + 500

    setTimeout(() => {
      setCheckoutLoading(false)
      setCheckoutSuccess(true)
      setCart([])
      setPaymentDetails(payment)

      setTimeout(() => {
        setCheckoutSuccess(false)
        setPaymentDetails(null)
      }, 2500)
    }, delay)
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
                  <button onClick={goToTerminalInfo}>Terminal Info</button>
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

      {activeView === 'terminal-info' ? (
        <section className="panel terminal-info-panel">
          <div className="pending-header">
            <h2>Terminal Information</h2>
            <button onClick={() => setActiveView('checkout')}>Back to Checkout</button>
          </div>
          
          <div className="terminal-info-grid">
            <div className="info-item">
              <label>Terminal Code</label>
              <span className="info-value">{terminalCode}</span>
            </div>
            <div className="info-item">
              <label>Authentication</label>
              <span className={`info-value ${token ? 'status-ok' : 'status-error'}`}>
                {token ? 'Signed in' : 'Signed out'}
              </span>
            </div>
            <div className="info-item">
              <label>Network Status</label>
              <span className={`info-value ${networkOnline ? 'status-ok' : 'status-error'}`}>
                {networkOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="info-item">
              <label>Pending Sync</label>
              <span className="info-value">{pendingTransactions.length} transaction(s)</span>
            </div>
          </div>

          <div className="private-key-section">
            <h3>Terminal Private Key (ECDSA P-256)</h3>
            <p className="key-description">
              Enter your terminal's private key here. This key is stored locally and used for signing operations.
            </p>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
              rows={8}
              className="private-key-input"
            />
            <div className="key-actions">
              <button onClick={savePrivateKey} className="save-key-btn">
                {privateKey.trim() ? 'Save Private Key' : 'Clear Private Key'}
              </button>
              <span className="key-status">
                {localStorage.getItem(PRIVATE_KEY_KEY) ? 'Key is saved' : 'No key saved'}
              </span>
            </div>
          </div>
        </section>
      ) : activeView === 'pending' ? (
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
            {cart.length > 0 && (
              <div className="cart-table-header">
                <span>Product</span>
                <span>Quantity</span>
                <span>Total</span>
              </div>
            )}
            {cart.map((item) => (
              <div key={item.id} className="cart-row">
                <span className="cart-product-name">{item.name}</span>
                <input
                  type="number"
                  value={item.quantity}
                  min="1"
                  onChange={(e) => updateQuantity(item.id, e.target.value)}
                  disabled={!token}
                />
                <strong className="cart-line-total">{(item.quantity * item.price).toFixed(2)} SEK</strong>
              </div>
            ))}
            <div className="checkout-row">
              <strong>Total: {total.toFixed(2)} SEK</strong>
              <button onClick={initiateCheckout} disabled={!token || cart.length === 0}>Checkout</button>
            </div>
          </div>
        </section>
      )}

      {/* Payment Selection Modal */}
      {showPaymentModal && (
        <div className="modal-overlay">
          <div className="modal payment-modal">
            {!paymentProcessing ? (
              <>
                <h2>Select Payment Method</h2>
                <p className="payment-total">Total: <strong>{total.toFixed(2)} SEK</strong></p>
                <div className="payment-options">
                  {PAYMENT_TYPES.map((pt) => (
                    <button
                      key={pt.id}
                      className="payment-option"
                      style={{ '--payment-color': pt.color }}
                      onClick={() => processPayment(pt.id)}
                    >
                      <span className="payment-icon">{pt.icon}</span>
                      <span className="payment-name">{pt.name}</span>
                    </button>
                  ))}
                </div>
                <button className="cancel-payment" onClick={() => setShowPaymentModal(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <div className="payment-processing">
                <div className="payment-animation" style={{ '--payment-color': PAYMENT_TYPES.find(p => p.id === selectedPayment)?.color }}>
                  <span className="payment-icon-large">
                    {PAYMENT_TYPES.find(p => p.id === selectedPayment)?.icon}
                  </span>
                  {selectedPayment === 'cash' && (
                    <div className="cash-animation">
                      <div className="cash-bill">💵</div>
                      <div className="cash-bill delay-1">💵</div>
                      <div className="cash-bill delay-2">💵</div>
                    </div>
                  )}
                  {selectedPayment === 'credit_card' && (
                    <div className="card-animation">
                      <div className="card-swipe">💳</div>
                    </div>
                  )}
                  {selectedPayment === 'swish' && (
                    <div className="swish-animation">
                      <div className="swish-ring"></div>
                      <div className="swish-ring delay-1"></div>
                    </div>
                  )}
                  {(selectedPayment === 'apple_pay' || selectedPayment === 'google_pay') && (
                    <div className="nfc-animation">
                      <div className="nfc-wave"></div>
                      <div className="nfc-wave delay-1"></div>
                      <div className="nfc-wave delay-2"></div>
                    </div>
                  )}
                </div>
                <p className="processing-text">Processing {PAYMENT_TYPES.find(p => p.id === selectedPayment)?.name}...</p>
                {paymentDetails?.credit_card && (
                  <p className="payment-detail">Card: {paymentDetails.credit_card.card_number}</p>
                )}
                {paymentDetails?.swish && (
                  <p className="payment-detail">Phone: {paymentDetails.swish.phone_number}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Checkout Result Modal */}
      {(checkoutLoading || checkoutSuccess) && (
        <div className="modal-overlay">
          <div className="modal checkout-modal">
            {checkoutLoading && (
              <>
                <div className="spinner"></div>
                <p>Finalizing your order...</p>
              </>
            )}
            {checkoutSuccess && (
              <>
                <div className="success-icon">✓</div>
                <p>Payment successful!</p>
                {paymentDetails && (
                  <div className="receipt-info">
                    <p className="payment-method-used">
                      Paid with {PAYMENT_TYPES.find(p => p.id === paymentDetails.payment_type)?.name}
                      {' '}{PAYMENT_TYPES.find(p => p.id === paymentDetails.payment_type)?.icon}
                    </p>
                    {paymentDetails.credit_card && (
                      <p className="receipt-detail">
                        {paymentDetails.credit_card.card_type} {paymentDetails.credit_card.card_number}
                      </p>
                    )}
                    {paymentDetails.swish && (
                      <p className="receipt-detail">
                        Swish from {paymentDetails.swish.phone_number}
                      </p>
                    )}
                    {paymentDetails.cash_tendered && (
                      <>
                        <p className="receipt-detail">Cash: {paymentDetails.cash_tendered.toFixed(2)} SEK</p>
                        <p className="receipt-detail">Change: {paymentDetails.cash_change.toFixed(2)} SEK</p>
                      </>
                    )}
                    {paymentDetails.mobile_pay && (
                      <p className="receipt-detail">
                        Token: {paymentDetails.mobile_pay.transaction_token}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
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
    </div>
  )
}
