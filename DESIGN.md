# ICA Edge-First Checkout Design

## 1. Architecture Overview

The solution uses an edge-first architecture:

- **Self-checkout frontend** runs at store edge terminals and can operate offline.
- **Central backend service** receives live transactions and delayed offline sync batches.
- **Dashboard frontend** monitors store status, transactions, and synchronization health.

The design ensures continuous operation during outages and eventual consistency after connectivity recovery.

## 2. Database Schema Design (SQLite)

### `terminals`
- `id` (PK)
- `terminal_code` (unique)
- `password_hash`
- `store_name`
- `active`
- `created_at`
- `updated_at`
- `last_seen_at`
- `pending_sync_count`
- `last_synced_at`

### `transactions`
- `id` (PK)
- `terminal_id` (FK -> terminals.id)
- `idempotency_key`
- `total_amount`
- `item_count`
- `payload_json`
- `occurred_at`
- `created_at`
- `synced_from_offline`

**Idempotency rule:** unique constraint on `(terminal_id, idempotency_key)`.

## 3. Self-Checkout Local Storage Strategy

- Local browser storage key: `ica_offline_transactions`.
- During offline mode (heartbeat failure), each checkout payload is appended to local queue.
- Queue entries include idempotency key, item list, total amount, and timestamp.
- After successful sync, the local queue is deleted.
- This guarantees no lost sales during temporary disconnections.

## 4. Data Synchronization Strategy

1. Frontend sends heartbeat every 5 seconds.
2. On heartbeat success, terminal is marked online and reports pending local queue length.
3. Background sync worker runs every 4 seconds.
4. If online and queue exists, worker sends batch to `/sync/offline`.
5. Backend writes transactions idempotently.
6. Backend clears terminal pending sync count and records `last_synced_at`.
7. Frontend clears local queue only after successful backend acknowledgment.

This model provides eventual consistency with safe retries.

## 5. Network Heartbeat Monitoring

- Endpoint: `POST /heartbeat`.
- Authenticated with JWT.
- Payload contains current offline queue length.
- Backend updates terminal last-seen timestamp and pending sync count.
- Dashboard derives online/offline status using heartbeat staleness window (30 seconds).

## 6. Zero Lost Sales Strategy

- Online success path: transaction immediately persisted in central DB.
- Offline path: transaction persisted in local queue first, then synced later.
- Idempotency prevents duplicate ingestion during retries.
- Background worker ensures automated recovery without manual intervention.

## 7. Diagram

PlantUML source is available at `plantuml/architecture.puml`.
