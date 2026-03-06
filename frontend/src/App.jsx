import { useEffect, useMemo, useState, useRef } from 'react'
import QRCode from 'qrcode'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
const MOBILE_CHECKOUT_BASE = import.meta.env.VITE_MOBILE_CHECKOUT_BASE || 'http://192.168.1.103:8000'
const CATALOG = [
  { 
    id: 'banan', 
    name: 'Banan Eko i klase Klass 1 ICA', 
    price: 15.00,
    image: '/src/assets/images/banan.jpg'
  },
  { 
    id: 'mjolk', 
    name: 'Mellanmjölkdryck 1,5% Laktosfri 1,5l Arla Ko', 
    price: 26.90,
    image: '/src/assets/images/mjolk.jpg'
  },
  { 
    id: 'cola', 
    name: 'Läsk Cola Zero 1,5l Coca-Cola', 
    price: 24.90,
    image: '/src/assets/images/cola.jpg'
  },
  { 
    id: 'druvor', 
    name: 'Druvor Crimson Röda Kärnfria 500g Klass 1 ICA', 
    price: 25.00,
    image: '/src/assets/images/druvor.jpg'
  },
  { 
    id: 'tortilla', 
    name: 'Tortilla Original Medium 8p 320g Santa Maria', 
    price: 17.90,
    image: '/src/assets/images/tortilla.jpg'
  }
]

const PAYMENT_TYPES = [
  { id: 'cash', name: 'Cash', icon: '💵', color: '#16a34a' },
  { id: 'credit_card', name: 'Credit Card', icon: '💳', color: '#2563eb' },
  { id: 'swish', name: 'Swish', icon: '📱', color: '#7c3aed' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', color: '#0f172a' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', color: '#ea580c' }
]

// Offline-only payment types
const SCAN_PAY_TYPE = { id: 'scan_pay', name: 'Scan & Pay', icon: '📲', color: '#8b5cf6' }
const INVOICE_TYPE = { id: 'invoice', name: 'Invoice', icon: '🧾', color: '#d97706' }

const OFFLINE_KEY = 'ica_offline_transactions'
const TOKEN_KEY = 'ica_token'
const PRIVATE_KEY_KEY = 'ica_terminal_private_key'
const TERMINAL_CODE_KEY = 'ica_terminal_code'
const SYSTEM_PUBLIC_KEY_KEY = 'ica_system_public_key'

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
  const [terminalCode, setTerminalCode] = useState(localStorage.getItem(TERMINAL_CODE_KEY) || 'terminal001')
  const [password, setPassword] = useState('password')
  const [privateKey, setPrivateKey] = useState(localStorage.getItem(PRIVATE_KEY_KEY) || '')
  const [systemPublicKey, setSystemPublicKey] = useState(localStorage.getItem(SYSTEM_PUBLIC_KEY_KEY) || '')
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '')
  const [cart, setCart] = useState([])
  const [realNetworkOnline, setRealNetworkOnline] = useState(false)  // 真实网络状态
  const [forceOffline, setForceOffline] = useState(false)  // 强制离线模式
  const [emergencyMode, setEmergencyMode] = useState(false) // User also offline - emergency payment restrictions
  const networkOnline = realNetworkOnline && !forceOffline  // 最终使用的网络状态
  const EMERGENCY_CARD_LIMIT = 400 // SEK - max card payment in emergency mode
  const [syncCount, setSyncCount] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeView, setActiveView] = useState('checkout')
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutSuccess, setCheckoutSuccess] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [paymentProcessing, setPaymentProcessing] = useState(false)
  const [paymentDetails, setPaymentDetails] = useState(null)
  const [scanPayQrCode, setScanPayQrCode] = useState(null) // QR code data URL for Scan & Pay
  const [scanPayUrl, setScanPayUrl] = useState(null) // URL for Scan & Pay (for copy button)
  const [scanPayData, setScanPayData] = useState(null) // Data for current Scan & Pay session
  const [copyLinkCopied, setCopyLinkCopied] = useState(false) // Copy Link button state
  const [showVerifyModal, setShowVerifyModal] = useState(false) // Show QR scanner modal for verification
  const [verificationResult, setVerificationResult] = useState(null) // Result of QR verification
  const [pastedImage, setPastedImage] = useState(null) // User pasted image for verification
  const [parsedQrData, setParsedQrData] = useState(null) // Parsed QR data from pasted image
  const [verifyErrorModal, setVerifyErrorModal] = useState(false) // Show verification error modal
  const [verifySuccessModal, setVerifySuccessModal] = useState(false) // Show verification success modal
  // Admin & Invoice state
  const [adminSettings, setAdminSettings] = useState({
    allow_invoice_members: true,
    allow_invoice_non_members: true,
    non_member_invoice_threshold: 10,
    max_invoice_amount: 5000,
    max_invoices_per_person: 3,
    allow_cash: true,
    allow_credit_card: true,
    allow_swish: true,
    allow_apple_pay: true,
    allow_google_pay: true,
    allow_scan_pay: true,
    allow_invoice: true
  })
  const [invoiceStats, setInvoiceStats] = useState({
    total_invoices: 0,
    total_invoice_amount: 0,
    member_invoices: 0,
    member_invoice_amount: 0,
    non_member_invoices: 0,
    non_member_invoice_amount: 0,
    non_member_invoice_threshold: 10,
    auto_disabled: false
  })
  const [dashboardStats, setDashboardStats] = useState({
    total_transactions: 0,
    total_sales: 0,
    online_transactions: 0,
    offline_transactions: 0,
    offline_pending: 0,
    by_payment_type: {}
  })
  const [timelineData, setTimelineData] = useState([]) // [{minute, counts: {cash: 1, invoice: 2, ...}}]
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceIsMember, setInvoiceIsMember] = useState(false)
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [invoiceMembership, setInvoiceMembership] = useState('')
  const [invoiceEmailSent, setInvoiceEmailSent] = useState(null)
  const PRESETS = [
    { name: 'Secure', color: '#2563eb',
      allow_cash: true, allow_credit_card: true, allow_swish: true, allow_apple_pay: true, allow_google_pay: true,
      allow_scan_pay: false, allow_invoice: false,
      allow_invoice_members: false, allow_invoice_non_members: false, non_member_invoice_threshold: 0,
      max_invoice_amount: 0, max_invoices_per_person: 0,
      desc: 'Card & cash only' },
    { name: 'Balance', color: '#16a34a',
      allow_cash: true, allow_credit_card: true, allow_swish: true, allow_apple_pay: true, allow_google_pay: true,
      allow_scan_pay: true, allow_invoice: true,
      allow_invoice_members: true, allow_invoice_non_members: false, non_member_invoice_threshold: 10,
      max_invoice_amount: 2000, max_invoices_per_person: 3,
      desc: 'Members can invoice' },
    { name: 'Fast', color: '#7c3aed',
      allow_cash: true, allow_credit_card: true, allow_swish: true, allow_apple_pay: true, allow_google_pay: true,
      allow_scan_pay: true, allow_invoice: true,
      allow_invoice_members: true, allow_invoice_non_members: false, non_member_invoice_threshold: 50,
      max_invoice_amount: 5000, max_invoices_per_person: 5,
      desc: 'All methods, member invoice' },
    { name: 'Earnings', color: '#ca8a04',
      allow_cash: true, allow_credit_card: true, allow_swish: true, allow_apple_pay: true, allow_google_pay: true,
      allow_scan_pay: true, allow_invoice: true,
      allow_invoice_members: true, allow_invoice_non_members: true, non_member_invoice_threshold: 100,
      max_invoice_amount: 10000, max_invoices_per_person: 10,
      desc: 'Everything enabled' },
  ]
  const SETTING_KEYS = ['allow_cash','allow_credit_card','allow_swish','allow_apple_pay','allow_google_pay',
    'allow_scan_pay','allow_invoice','allow_invoice_members','allow_invoice_non_members',
    'non_member_invoice_threshold','max_invoice_amount','max_invoices_per_person']
  const activePreset = PRESETS.find(p =>
    SETTING_KEYS.every(k => p[k] === adminSettings[k])
  )?.name || null
  const [adminTab, setAdminTab] = useState('dashboard')
  const [invoiceScanStep, setInvoiceScanStep] = useState('choose') // 'choose' | 'scanning' | 'scanned'
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)

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
        setRealNetworkOnline(res.ok)  // 更新真实网络状态
        if (res.status === 401) {
          handleUnauthorized()
          return
        }
      } catch {
        setRealNetworkOnline(false)  // 更新真实网络状态
      }
    }

    checkHeartbeat()
    const interval = setInterval(checkHeartbeat, 5000)
    return () => clearInterval(interval)
  }, [token, pendingTransactions.length])

  useEffect(() => {
    if (!token) {
      setRealNetworkOnline(false)
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
    localStorage.setItem(TERMINAL_CODE_KEY, terminalCode) // Save terminal code for display
    setToken(data.access_token)
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PRIVATE_KEY_KEY)
    localStorage.removeItem(TERMINAL_CODE_KEY)
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

  const saveSystemPublicKey = () => {
    if (systemPublicKey.trim()) {
      localStorage.setItem(SYSTEM_PUBLIC_KEY_KEY, systemPublicKey)
      window.alert('System public key saved successfully!')
    } else {
      localStorage.removeItem(SYSTEM_PUBLIC_KEY_KEY)
      window.alert('System public key cleared.')
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

  const openAdmin = () => {
    setActiveView('admin')
    setMenuOpen(false)
    refreshAdminData()
  }

  // Compute local stats from localStorage offline queue
  const computeLocalStats = () => {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')
    let member = 0, memberAmt = 0, nonMember = 0, nonMemberAmt = 0
    const byType = {}
    for (const tx of queue) {
      const pt = tx.payment?.payment_type || 'unknown'
      byType[pt] = (byType[pt] || { count: 0, amount: 0 })
      byType[pt].count++
      byType[pt].amount += tx.total_amount || 0
      if (pt === 'invoice') {
        if (tx.payment.invoice?.is_member) {
          member++
          memberAmt += tx.total_amount || 0
        } else {
          nonMember++
          nonMemberAmt += tx.total_amount || 0
        }
      }
    }
    return { member, memberAmt, nonMember, nonMemberAmt, pending: queue.length, byType, totalAmt: queue.reduce((s, t) => s + (t.total_amount || 0), 0) }
  }

  const refreshAdminData = async () => {
    const local = computeLocalStats()
    // Try to fetch from backend (has synced data)
    let remoteInvoice = { total_invoices: 0, total_invoice_amount: 0, member_invoices: 0, member_invoice_amount: 0, non_member_invoices: 0, non_member_invoice_amount: 0, non_member_invoice_threshold: adminSettings.non_member_invoice_threshold, auto_disabled: false }
    let remoteDash = { total_sales: 0, total_transactions: 0, offline_synced_transactions: 0, online_terminals: 0, offline_terminals: 0 }
    let remoteTxs = []
    try {
      const [settingsRes, statsRes, dashRes, txsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/settings`),
        fetch(`${API_BASE}/admin/invoice-stats`),
        fetch(`${API_BASE}/dashboard/stats`),
        fetch(`${API_BASE}/dashboard/transactions?limit=1000`)
      ])
      if (settingsRes.ok) setAdminSettings(await settingsRes.json())
      if (statsRes.ok) remoteInvoice = await statsRes.json()
      if (dashRes.ok) remoteDash = await dashRes.json()
      if (txsRes.ok) remoteTxs = await txsRes.json()
    } catch { /* offline */ }

    // Merge invoice stats
    setInvoiceStats({
      ...remoteInvoice,
      total_invoices: remoteInvoice.total_invoices + local.member + local.nonMember,
      total_invoice_amount: remoteInvoice.total_invoice_amount + local.memberAmt + local.nonMemberAmt,
      member_invoices: remoteInvoice.member_invoices + local.member,
      member_invoice_amount: remoteInvoice.member_invoice_amount + local.memberAmt,
      non_member_invoices: remoteInvoice.non_member_invoices + local.nonMember,
      non_member_invoice_amount: remoteInvoice.non_member_invoice_amount + local.nonMemberAmt,
    })

    // Build payment type breakdown from backend transactions
    const remoteByType = {}
    for (const tx of remoteTxs) {
      const pt = tx.payment_type || 'unknown'
      remoteByType[pt] = remoteByType[pt] || { count: 0, amount: 0 }
      remoteByType[pt].count++
      remoteByType[pt].amount += tx.total_amount || 0
    }
    // Merge with local pending
    const mergedByType = { ...remoteByType }
    for (const [pt, data] of Object.entries(local.byType)) {
      mergedByType[pt] = mergedByType[pt] || { count: 0, amount: 0 }
      mergedByType[pt].count += data.count
      mergedByType[pt].amount += data.amount
    }

    setDashboardStats({
      total_transactions: remoteDash.total_transactions + local.pending,
      total_sales: remoteDash.total_sales + local.totalAmt,
      online_transactions: remoteDash.total_transactions - remoteDash.offline_synced_transactions,
      offline_transactions: remoteDash.offline_synced_transactions + local.pending,
      offline_pending: local.pending,
      by_payment_type: mergedByType
    })

    // Build timeline: group transactions by minute
    const allTxs = [
      ...remoteTxs.map(tx => ({ time: tx.occurred_at || tx.created_at, type: tx.payment_type || 'unknown' })),
      ...JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]').map(tx => ({ time: tx.occurred_at, type: tx.payment?.payment_type || 'unknown' }))
    ]
    const byMinute = {}
    for (const tx of allTxs) {
      const d = new Date(tx.time)
      const key = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      if (!byMinute[key]) byMinute[key] = {}
      byMinute[key][tx.type] = (byMinute[key][tx.type] || 0) + 1
    }
    const timeline = Object.entries(byMinute)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([minute, counts]) => ({ minute, counts }))
    setTimelineData(timeline)
  }

  // Poll admin data every 2s while in admin view
  useEffect(() => {
    if (activeView !== 'admin') return
    const interval = setInterval(refreshAdminData, 2000)
    return () => clearInterval(interval)
  }, [activeView])

  const updateAdminSetting = async (updates) => {
    setAdminSettings(prev => ({ ...prev, ...updates }))
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (res.ok) setAdminSettings(await res.json())
    } catch { /* offline - optimistic update stays */ }
  }

  const simulateInvoiceScan = () => {
    setInvoiceScanStep('scanning')
    setTimeout(() => {
      if (invoiceIsMember) {
        setInvoiceMembership('ICA-2847-5931-0042')
      } else {
        setInvoiceEmail('erik.lindqvist@gmail.com')
      }
      setInvoiceScanStep('scanned')
    }, 1800)
  }

  const submitInvoice = () => {
    const payment = {
      payment_type: 'invoice',
      invoice: {
        customer_email: invoiceIsMember ? null : invoiceEmail,
        membership_number: invoiceIsMember ? invoiceMembership : null,
        is_member: invoiceIsMember
      }
    }
    setShowInvoiceModal(false)
    setShowPaymentModal(false)

    // Show mock email sent
    const recipient = invoiceIsMember ? invoiceMembership : invoiceEmail
    completeCheckout(payment)
    setInvoiceEmailSent({
      recipient,
      amount: total,
      items: [...cart],
      isMember: invoiceIsMember
    })
    setTimeout(() => setInvoiceEmailSent(null), 4000)

    // Reset invoice fields
    setInvoiceEmail('')
    setInvoiceMembership('')
    setInvoiceIsMember(false)
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

  // Sign data with terminal private key (ECDSA P-256)
  const signData = async (data) => {
    const storedKey = localStorage.getItem(PRIVATE_KEY_KEY)
    if (!storedKey) {
      throw new Error('No private key stored. Please add your private key in Terminal Info.')
    }

    // Import the PEM private key
    const pemContents = storedKey
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '')
    
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
    
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )

    // Sign the data
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      dataBuffer
    )

    // Convert signature to base64
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }

  // Verify signature with system public key (ECDSA P-256)
  const verifySignature = async (data, signatureB64) => {
    const storedKey = localStorage.getItem(SYSTEM_PUBLIC_KEY_KEY)
    if (!storedKey) {
      throw new Error('No system public key stored. Please add the system public key in Terminal Info.')
    }

    // Import the PEM public key
    const pemContents = storedKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '')
    
    console.log('[Verify] Public key (first 50 chars):', pemContents.substring(0, 50))
    
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
    
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      binaryKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )

    // Decode signature from base64
    const signatureRaw = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0))
    
    // Backend uses DER format, need to convert to raw format for Web Crypto API
    // DER format: 0x30 [length] 0x02 [r-length] [r] 0x02 [s-length] [s]
    // Raw format: [r (32 bytes)] [s (32 bytes)]
    let signature = signatureRaw
    if (signatureRaw[0] === 0x30) {
      // Parse DER format
      let offset = 2 // Skip 0x30 and length byte
      
      // Parse r
      if (signatureRaw[offset] !== 0x02) throw new Error('Invalid DER signature')
      offset++
      const rLength = signatureRaw[offset]
      offset++
      const rBytes = signatureRaw.slice(offset, offset + rLength)
      offset += rLength
      
      // Parse s
      if (signatureRaw[offset] !== 0x02) throw new Error('Invalid DER signature')
      offset++
      const sLength = signatureRaw[offset]
      offset++
      const sBytes = signatureRaw.slice(offset, offset + sLength)
      
      // Convert to 32-byte arrays, handling leading zeros
      // If length > 32, it has a leading zero we need to remove
      // If length < 32, we need to pad with leading zeros
      const r = new Uint8Array(32)
      const s = new Uint8Array(32)
      
      if (rBytes.length > 32) {
        r.set(rBytes.slice(rBytes.length - 32))
      } else {
        r.set(rBytes, 32 - rBytes.length)
      }
      
      if (sBytes.length > 32) {
        s.set(sBytes.slice(sBytes.length - 32))
      } else {
        s.set(sBytes, 32 - sBytes.length)
      }
      
      // Combine r and s
      signature = new Uint8Array(64)
      signature.set(r, 0)
      signature.set(s, 32)
    }

    // Verify the signature
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    
    console.log('[Verify] Signature raw length:', signatureRaw.length)
    console.log('[Verify] Signature P1363 length:', signature.length)
    
    try {
      const result = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        signature,
        dataBuffer
      )
      return result
    } catch (err) {
      console.error('[Verify] Crypto error:', err)
      return false
    }
  }

  // Generate QR code for Scan & Pay
  const generateScanPayQrCode = async () => {
    const storedKey = localStorage.getItem(PRIVATE_KEY_KEY)
    if (!storedKey) {
      window.alert('Please add your terminal private key in Terminal Info before using Scan & Pay.')
      setShowPaymentModal(false)
      return
    }

    const idempotencyKey = crypto.randomUUID()
    const payload = {
      terminal_code: terminalCode,
      idempotency_key: idempotencyKey,
      total_amount: Number(total.toFixed(2)),
      items: cart.map(({ id, name, price, quantity }) => ({ product_id: id, name, price, quantity })),
      timestamp: Date.now()
    }

    const payloadStr = JSON.stringify(payload)
    
    try {
      const signature = await signData(payloadStr)
      
      // Use btoa with unicode handling for Swedish characters
      const payloadBytes = new TextEncoder().encode(payloadStr)
      const payloadBase64 = btoa(String.fromCharCode(...payloadBytes))
      
      // Create the URL with payload and signature
      const params = new URLSearchParams({
        payload: payloadBase64,
        signature: signature
      })
      
      const url = `${MOBILE_CHECKOUT_BASE}/mobile-checkout?${params.toString()}`
      
      // Generate QR code
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' }
      })
      
      setScanPayData({ idempotencyKey, payload })
      setScanPayQrCode(qrDataUrl)
      setScanPayUrl(url)
    } catch (err) {
      console.error('Failed to generate QR code:', err)
      window.alert('Failed to generate QR code. Please check your private key.')
    }
  }

  // Process Scan & Pay payment
  const processScanPay = async () => {
    setSelectedPayment('scan_pay')
    setPaymentProcessing(true)
    await generateScanPayQrCode()
    setPaymentProcessing(false)
  }

  // Cancel Scan & Pay and return to payment selection
  const cancelScanPay = () => {
    setScanPayQrCode(null)
    setScanPayUrl(null)
    setScanPayData(null)
    setSelectedPayment(null)
  }

  // Copy Scan & Pay URL to clipboard
  const copyScanPayUrl = async () => {
    if (scanPayUrl) {
      await navigator.clipboard.writeText(scanPayUrl)
      setCopyLinkCopied(true)
      setTimeout(() => {
        setCopyLinkCopied(false)
      }, 3000)
    }
  }

  // Start QR scanner for verification
  const startVerificationScanner = async () => {
    setShowVerifyModal(true)
    setVerificationResult(null)
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        scanQRCode()
      }
    } catch (err) {
      console.error('Failed to access camera:', err)
      setVerificationResult({ success: false, message: 'Failed to access camera' })
    }
  }

  // Scan QR code from video stream
  const scanQRCode = async () => {
    if (!videoRef.current || !canvasRef.current) return
    
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    
    // Dynamic import of jsQR for scanning
    const jsQR = (await import('jsqr')).default
    
    const scan = () => {
      if (!showVerifyModal || video.readyState !== video.HAVE_ENOUGH_DATA) {
        requestAnimationFrame(scan)
        return
      }
      
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      
      if (code) {
        verifyPaymentQrCode(code.data)
      } else {
        requestAnimationFrame(scan)
      }
    }
    
    requestAnimationFrame(scan)
  }

  // Verify the scanned payment QR code (local verification using system public key)
  const verifyPaymentQrCode = async (qrData) => {
    try {
      // Parse the QR data (expected format: JSON with signature from backend)
      const data = JSON.parse(qrData)
      const { signature, ...verifyData } = data
      
      if (!signature) {
        setVerificationResult({ success: false, message: 'Invalid QR code: missing signature' })
        setVerifyErrorModal(true)
        return
      }

      // Check if system public key is configured
      const storedKey = localStorage.getItem(SYSTEM_PUBLIC_KEY_KEY)
      if (!storedKey) {
        setVerificationResult({ success: false, message: 'System public key not configured. Please add it in Terminal Info.' })
        setVerifyErrorModal(true)
        return
      }

      // Verify signature locally using system public key
      // Sort keys alphabetically to match Python's json.dumps(sort_keys=True)
      // Also need to match Python's formatting: spaces after : and ,
      const sortedKeys = Object.keys(verifyData).sort()
      const parts = []
      // Fields that are floats in Python (stored as REAL in SQLite)
      const floatFields = ['total_amount']
      for (const key of sortedKeys) {
        let value = verifyData[key]
        // Format value to match Python's json.dumps output
        if (typeof value === 'number') {
          // Only total_amount is a float, others like tx_id are integers
          if (floatFields.includes(key) && Number.isInteger(value)) {
            value = value.toFixed(1)  // 69 -> 69.0
          }
          parts.push(`"${key}": ${value}`)
        } else if (typeof value === 'string') {
          parts.push(`"${key}": "${value}"`)
        } else if (typeof value === 'boolean') {
          parts.push(`"${key}": ${value}`)
        } else {
          parts.push(`"${key}": ${JSON.stringify(value)}`)
        }
      }
      const dataToVerify = '{' + parts.join(', ') + '}'
      console.log('[Verify] Data to verify:', dataToVerify)
      console.log('[Verify] Signature:', signature)
      const isValid = await verifySignature(dataToVerify, signature)
      console.log('[Verify] Result:', isValid)
      
      if (!isValid) {
        setVerificationResult({ success: false, message: 'Invalid signature - payment verification failed' })
        setVerifyErrorModal(true)
        return
      }

      // Check payment status from QR data
      if (verifyData.payment_status !== 'completed') {
        setVerificationResult({ success: false, message: 'Payment not completed yet' })
        setVerifyErrorModal(true)
        return
      }

      // Verify terminal code matches current terminal
      if (verifyData.terminal_code !== terminalCode) {
        setVerificationResult({ success: false, message: 'This payment is for a different terminal' })
        setVerifyErrorModal(true)
        return
      }

      // Verification successful!
      setVerificationResult({ success: true, message: 'Payment verified!', data: verifyData })
      setVerifySuccessModal(true)
    } catch (err) {
      console.error('Failed to verify QR code:', err)
      setVerificationResult({ success: false, message: `Verification error: ${err.message}` })
      setVerifyErrorModal(true)
    }
  }

  // Stop QR scanner
  const stopVerificationScanner = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks()
      tracks.forEach(track => track.stop())
      videoRef.current.srcObject = null
    }
    setShowVerifyModal(false)
    setPastedImage(null)
    setParsedQrData(null)
  }

  // Handle paste image event
  const handlePasteImage = async (e) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue

        const reader = new FileReader()
        reader.onload = async (event) => {
          const dataUrl = event.target?.result
          if (typeof dataUrl !== 'string') return

          setPastedImage(dataUrl)

          try {
            const jsQR = (await import('jsqr')).default

            const img = new Image()
            img.onload = () => {
              const canvas = document.createElement('canvas')
              canvas.width = img.width
              canvas.height = img.height
              const ctx = canvas.getContext('2d')
              ctx.drawImage(img, 0, 0)
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const code = jsQR(imageData.data, imageData.width, imageData.height)

              if (code) {
                try {
                  const qrData = JSON.parse(code.data)
                  setParsedQrData(qrData)
                } catch (parseErr) {
                  console.error('Failed to parse QR data:', parseErr)
                  setVerificationResult({ success: false, message: 'Invalid QR code format' })
                }
              } else {
                setVerificationResult({ success: false, message: 'No QR code found in image' })
              }
            }
            img.src = dataUrl
          } catch (err) {
            console.error('Failed to process image:', err)
            setVerificationResult({ success: false, message: 'Failed to process image' })
          }
        }
        reader.readAsDataURL(file)
        break
      }
    }
  }

  // Clear pasted image
  const clearPastedImage = () => {
    setPastedImage(null)
    setParsedQrData(null)
    setVerificationResult(null)
  }

  // Verify pasted image QR data
  const verifyPastedImage = async () => {
    if (!parsedQrData) return

    const qrData = JSON.stringify(parsedQrData)
    await verifyPaymentQrCode(qrData)
  }

  // Handle uploaded QR code image
  const handleQrImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const jsQR = (await import('jsqr')).default
      
      // Create image from file
      const img = new Image()
      const url = URL.createObjectURL(file)
      
      img.onload = () => {
        // Draw image to canvas
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        
        // Get image data and scan for QR code
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        
        URL.revokeObjectURL(url)
        
        if (code) {
          verifyPaymentQrCode(code.data)
        } else {
          setVerificationResult({ success: false, message: 'No QR code found in image' })
        }
      }
      
      img.onerror = () => {
        URL.revokeObjectURL(url)
        setVerificationResult({ success: false, message: 'Failed to load image' })
      }
      
      img.src = url
    } catch (err) {
      console.error('Failed to process image:', err)
      setVerificationResult({ success: false, message: 'Failed to process image' })
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Open file picker for QR image
  const openQrImagePicker = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="app-shell">
      <header>
        <h1>ICA Self-Checkout</h1>
        <div className="header-actions">
          <span className={networkOnline ? 'status online' : 'status offline'}>
            {networkOnline ? 'Network: Online' : 'Network: Offline'}
            {forceOffline && ' (Simulated)'}
          </span>
          {realNetworkOnline && (
            <button
              className="force-offline-btn"
              onClick={() => setForceOffline((prev) => !prev)}
              title={forceOffline ? 'Exit simulated offline mode' : 'Enter simulated offline mode'}
            >
              {forceOffline ? 'Exit Store Offline' : 'Simulate Store Offline'}
            </button>
          )}
          <button
            className="force-offline-btn"
            onClick={() => setEmergencyMode((prev) => !prev)}
            title={emergencyMode ? 'Exit buyers offline mode' : 'Simulate buyers offline — emergency payment restrictions'}
          >
            {emergencyMode ? 'Exit Buyers Offline' : 'Simulate Buyers Offline'}
          </button>
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
                  <button onClick={openAdmin}>Admin</button>
                  <button onClick={logout}>Sign Out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {emergencyMode && (
        <div className="emergency-banner">
          Emergency Mode — Limited payment options: Card under {EMERGENCY_CARD_LIMIT} SEK, Scan & Pay, Invoice
        </div>
      )}

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

          <div className="private-key-section">
            <h3>System Public Key (ECDSA P-256)</h3>
            <p className="key-description">
              Paste the system public key here. This key is used to verify Scan & Pay payment QR codes offline.
              Copy it from the Dashboard.
            </p>
            <textarea
              value={systemPublicKey}
              onChange={(e) => setSystemPublicKey(e.target.value)}
              placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
              rows={5}
              className="private-key-input"
            />
            <div className="key-actions">
              <button onClick={saveSystemPublicKey} className="save-key-btn">
                {systemPublicKey.trim() ? 'Save System Public Key' : 'Clear System Public Key'}
              </button>
              <span className="key-status">
                {localStorage.getItem(SYSTEM_PUBLIC_KEY_KEY) ? 'Key is saved' : 'No key saved'}
              </span>
            </div>
          </div>
        </section>
      ) : activeView === 'admin' ? (
        <>
        <div className="admin-navbar">
          <button className={`admin-nav-item ${adminTab === 'dashboard' ? 'admin-nav-active' : ''}`} onClick={() => setAdminTab('dashboard')}>Dashboard</button>
          <button className={`admin-nav-item ${adminTab === 'settings' ? 'admin-nav-active' : ''}`} onClick={() => setAdminTab('settings')}>Settings</button>
          <div className="admin-nav-spacer" />
          <button className="admin-nav-back" onClick={() => setActiveView('checkout')}>Back to Checkout</button>
        </div>

        {adminTab === 'settings' ? (
        <section className="panel admin-panel">
          <div className="presets-grid">
            {PRESETS.map((preset) => {
              const settings = {}
              SETTING_KEYS.forEach(k => { settings[k] = preset[k] })
              return (
              <button
                key={preset.name}
                className={`preset-card${activePreset === preset.name ? ' preset-active' : ''}`}
                style={{ '--preset-color': preset.color }}
                onClick={() => updateAdminSetting(settings)}
              >
                <strong className="preset-name">{preset.name}</strong>
                <span className="preset-desc">{preset.desc}</span>
              </button>
            )})}

          </div>

          <div className={`custom-settings-panel${!activePreset ? ' custom-active' : ''}`}>
            <div className="custom-settings-header">
              <strong>Custom Settings{!activePreset ? ' (Active)' : ''}</strong>
            </div>

            <div className="custom-settings-section">
              <h4>Payment Methods</h4>
              <div className="payment-toggles-grid">
                {[...PAYMENT_TYPES, SCAN_PAY_TYPE, INVOICE_TYPE].map((pt) => (
                  <label key={pt.id} className="payment-toggle-row">
                    <span className="payment-toggle-name">{pt.name}</span>
                    <div
                      className={`toggle-switch ${adminSettings[`allow_${pt.id}`] ? 'toggle-switch-on' : ''}`}
                      onClick={() => updateAdminSetting({ [`allow_${pt.id}`]: !adminSettings[`allow_${pt.id}`] })}
                    ><div className="toggle-knob" /></div>
                  </label>
                ))}
              </div>
            </div>

            <div className="custom-settings-section">
              <h4>Invoice Options</h4>
              <div className="preset-toggles">
                <label>
                  <span>Member invoices</span>
                  <div
                    className={`toggle-switch ${adminSettings.allow_invoice_members ? 'toggle-switch-on' : ''}`}
                    onClick={() => updateAdminSetting({ allow_invoice_members: !adminSettings.allow_invoice_members })}
                  ><div className="toggle-knob" /></div>
                </label>
                <label>
                  <span>Non-member invoices</span>
                  <div
                    className={`toggle-switch ${adminSettings.allow_invoice_non_members ? 'toggle-switch-on' : ''}`}
                    onClick={() => updateAdminSetting({ allow_invoice_non_members: !adminSettings.allow_invoice_non_members })}
                  ><div className="toggle-knob" /></div>
                </label>
                <label>
                  <span>Non-member threshold</span>
                  <div className="preset-threshold-input">
                    <input
                      type="number"
                      min="0"
                      value={adminSettings.non_member_invoice_threshold}
                      onChange={(e) => setAdminSettings(prev => ({ ...prev, non_member_invoice_threshold: parseInt(e.target.value) || 0 }))}
                      className="threshold-input"
                    />
                    <button
                      className="save-threshold-btn"
                      onClick={() => updateAdminSetting({ non_member_invoice_threshold: adminSettings.non_member_invoice_threshold })}
                    >Save</button>
                  </div>
                </label>
                <label>
                  <span>Max invoice amount (SEK)</span>
                  <div className="preset-threshold-input">
                    <input
                      type="number"
                      min="0"
                      value={adminSettings.max_invoice_amount}
                      onChange={(e) => setAdminSettings(prev => ({ ...prev, max_invoice_amount: parseInt(e.target.value) || 0 }))}
                      className="threshold-input"
                    />
                    <button
                      className="save-threshold-btn"
                      onClick={() => updateAdminSetting({ max_invoice_amount: adminSettings.max_invoice_amount })}
                    >Save</button>
                  </div>
                </label>
                <label>
                  <span>Max invoices per person</span>
                  <div className="preset-threshold-input">
                    <input
                      type="number"
                      min="1"
                      value={adminSettings.max_invoices_per_person}
                      onChange={(e) => setAdminSettings(prev => ({ ...prev, max_invoices_per_person: parseInt(e.target.value) || 1 }))}
                      className="threshold-input"
                    />
                    <button
                      className="save-threshold-btn"
                      onClick={() => updateAdminSetting({ max_invoices_per_person: adminSettings.max_invoices_per_person })}
                    >Save</button>
                  </div>
                </label>
              </div>
            </div>
          </div>

        </section>
        ) : (
        <div className="admin-layout">
        <section className="panel">
          <div className="dashboard-grid">
            <div className="dash-card dash-card-primary">
              <span className="dash-label">Total Transactions</span>
              <span className="dash-value">{dashboardStats.total_transactions}</span>
              <span className="dash-sub">{dashboardStats.total_sales.toFixed(2)} SEK</span>
            </div>
            <div className="dash-card">
              <span className="dash-label">Online</span>
              <span className="dash-value dash-green">{dashboardStats.online_transactions}</span>
              <span className="dash-sub">Synced to server</span>
            </div>
            <div className="dash-card">
              <span className="dash-label">Offline Synced</span>
              <span className="dash-value dash-amber">{dashboardStats.offline_transactions - dashboardStats.offline_pending}</span>
              <span className="dash-sub">Recovered after reconnect</span>
            </div>
            <div className="dash-card">
              <span className="dash-label">Pending Sync</span>
              <span className="dash-value dash-red">{dashboardStats.offline_pending}</span>
              <span className="dash-sub">In local queue</span>
            </div>
          </div>
        </section>

        <section className="panel">
          <h3>Invoice Statistics</h3>
          <div className="invoice-stats-grid">
            <div className="stat-card">
              <span className="stat-label">Total Invoices</span>
              <span className="stat-value">{invoiceStats.total_invoices}</span>
              <span className="stat-sub">{invoiceStats.total_invoice_amount.toFixed(2)} SEK</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Member Invoices</span>
              <span className="stat-value">{invoiceStats.member_invoices}</span>
              <span className="stat-sub">{invoiceStats.member_invoice_amount.toFixed(2)} SEK</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Non-member Invoices</span>
              <span className="stat-value">{invoiceStats.non_member_invoices}</span>
              <span className="stat-sub">{invoiceStats.non_member_invoice_amount.toFixed(2)} SEK</span>
            </div>
            {invoiceStats.non_member_invoices >= invoiceStats.non_member_invoice_threshold && (
              <div className="stat-card stat-warning">
                <span className="stat-label">Threshold Exceeded</span>
                <span className="stat-value">{invoiceStats.non_member_invoices} / {invoiceStats.non_member_invoice_threshold}</span>
                <span className="stat-sub">Non-member invoices auto-disabled</span>
              </div>
            )}
            {invoiceStats.non_member_invoices >= invoiceStats.non_member_invoice_threshold * 0.8 && invoiceStats.non_member_invoices < invoiceStats.non_member_invoice_threshold && (
              <div className="stat-card stat-caution">
                <span className="stat-label">Nearing Threshold</span>
                <span className="stat-value">{invoiceStats.non_member_invoices} / {invoiceStats.non_member_invoice_threshold}</span>
                <span className="stat-sub">Non-member invoices approaching limit</span>
              </div>
            )}
          </div>
        </section>

        <div className="admin-charts-row">
        <section className="panel">
          <h3>By Payment Method</h3>
          {Object.keys(dashboardStats.by_payment_type).length > 0 ? (
              <div className="payment-breakdown">
                {Object.entries(dashboardStats.by_payment_type)
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([type, data]) => {
                    const info = [...PAYMENT_TYPES, SCAN_PAY_TYPE, INVOICE_TYPE].find(p => p.id === type)
                    const pct = dashboardStats.total_transactions > 0 ? (data.count / dashboardStats.total_transactions * 100) : 0
                    return (
                      <div key={type} className="breakdown-row">
                        <div className="breakdown-label">
                          <span className="breakdown-icon">{info?.icon || '?'}</span>
                          <span>{info?.name || type}</span>
                        </div>
                        <div className="breakdown-bar-wrap">
                          <div className="breakdown-bar" style={{ width: `${Math.max(pct, 2)}%`, background: info?.color || '#94a3b8' }} />
                        </div>
                        <div className="breakdown-stats">
                          <span className="breakdown-count">{data.count}</span>
                          <span className="breakdown-amount">{data.amount.toFixed(2)} SEK</span>
                        </div>
                      </div>
                    )
                  })}
              </div>
          ) : (
            <p className="chart-empty">No transactions yet</p>
          )}
        </section>

        <section className="panel admin-chart-panel">
          <h3>Payments Timeline</h3>
          {timelineData.length === 0 ? (
            <p className="chart-empty">No transactions yet. Make some checkouts!</p>
          ) : (() => {
            const allTypes = new Set()
            let maxCount = 0
            for (const slot of timelineData) {
              let slotTotal = 0
              for (const [type, count] of Object.entries(slot.counts)) {
                allTypes.add(type)
                slotTotal += count
              }
              if (slotTotal > maxCount) maxCount = slotTotal
            }
            const typeList = [...allTypes]
            const typeColors = {}
            const allPayTypes = [...PAYMENT_TYPES, SCAN_PAY_TYPE, INVOICE_TYPE]
            for (const t of typeList) {
              const info = allPayTypes.find(p => p.id === t)
              typeColors[t] = info?.color || '#94a3b8'
            }
            const chartW = 500, chartH = 260, padL = 40, padB = 50, padT = 10, padR = 10
            const plotW = chartW - padL - padR
            const plotH = chartH - padT - padB
            const barGroupW = timelineData.length > 0 ? Math.min(plotW / timelineData.length, 60) : 40
            const barW = Math.max(barGroupW * 0.7, 8)
            const yScale = maxCount > 0 ? plotH / (maxCount * 1.15) : 1
            const gridLines = []
            const yStep = Math.max(1, Math.ceil(maxCount / 4))
            for (let v = 0; v <= maxCount + yStep; v += yStep) {
              const y = padT + plotH - v * yScale
              if (y < padT) break
              gridLines.push({ v, y })
            }

            return (
              <div className="chart-container">
                <svg viewBox={`0 0 ${chartW} ${chartH}`} className="timeline-svg">
                  {gridLines.map(({ v, y }) => (
                    <g key={v}>
                      <line x1={padL} x2={chartW - padR} y1={y} y2={y} stroke="#e4e4e4" strokeWidth="1" />
                      <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#757575">{v}</text>
                    </g>
                  ))}
                  {timelineData.map((slot, i) => {
                    const x = padL + i * barGroupW + barGroupW / 2
                    let cumY = 0
                    return (
                      <g key={slot.minute}>
                        {typeList.map(type => {
                          const count = slot.counts[type] || 0
                          if (count === 0) return null
                          const h = count * yScale
                          const segY = padT + plotH - cumY - h
                          cumY += h
                          return (
                            <rect
                              key={type}
                              x={x - barW / 2}
                              y={segY}
                              width={barW}
                              height={h}
                              fill={typeColors[type]}
                              rx="2"
                            >
                              <title>{type}: {count}</title>
                            </rect>
                          )
                        })}
                        <text
                          x={x}
                          y={chartH - padB + 16}
                          textAnchor="middle"
                          fontSize="10"
                          fill="#757575"
                        >
                          {slot.minute}
                        </text>
                      </g>
                    )
                  })}
                  <line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#d1d1d1" strokeWidth="1" />
                  <line x1={padL} x2={chartW - padR} y1={padT + plotH} y2={padT + plotH} stroke="#d1d1d1" strokeWidth="1" />
                </svg>
                <div className="chart-legend">
                  {typeList.map(type => {
                    const info = allPayTypes.find(p => p.id === type)
                    return (
                      <div key={type} className="legend-item">
                        <span className="legend-dot" style={{ background: typeColors[type] }} />
                        <span>{info?.icon} {info?.name || type}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </section>
        </div>
        </div>
        )}
        </>
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
                  {product.image && (
                    <img 
                      src={product.image} 
                      alt={product.name} 
                      className="product-card-image"
                    />
                  )}
                  <div className="product-card-content">
                    <strong className="product-card-name">{product.name}</strong>
                    <span className="product-card-price">{product.price.toFixed(2)} SEK</span>
                  </div>
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
            {scanPayQrCode ? (
              // Scan & Pay QR Code display
              <div className="scan-pay-qr">
                <h2>Scan & Pay</h2>
                <p className="scan-pay-instruction">Scan this QR code with your phone to complete payment</p>
                <div className="qr-code-container">
                  <img src={scanPayQrCode} alt="Payment QR Code" />
                </div>
                {scanPayUrl && (
                  <div className="scan-pay-url-container">
                    <p className="scan-pay-url">{scanPayUrl}</p>
                    <button className="copy-url-btn" onClick={copyScanPayUrl}>
                      {copyLinkCopied ? 'Copied' : 'Copy Link'}
                    </button>
                  </div>
                )}
                <p className="scan-pay-hint">After payment, scan the verification code shown on your phone</p>
                <div className="scan-pay-actions">
                  <button className="verify-btn" onClick={startVerificationScanner}>
                    Scan Verification Code
                  </button>
                  <button className="cancel-scan-pay" onClick={cancelScanPay}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : !paymentProcessing ? (
              <>
                <h2>Select Payment Method</h2>
                <p className="payment-total">Total: <strong>{total.toFixed(2)} SEK</strong></p>
                {emergencyMode && (
                  <p className="emergency-payment-notice">Emergency mode: Invoice, Scan & Pay, and Card under {EMERGENCY_CARD_LIMIT} SEK only</p>
                )}
                {!networkOnline && !emergencyMode && (
                  <p className="offline-payment-notice">Offline mode: Cash, Scan & Pay, or Invoice available</p>
                )}
                <div className="payment-options">
                  {emergencyMode ? (
                    <>
                      {total <= EMERGENCY_CARD_LIMIT && (
                        <button
                          className="payment-option"
                          style={{ '--payment-color': PAYMENT_TYPES.find(p => p.id === 'credit_card').color }}
                          onClick={() => processPayment('credit_card')}
                        >
                          <span className="payment-icon">{PAYMENT_TYPES.find(p => p.id === 'credit_card').icon}</span>
                          <span className="payment-name">Card (under {EMERGENCY_CARD_LIMIT} SEK)</span>
                        </button>
                      )}
                      <button
                        className="payment-option"
                        style={{ '--payment-color': SCAN_PAY_TYPE.color }}
                        onClick={processScanPay}
                      >
                        <span className="payment-icon">{SCAN_PAY_TYPE.icon}</span>
                        <span className="payment-name">{SCAN_PAY_TYPE.name}</span>
                      </button>
                      <button
                        className="payment-option"
                        style={{ '--payment-color': INVOICE_TYPE.color }}
                        onClick={() => { setShowInvoiceModal(true); setInvoiceIsMember(false); setInvoiceEmail(''); setInvoiceMembership(''); setInvoiceScanStep('choose') }}
                      >
                        <span className="payment-icon">{INVOICE_TYPE.icon}</span>
                        <span className="payment-name">{INVOICE_TYPE.name}</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {PAYMENT_TYPES
                        .filter((pt) => networkOnline || pt.id === 'cash')
                        .map((pt) => (
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
                      {!networkOnline && (
                        <button
                          className="payment-option"
                          style={{ '--payment-color': SCAN_PAY_TYPE.color }}
                          onClick={processScanPay}
                        >
                          <span className="payment-icon">{SCAN_PAY_TYPE.icon}</span>
                          <span className="payment-name">{SCAN_PAY_TYPE.name}</span>
                        </button>
                      )}
                      {!networkOnline && (
                        <button
                          className="payment-option"
                          style={{ '--payment-color': INVOICE_TYPE.color }}
                          onClick={() => { setShowInvoiceModal(true); setInvoiceIsMember(false); setInvoiceEmail(''); setInvoiceMembership(''); setInvoiceScanStep('choose') }}
                        >
                          <span className="payment-icon">{INVOICE_TYPE.icon}</span>
                          <span className="payment-name">{INVOICE_TYPE.name}</span>
                        </button>
                      )}
                    </>
                  )}
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
                      Paid with {paymentDetails.payment_type === 'invoice' ? INVOICE_TYPE.name : PAYMENT_TYPES.find(p => p.id === paymentDetails.payment_type)?.name}
                      {' '}{paymentDetails.payment_type === 'invoice' ? INVOICE_TYPE.icon : PAYMENT_TYPES.find(p => p.id === paymentDetails.payment_type)?.icon}
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

      {/* QR Verification Scanner Modal */}
      {showVerifyModal && (
        <div className="modal-overlay">
          <div className="modal verify-modal">
            <h2>Paste Verification Code</h2>
            <p>Press Ctrl+V to paste the verification QR code screenshot from customer's phone</p>
            
            <div 
              className="paste-image-container"
              onPaste={handlePasteImage}
              tabIndex={0}
            >
              {pastedImage ? (
                <img src={pastedImage} alt="Pasted verification QR code" className="pasted-image" />
              ) : (
                <div className="paste-placeholder">
                  <span className="paste-icon">📋</span>
                  <span>Paste image here (Ctrl+V)</span>
                </div>
              )}
            </div>

            {parsedQrData && (
              <div className="parsed-qr-data">
                <h3>QR Code Data:</h3>
                {Object.entries(parsedQrData).map(([key, value]) => (
                  <div key={key} className="qr-data-row">
                    <span className="qr-data-key">{key}:</span>
                    <span className="qr-data-value">
                      {typeof value === 'string' && value.length > 30 
                        ? value.substring(0, 30) + '...' 
                        : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="verify-actions">
              <button 
                className="verify-btn" 
                onClick={verifyPastedImage}
                disabled={!parsedQrData}
              >
                Verify
              </button>
              <button className="clear-paste-btn" onClick={clearPastedImage}>
                Clear
              </button>
              <button className="cancel-verify" onClick={stopVerificationScanner}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verification Error Modal */}
      {verifyErrorModal && verificationResult && (
        <div className="modal-overlay">
          <div className="modal error-modal">
            <div className="error-icon">✕</div>
            <h2>Verification Failed</h2>
            <p className="error-message">{verificationResult.message}</p>
            <button className="close-error-btn" onClick={() => setVerifyErrorModal(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Verification Success Modal */}
      {verifySuccessModal && verificationResult && (
        <div className="modal-overlay">
          <div className="modal success-modal">
            <div className="success-icon">✓</div>
            <h2>Verification Successful!</h2>
            <div className="success-details">
              <p><strong>Transaction ID:</strong> {verificationResult.data?.tx_id}</p>
              <p><strong>Terminal:</strong> {verificationResult.data?.terminal_code}</p>
              <p><strong>Amount:</strong> {verificationResult.data?.total_amount} SEK</p>
              <p><strong>Status:</strong> {verificationResult.data?.payment_status}</p>
            </div>
            <button className="close-success-btn" onClick={() => {
              setVerifySuccessModal(false)
              setShowVerifyModal(false)
              setPastedImage(null)
              setParsedQrData(null)
              setScanPayQrCode(null)
              setScanPayData(null)
              setShowPaymentModal(false)
              setPaymentDetails({ 
                payment_type: 'scan_pay', 
                verified: true,
                tx_id: verificationResult.data?.tx_id,
                total_amount: verificationResult.data?.total_amount
              })
              setCart([])
              setVerificationResult(null)
            }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Invoice Details Modal */}
      {showInvoiceModal && (
        <div className="modal-overlay">
          <div className="modal invoice-modal">
            <h2>Invoice Payment</h2>
            <p className="payment-total">Total: <strong>{total.toFixed(2)} SEK</strong></p>
            <div className="invoice-type-toggle">
              <button
                className={`invoice-type-btn ${!invoiceIsMember ? 'active' : ''}`}
                onClick={() => { setInvoiceIsMember(false); setInvoiceScanStep('choose'); setInvoiceEmail(''); setInvoiceMembership('') }}
              >
                Non-member
              </button>
              <button
                className={`invoice-type-btn ${invoiceIsMember ? 'active' : ''}`}
                onClick={() => { setInvoiceIsMember(true); setInvoiceScanStep('choose'); setInvoiceEmail(''); setInvoiceMembership('') }}
              >
                ICA Member
              </button>
            </div>
            {invoiceScanStep === 'choose' ? (
              <div className="invoice-scan-card">
                {invoiceIsMember ? (
                  <div className="scan-id-visual ica-card">
                    <div className="ica-card-header">
                      <span className="ica-card-logo">ICA</span>
                      <span className="ica-card-title">Stammis</span>
                    </div>
                    <div className="scan-qr-placeholder">
                      <svg viewBox="0 0 100 100" width="120" height="120">
                        <rect x="5" y="5" width="25" height="25" rx="3" fill="#cf2005"/>
                        <rect x="70" y="5" width="25" height="25" rx="3" fill="#cf2005"/>
                        <rect x="5" y="70" width="25" height="25" rx="3" fill="#cf2005"/>
                        <rect x="38" y="5" width="8" height="8" rx="1" fill="#cf2005" opacity="0.6"/>
                        <rect x="50" y="5" width="8" height="8" rx="1" fill="#cf2005" opacity="0.4"/>
                        <rect x="38" y="17" width="8" height="8" rx="1" fill="#cf2005" opacity="0.5"/>
                        <rect x="5" y="38" width="8" height="8" rx="1" fill="#cf2005" opacity="0.5"/>
                        <rect x="17" y="38" width="8" height="8" rx="1" fill="#cf2005" opacity="0.3"/>
                        <rect x="38" y="38" width="8" height="8" rx="1" fill="#cf2005" opacity="0.7"/>
                        <rect x="50" y="38" width="8" height="8" rx="1" fill="#cf2005" opacity="0.4"/>
                        <rect x="62" y="38" width="8" height="8" rx="1" fill="#cf2005" opacity="0.6"/>
                        <rect x="38" y="50" width="8" height="8" rx="1" fill="#cf2005" opacity="0.3"/>
                        <rect x="50" y="50" width="8" height="8" rx="1" fill="#cf2005" opacity="0.5"/>
                        <rect x="62" y="50" width="8" height="8" rx="1" fill="#cf2005" opacity="0.7"/>
                        <rect x="80" y="50" width="8" height="8" rx="1" fill="#cf2005" opacity="0.4"/>
                        <rect x="38" y="70" width="8" height="8" rx="1" fill="#cf2005" opacity="0.6"/>
                        <rect x="50" y="70" width="8" height="8" rx="1" fill="#cf2005" opacity="0.3"/>
                        <rect x="70" y="70" width="25" height="8" rx="1" fill="#cf2005" opacity="0.5"/>
                        <rect x="70" y="82" width="8" height="13" rx="1" fill="#cf2005" opacity="0.6"/>
                        <rect x="82" y="82" width="13" height="13" rx="1" fill="#cf2005" opacity="0.4"/>
                      </svg>
                    </div>
                    <div className="ica-card-name">ICA-2847-5931-0042</div>
                  </div>
                ) : (
                  <div className="scan-id-visual license-card">
                    <div className="license-header">
                      <span className="license-flag">🇸🇪</span>
                      <span className="license-title">Korkort</span>
                      <span className="license-country">SVERIGE</span>
                    </div>
                    <div className="license-body">
                      <div className="license-photo">
                        <svg viewBox="0 0 60 70" width="50" height="58">
                          <rect width="60" height="70" rx="4" fill="#e2e8f0"/>
                          <circle cx="30" cy="25" r="14" fill="#94a3b8"/>
                          <ellipse cx="30" cy="58" rx="20" ry="16" fill="#94a3b8"/>
                        </svg>
                      </div>
                      <div className="license-info">
                        <div className="license-row"><span className="license-label">1.</span> Lindqvist</div>
                        <div className="license-row"><span className="license-label">2.</span> Erik Anders</div>
                        <div className="license-row"><span className="license-label">3.</span> 1988-04-15</div>
                      </div>
                    </div>
                    <div className="license-qr">
                      <svg viewBox="0 0 80 80" width="60" height="60">
                        <rect x="3" y="3" width="20" height="20" rx="2" fill="#1e3a5f"/>
                        <rect x="57" y="3" width="20" height="20" rx="2" fill="#1e3a5f"/>
                        <rect x="3" y="57" width="20" height="20" rx="2" fill="#1e3a5f"/>
                        <rect x="28" y="3" width="6" height="6" rx="1" fill="#1e3a5f" opacity="0.5"/>
                        <rect x="38" y="8" width="6" height="6" rx="1" fill="#1e3a5f" opacity="0.4"/>
                        <rect x="28" y="28" width="6" height="6" rx="1" fill="#1e3a5f" opacity="0.6"/>
                        <rect x="38" y="28" width="6" height="6" rx="1" fill="#1e3a5f" opacity="0.3"/>
                        <rect x="48" y="28" width="6" height="6" rx="1" fill="#1e3a5f" opacity="0.5"/>
                        <rect x="28" y="48" width="6" height="6" rx="1" fill="#1e3a5f" opacity="0.4"/>
                        <rect x="58" y="48" width="6" height="6" rx="1" fill="#1e3a5f" opacity="0.6"/>
                        <rect x="48" y="58" width="6" height="6" rx="1" fill="#1e3a5f" opacity="0.5"/>
                        <rect x="58" y="58" width="18" height="6" rx="1" fill="#1e3a5f" opacity="0.4"/>
                        <rect x="58" y="68" width="6" height="9" rx="1" fill="#1e3a5f" opacity="0.6"/>
                      </svg>
                    </div>
                  </div>
                )}
                <button className="scan-id-btn" onClick={simulateInvoiceScan}>
                  Scan {invoiceIsMember ? 'Membership Card' : 'Driving License'}
                </button>
                <button className="cancel-payment" onClick={() => setShowInvoiceModal(false)}>Cancel</button>
              </div>
            ) : invoiceScanStep === 'scanning' ? (
              <div className="invoice-scanning">
                <div className="scan-laser-wrap">
                  <div className="scan-laser" />
                </div>
                <p className="scanning-text">Scanning {invoiceIsMember ? 'ICA membership' : 'driving license'}...</p>
              </div>
            ) : (
              <>
                <div className="scan-success-badge">Scanned</div>
                {invoiceIsMember ? (
                  <div className="invoice-field">
                    <label>ICA Membership Number</label>
                    <input type="text" value={invoiceMembership} onChange={(e) => setInvoiceMembership(e.target.value)} />
                  </div>
                ) : (
                  <div className="invoice-field">
                    <label>Customer Email</label>
                    <input type="email" value={invoiceEmail} onChange={(e) => setInvoiceEmail(e.target.value)} />
                  </div>
                )}
                <div className="invoice-actions">
                  <button className="invoice-submit-btn" onClick={submitInvoice} disabled={invoiceIsMember ? !invoiceMembership.trim() : !invoiceEmail.trim()}>
                    Send Invoice
                  </button>
                  <button className="cancel-payment" onClick={() => setShowInvoiceModal(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mock Invoice Email Sent Modal */}
      {invoiceEmailSent && (
        <div className="modal-overlay">
          <div className="modal invoice-email-modal">
            <div className="success-icon">✓</div>
            <h2>Invoice Sent!</h2>
            <p className="invoice-sent-to">
              {invoiceEmailSent.isMember
                ? `Invoice sent to ICA member ${invoiceEmailSent.recipient}`
                : `Invoice email sent to ${invoiceEmailSent.recipient}`}
            </p>
            <p className="invoice-sent-amount">{invoiceEmailSent.amount.toFixed(2)} SEK</p>
            <p className="invoice-sent-items">{invoiceEmailSent.items.length} item(s)</p>
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
