# ICA Always-On Checkout — System Design

## 1. Architecture

## 1.1 Components
1. **Kiosk Web App (`frontend/`)**
   - Self-checkout UI (catalog, cart, quantity edits, payment, checkout).
   - Sends heartbeat to edge service every 5 seconds with central-link state.
2. **Edge API (`backend/`)**
   - Records checkout orders to local edge DB.
   - Exposes pending queue and sync APIs.
   - Executes sync to central ledger when link is available.
3. **Dashboard Web App (`dashboard/`)**
   - Real-time operational panel for fleet-level and kiosk-level metrics.
4. **Central Ledger (logical domain in backend)**
   - Receives synchronized orders with unique order IDs.

## 1.2 Persistence Model
### Edge DB (`edge_store.db`)
- `kiosks`: heartbeat and connectivity state.
- `edge_orders`: local durable orders with idempotency key and sync state.

### Central DB (`central_hq.db`)
- `central_orders`: replicated central ledger.

## 2. Idempotency & Deduplication Strategy
- **Checkout idempotency**: unique `(kiosk_id, idempotency_key)` in edge DB.
- **Global order identity**: `order_uuid = kiosk_id + ':' + idempotency_key`.
- **Central dedup**: unique `order_uuid` in central DB.
- Sync treats duplicate insert as success-equivalent and marks edge row synced.

## 3. Offline and Online Modes
### 3.1 Offline-to-Central
- Kiosk heartbeat reports `central_link_up=false`.
- Checkout writes to `edge_orders(sync_state='pending')`.
- Sync endpoint returns `503` for that kiosk until link recovers.

### 3.2 Recovery
- Heartbeat flips to `central_link_up=true`.
- Sync endpoint pushes pending edge rows in order.
- Edge rows marked `synced` with `synced_at`; central ledger converges.

## 4. API Surface
- `GET /catalog`
- `POST /edge/heartbeat`
- `POST /edge/checkout`
- `POST /edge/sync`
- `GET /edge/orders`
- `GET /central/orders`
- `GET /dashboard/overview`
- `GET /dashboard/kiosks`
- `GET /health`

FastAPI OpenAPI docs remain available at `/docs`.

## 5. Consistency and Reliability Notes
- Edge commit precedes success response to ensure zero-lost-sale behavior at kiosk acceptance boundary.
- System targets **eventual consistency** for central data, not immediate consistency during outage.
- Sync is replay-safe due to idempotent keys at both edge and central.

## 6. Security & Production Evolution
- Current MVP includes schema validation and config-file based settings.
- Recommended next steps: authn/authz, signed event envelopes, encrypted storage, CDC/message bus replication, audit trails, and multi-store sharding.
