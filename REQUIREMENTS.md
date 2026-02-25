# Always-On Checkout Requirements

## 1. Problem Statement
Retail checkout must continue during WAN outages. Store devices should persist transactions locally and synchronize to the central system after connectivity recovery, with no lost sales.

## 2. Scope
This repository delivers a hackathon-ready demo with:
- Edge-side transaction capture API.
- Central-side transaction ledger API.
- Offline/online simulation and sync orchestration.
- Web UI demonstrating cashier flow and synchronization behavior.

## 3. Functional Requirements
1. **Local recording**: A checkout transaction must be accepted and persisted even when central connectivity is unavailable.
2. **Queue visibility**: Operators can list pending unsynced transactions.
3. **Recovery sync**: Once connectivity is restored, unsynced transactions are pushed to central storage.
4. **Idempotency**: Duplicate sync attempts must not create duplicate central transactions.
5. **Operational visibility**: Operators can inspect edge and central ledgers.
6. **Config-driven deployment**: Runtime paths and store identity come from config/env.

## 4. Non-Functional Requirements
- **Availability**: Edge transaction writes should remain available when central link is down.
- **Data durability**: Edge writes are persisted in local SQLite before response.
- **Performance target**: Typical local checkout write should complete in under 100ms on a laptop-class device.
- **Security baseline**: Input schema validation and explicit CORS control for demo environment.
- **Maintainability**: Minimal dependencies and clear module boundaries.

## 5. Assumptions
- This demo models one store edge node and one central service in a single backend process for speed of delivery.
- Payment authorization is out of scope (focus is transaction recording resilience).
- Strong consistency with external ERP is out of scope for hackathon MVP.

## 6. Acceptance Criteria
- Cashier can submit transactions while "offline" and observe pending queue growth.
- Sync endpoint returns success after connectivity is restored.
- Synced transactions become visible in central ledger.
- Re-running sync does not duplicate already delivered transactions.
