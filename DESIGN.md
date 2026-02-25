# Edge-First Checkout System Design

## 1. Architecture Overview
The MVP uses a single FastAPI service containing two logical domains:
- **Edge domain**: local transaction intake and pending queue.
- **Central domain**: headquarters ledger that receives replicated edge transactions.

This keeps hackathon setup simple while preserving the core resilience mechanics.

## 2. Storage Design
### 2.1 Edge database (`edge_store.db`)
Table: `edge_transactions`
- `id` (PK, autoincrement)
- `store_id`
- `cashier_id`
- `customer_reference`
- `amount_total`
- `currency`
- `payload_json`
- `created_at`
- `synced_at` (nullable; null = pending)

### 2.2 Central database (`central_hq.db`)
Table: `central_transactions`
- `id` (PK, autoincrement)
- `edge_transaction_id`
- `store_id`
- `cashier_id`
- `amount_total`
- `currency`
- `payload_json`
- `received_at`
- Unique constraint `(edge_transaction_id, store_id)` for idempotency

## 3. Connectivity Modes
### Offline Mode
1. Cashier submits checkout payload.
2. Edge API writes transaction locally.
3. `synced_at` remains null.
4. Sync attempts return 503 and queue stays intact.

### Online Mode
1. Edge API writes transaction locally.
2. Sync process scans pending rows.
3. Each row is inserted into central ledger.
4. Edge row is marked `synced_at`.

## 4. API Design (REST)
- `POST /edge/transactions`: store checkout transaction locally.
- `GET /edge/transactions?synced=true|false`: view edge queue.
- `POST /edge/sync/push`: push pending edge rows to central.
- `GET /central/transactions`: view central ledger.
- `GET /health`: health check.

FastAPI auto-generates OpenAPI docs at `/docs`, so no separate API spec file is required.

## 5. Reliability Strategies
- Local durable write before ack.
- Pull-from-edge queue model for deterministic retries.
- Idempotency via central unique key.
- Explicit sync state (`synced_at`) for observability.

## 6. Security and Compliance (MVP)
- Strict request schema validation via Pydantic.
- Keep secrets/config in `.env` (not hard-coded).
- Recommend TLS, authN/authZ, audit trails, and encryption-at-rest in production.

## 7. Performance Notes
- SQLite is suitable for single-node demo and moderate local throughput.
- Batched sync loop keeps logic simple; can be extended to chunked/parallel workers.

## 8. Diagram Sources
PlantUML source files are in `docs/diagrams`.
