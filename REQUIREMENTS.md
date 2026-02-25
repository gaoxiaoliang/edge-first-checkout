# ICA Edge-First Checkout Requirements

## 1. Functional Requirements

1. The system shall provide a self-checkout web application for store terminals.
2. The system shall provide a dashboard web application for store operations and monitoring.
3. The backend shall provide JWT-based authentication for terminal login.
4. The backend shall support terminal account creation and management.
5. The self-checkout shall support product selection, quantity editing, and checkout.
6. The self-checkout shall detect backend reachability through heartbeat checks.
7. When offline, checkout transactions shall be cached locally in browser storage.
8. When connectivity is restored, cached transactions shall be synchronized automatically in the background.
9. The backend shall support idempotent transaction ingestion to avoid duplicate sales records.
10. The dashboard shall display terminal online/offline status.
11. The dashboard shall display transaction metrics and synchronization status.
12. The dashboard shall allow creation of new terminal accounts.
13. The backend shall expose offline synchronization APIs for batch submission.
14. The system shall guarantee zero lost sales by storing transactions either centrally or locally until sync succeeds.

## 2. Performance Requirements

1. Heartbeat latency target: less than 2 seconds within local network.
2. Offline checkout persistence in browser local storage shall complete in less than 100 ms for common cart sizes.
3. Synchronization worker shall retry every few seconds with non-blocking UI behavior.
4. Dashboard refresh cycle shall support near-real-time visibility (5-second polling interval).
5. Backend shall use asynchronous I/O to handle concurrent terminal and dashboard requests.
6. Local SQLite persistence shall support at least thousands of transactions per store deployment.

## 3. Security Requirements

1. Authentication shall use JWT access tokens for terminal API authorization.
2. Terminal passwords shall be stored as irreversible hashes.
3. Protected APIs shall require Bearer token validation.
4. Token expiration shall be enforced to limit session abuse.
5. Input data shall be validated using typed request/response schemas.
6. CORS policy shall be explicitly configured for frontend/backend integration.
7. Idempotency keys shall prevent replay-based duplication of transaction records.
8. Sensitive production secrets shall be configurable via environment variables.
