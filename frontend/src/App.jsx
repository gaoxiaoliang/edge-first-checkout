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
  const networkOnline = realNetworkOnline && !forceOffline  // 最终使用的网络状态
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
  const [adminSettings, setAdminSettings] = useState(null)
  const [invoiceStats, setInvoiceStats] = useState(null)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceIsMember, setInvoiceIsMember] = useState(false)
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [invoiceMembership, setInvoiceMembership] = useState('')
  const [invoiceEmailSent, setInvoiceEmailSent] = useState(null)
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
    const code = window.prompt('Enter admin code:')
    if (code === '1234') {
      setActiveView('admin')
      setMenuOpen(false)
      fetchAdminSettings()
      fetchInvoiceStats()
    }
  }

  const fetchAdminSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/settings`)
      if (res.ok) setAdminSettings(await res.json())
    } catch { /* offline */ }
  }

  const fetchInvoiceStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/invoice-stats`)
      if (res.ok) setInvoiceStats(await res.json())
    } catch { /* offline */ }
  }

  const updateAdminSetting = async (updates) => {
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (res.ok) {
        setAdminSettings(await res.json())
        fetchInvoiceStats()
      }
    } catch { /* offline */ }
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
              {forceOffline ? 'Exit Offline Mode' : 'Simulate Offline'}
            </button>
          )}
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
        <section className="panel admin-panel">
          <div className="pending-header">
            <h2>Admin Settings</h2>
            <button onClick={() => setActiveView('checkout')}>Back to Checkout</button>
          </div>

          {adminSettings ? (
            <div className="admin-settings-grid">
              <div className="admin-toggle-row">
                <label>Allow member invoices</label>
                <button
                  className={`toggle-btn ${adminSettings.allow_invoice_members ? 'toggle-on' : 'toggle-off'}`}
                  onClick={() => updateAdminSetting({ allow_invoice_members: !adminSettings.allow_invoice_members })}
                >
                  {adminSettings.allow_invoice_members ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="admin-toggle-row">
                <label>Allow non-member invoices</label>
                <button
                  className={`toggle-btn ${adminSettings.allow_invoice_non_members ? 'toggle-on' : 'toggle-off'}`}
                  onClick={() => updateAdminSetting({ allow_invoice_non_members: !adminSettings.allow_invoice_non_members })}
                >
                  {adminSettings.allow_invoice_non_members ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="admin-toggle-row">
                <label>Non-member invoice threshold</label>
                <div className="threshold-input-group">
                  <input
                    type="number"
                    min="1"
                    value={adminSettings.non_member_invoice_threshold}
                    onChange={(e) => setAdminSettings({ ...adminSettings, non_member_invoice_threshold: parseInt(e.target.value) || 1 })}
                    className="threshold-input"
                  />
                  <button
                    className="save-threshold-btn"
                    onClick={() => updateAdminSetting({ non_member_invoice_threshold: adminSettings.non_member_invoice_threshold })}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p>Loading settings... (requires network)</p>
          )}

          <h3 style={{ marginTop: '1.5rem' }}>Invoice Statistics</h3>
          {invoiceStats ? (
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
          ) : (
            <p>Loading stats... (requires network)</p>
          )}
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
                {!networkOnline && (
                  <p className="offline-payment-notice">Offline mode: Cash, Scan & Pay, or Invoice available</p>
                )}
                <div className="payment-options">
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
                  {/* Scan & Pay option - only available offline */}
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
                  {/* Invoice option - only available offline */}
                  {!networkOnline && (
                    <button
                      className="payment-option"
                      style={{ '--payment-color': INVOICE_TYPE.color }}
                      onClick={() => { setShowInvoiceModal(true); setInvoiceIsMember(false); setInvoiceEmail(''); setInvoiceMembership('') }}
                    >
                      <span className="payment-icon">{INVOICE_TYPE.icon}</span>
                      <span className="payment-name">{INVOICE_TYPE.name}</span>
                    </button>
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
                onClick={() => setInvoiceIsMember(false)}
              >
                Non-member (Email)
              </button>
              <button
                className={`invoice-type-btn ${invoiceIsMember ? 'active' : ''}`}
                onClick={() => setInvoiceIsMember(true)}
              >
                ICA Member
              </button>
            </div>
            {invoiceIsMember ? (
              <div className="invoice-field">
                <label>ICA Membership Number</label>
                <input
                  type="text"
                  value={invoiceMembership}
                  onChange={(e) => setInvoiceMembership(e.target.value)}
                  placeholder="Enter membership number"
                  autoFocus
                />
              </div>
            ) : (
              <div className="invoice-field">
                <label>Customer Email</label>
                <input
                  type="email"
                  value={invoiceEmail}
                  onChange={(e) => setInvoiceEmail(e.target.value)}
                  placeholder="customer@example.com"
                  autoFocus
                />
              </div>
            )}
            <div className="invoice-actions">
              <button
                className="invoice-submit-btn"
                onClick={submitInvoice}
                disabled={invoiceIsMember ? !invoiceMembership.trim() : !invoiceEmail.trim()}
              >
                Send Invoice
              </button>
              <button className="cancel-payment" onClick={() => setShowInvoiceModal(false)}>
                Cancel
              </button>
            </div>
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
