# Architecture Overview

```
                         STORE EDGE (Browser)                    STORE BACKEND                    CLOUD
                    ┌─────────────────────────┐          ┌─────────────────────────┐    ┌──────────────────┐
                    │                         │          │                         │    │                  │
  ┌──────────┐     │   Self-Checkout UI       │  online  │     FastAPI Server      │    │  Couchbase Cloud │
  │ Customer │────>│   (React + Vite)         │────────>│                         │───>│  ica-checkout    │
  └──────────┘     │                         │          │   POST /transactions    │    │  bucket          │
                    │   ┌─────────────────┐   │          │   POST /sync/offline    │    │                  │
                    │   │  localStorage   │   │          │   POST /heartbeat       │    │  - transactions  │
                    │   │  (offline queue) │   │          │                         │    │  - heartbeats    │
                    │   └────────┬────────┘   │          │   ┌─────────────────┐   │    └──────────────────┘
                    │            │             │          │   │  SQLite (WAL)   │   │
                    │     offline│path         │          │   │  - terminals    │   │
                    │            │             │  batch   │   │  - transactions │   │
                    │            └─────────────│─────────>│   │  - settings     │   │
                    │         sync on recovery │          │   └─────────────────┘   │
                    └─────────────────────────┘          │                         │    ┌──────────────────┐
                                                          │   ┌─────────────────┐   │    │                  │
  ┌──────────┐     ┌─────────────────────────┐          │   │  SMTP Email     │   │    │  Gmail SMTP      │
  │  Store   │────>│   Admin Dashboard       │────────>│   │  (aiosmtplib)   │───────>│  Invoice emails   │
  │  Owner   │     │   (React + Vite)        │  poll    │   └─────────────────┘   │    │                  │
  └──────────┘     │                         │  5s      │                         │    └──────────────────┘
                    │   - Live stats          │          └─────────────────────────┘
                    │   - Terminal status      │
                    │   - Payment presets      │
                    │   - Invoice controls     │
                    └─────────────────────────┘


  ONLINE FLOW                           OFFLINE FLOW                        RECOVERY FLOW
  ──────────                            ────────────                        ─────────────
  Customer scans items                  Heartbeat fails                     Connectivity returns
       │                                     │                                    │
  Pays at terminal                      Terminal switches to                Heartbeat succeeds
       │                                offline mode                              │
  POST /transactions ──> SQLite              │                              Background sync worker
       │                                Checkout continues                  sends batch to
  Sync to Couchbase                    locally                             POST /sync/offline
       │                                     │                                    │
  Dashboard updates                     Tx saved to localStorage            Idempotent upsert to SQLite
                                             │                                    │
                                        Pending counter increments          Sync to Couchbase
                                                                                  │
                                                                            localStorage cleared
                                                                                  │
                                                                            Dashboard shows
                                                                            recovered transactions
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| localStorage for offline queue | Zero dependencies, works in any browser, survives page refresh |
| Idempotency keys (terminal_id + UUID) | Safe retries — duplicate syncs are harmless |
| SQLite with WAL mode | Concurrent reads during dashboard polling + transaction writes |
| Best-effort Couchbase sync | Never blocks the checkout flow — local SQLite is source of truth |
| Background sync every 4s | Aggressive recovery without overwhelming the backend |
| Heartbeat every 5s, 30s staleness | Fast offline detection, tolerant of brief network blips |
| ECDSA-signed QR codes | Offline-verifiable payment proofs (Scan & Pay) |
| Admin presets | One-click policy changes — no technical knowledge needed |
