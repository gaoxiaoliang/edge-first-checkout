# ICA Edge-First Checkout — Demo Script (5 minutes)

## The Story (30 seconds)

"It's a Friday afternoon at an ICA store in Stockholm. 200 customers are shopping. Then the internet goes down.

In most stores, this means chaos — card terminals fail, self-checkout freezes, customers abandon carts. The store loses thousands of kronor per minute.

But not at this ICA. Because we built an edge-first checkout system that never stops selling."

---

## Demo Flow

### Act 1: Normal Operations (1 min)

**Show: Self-Checkout (localhost:5173)**

- Log in as a terminal
- Add a few products to the cart (Bananer, Mjolk, Cola)
- Pay with Credit Card — transaction completes instantly
- "This is a normal day. Every transaction goes straight to the backend."

**Show: Dashboard (localhost:5174)**

- Point to the stats: total sales, transactions, terminal online
- "The store owner sees everything in real time."

---

### Act 2: The Outage (1.5 min)

**Click: "Simulate Store Offline"**

- The status bar turns red: "Network: Offline"
- "The store just lost internet. But watch — the checkout keeps working."

**Process 2-3 offline transactions**

- Add products, pay with Cash
- Show the "Pending Sync" counter incrementing
- "Every sale is saved locally on the terminal. Nothing is lost."

**Click: "Simulate Buyers Offline"**

- Red emergency banner appears
- Open payment — only Card under 400 SEK, Scan & Pay, Invoice show
- "Now it's worse — even customer phones have no signal. We restrict to safe payment methods: contactless card under 400 SEK (offline PIN bypass), QR scan, or invoice."
- Complete an invoice transaction — show the email flow

---

### Act 3: Recovery (1 min)

**Click: "Exit Store Offline"**

- Watch the sync happen — pending count drops to 0
- "The moment connectivity returns, every offline transaction syncs automatically."

**Show: Dashboard**

- Stats update — new transactions appear
- "Zero lost sales. The store owner sees the full picture, including which transactions came from the offline period."

**Show: Couchbase**

- "Every transaction also syncs to Couchbase Cloud — giving ICA a central, resilient data layer across all stores."

---

### Act 4: Store Owner Control (1 min)

**Show: Admin & Settings tab**

- Click through the presets: Secure (blue), Balance (green), Fast (purple), Earnings (gold)
- "The store owner doesn't need to be technical. One click to change the store's payment policy."

**Toggle payment methods in Custom Settings**

- Disable Swish, enable Invoice
- "Full control over which payment methods are available — even during an outage."

**Show the max invoice amount and per-person limits**

- "Built-in fraud controls. The store owner sets the rules."

---

## Closing (30 seconds)

"What we built:
- **Edge-first**: the terminal works without internet
- **Zero lost sales**: every transaction is either stored centrally or queued locally
- **Idempotent sync**: duplicate retries are safe — no double charges
- **Store owner control**: real-time policy management from a single dashboard
- **Couchbase Cloud**: central data resilience across the entire store network

The store never stops. The owner stays in control. The customer never knows anything went wrong."

---

## Key URLs for Demo

| Service | URL |
|---------|-----|
| Self-Checkout | http://localhost:5173 |
| Dashboard | http://localhost:5174 |
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |
