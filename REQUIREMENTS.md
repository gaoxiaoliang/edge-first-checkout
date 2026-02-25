# ICA Always-On Checkout — Requirements Specification

## 1. Objective
Build a resilient self-checkout platform for ICA stores where kiosks can always complete checkout locally, even when store-to-central connectivity is down, and later synchronize transactions to central systems without data loss or duplication.

## 2. Key Principles
- **Edge-first**: critical checkout writes happen on edge storage first.
- **Offline-first**: user checkout UX must continue while central link is down.
- **Eventual consistency**: central ledger converges after recovery.
- **Data sync**: queued edge orders are pushed once uplink recovers.
- **Zero lost sales**: every accepted checkout is durable and recoverable.

## 3. Functional Requirements
1. Kiosk can add products, change quantities, choose payment method, and submit checkout.
2. Kiosk UI must display network state (central link up/down) using heartbeat updates.
3. During central outage, checkout still succeeds and transaction is persisted locally.
4. When network recovers, a sync mechanism pushes pending edge orders to central storage.
5. API must support idempotent checkout requests (retry-safe).
6. Sync must be idempotent and avoid central duplicates.
7. Admin dashboard must display:
   - total kiosk count,
   - online/offline kiosks,
   - pending sync order count,
   - per-kiosk order volume and order amount (edge and central).

## 4. Data and Persistence Requirements
- Edge data format: normalized order metadata + JSON line-items payload.
- Edge persistence location: SQLite database on edge service host (`edge_store.db`).
- Central persistence location: SQLite database for central ledger (`central_hq.db`).
- Offline queue state: `sync_state='pending'` with transition to `synced` after successful/duplicate-safe sync.

## 5. Non-Functional Requirements
- Durable write acknowledgement from edge only after local commit.
- Single-order consistency: order total must equal sum(line quantity * price).
- Observability: heartbeat timestamps, queue depth, and sync outcomes are visible by API/dashboard.
- Maintainability: keep dependencies minimal and configuration file based.

## 6. Acceptance Criteria
- Central link down: checkout remains functional and pending queue increases.
- Central link up: sync decreases pending queue and increases central order count.
- Retry checkout with same idempotency key does not create duplicate edge orders.
- Re-sync after already delivered orders does not create duplicate central orders.
- Dashboard reflects online/offline kiosk split and per-kiosk KPIs within refresh interval.
