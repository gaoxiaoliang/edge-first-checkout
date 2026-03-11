# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Edge-first, offline-first checkout system for ICA (Swedish grocery retailer). Built for the Couchbase Edge Resilience Hackathon. Three independent apps: a self-checkout frontend, a monitoring dashboard, and a FastAPI backend.

## Development Commands

### Backend (Python/FastAPI)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
No test suite exists. SQLite DB is auto-created at `./edge_checkout.db` on startup (gitignored).

### Frontend - Self-Checkout (React/Vite)
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build
```

### Dashboard (React/Vite)
```bash
cd dashboard
npm install
npm run dev          # http://localhost:5174
npm run build
```

## Architecture

### Three-App Structure
- **`backend/`** — Single FastAPI app (`app/main.py`) serving all API endpoints and server-rendered HTML pages for mobile checkout. Uses async SQLite via aiosqlite with WAL mode. No ORM — raw SQL queries throughout.
- **`frontend/`** — Single-file React app (`src/App.jsx`) for self-checkout terminals. Handles offline caching in `localStorage` under key `ica_offline_transactions`, heartbeat monitoring, and background sync.
- **`dashboard/`** — Single-file React app (`src/DashboardApp.jsx`) for store operations monitoring. Polls backend every 5 seconds.

### Key Backend Modules
- `app/main.py` — All route handlers (auth, transactions, heartbeat, dashboard, mobile checkout, invoice payments). Also contains inline HTML generation for mobile checkout pages. ~1200 lines, single file.
- `app/database.py` — SQLite schema (terminals, transactions, admin_settings tables), connection factory, `terminal_status()` helper (30s staleness window). Uses idempotent `ALTER TABLE` for schema migrations.
- `app/config.py` — Pydantic settings with env/`.env` support. Includes default dev ECDSA keys and optional Couchbase config.
- `app/security.py` — JWT auth (HS256), password hashing, ECDSA keypair generation for terminals.
- `app/models.py` — Pydantic request/response schemas.
- `app/couchbase_sync.py` — Best-effort sync to Couchbase Cloud. Three functions: `sync_transaction()`, `sync_terminal()`, `sync_heartbeat()`. Failures are logged but never block checkout operations.
- `app/email.py` — Invoice email sending via aiosmtplib.
- `main.py` (root of backend/) — Alternative entry point that imports and runs the FastAPI app.

### API Structure
- Health: `GET /health`
- Terminal auth: `POST /auth/login` → JWT token
- Terminal management: `POST /terminals`, `DELETE /dashboard/terminals/{id}`
- Transactions: `POST /transactions` (online), `POST /sync/offline` (batch sync)
- Heartbeat: `POST /heartbeat` (every 5s from terminals)
- Dashboard: `GET /dashboard/stats`, `/dashboard/terminals`, `/dashboard/transactions`, `/dashboard/sync-status`, `/dashboard/couchbase-status`
- Admin: `GET /admin/settings`, `PUT /admin/settings`, `GET /admin/invoice-stats`
- Mobile checkout: `GET /mobile-checkout` (server-rendered HTML), `POST /mobile-checkout/{tx_id}/pay`, `GET /mobile-checkout/{tx_id}/verification`

### Offline-First Flow
1. Frontend sends heartbeat every 5s; failure switches to offline mode
2. Offline transactions are stored in browser `localStorage` with idempotency keys
3. Background sync worker (every 4s) sends batch to `/sync/offline` when back online
4. Backend enforces idempotency via `UNIQUE(terminal_id, idempotency_key)` — duplicate inserts return the existing record

### Invoice Payments
Terminals can create invoice-based transactions. Admin settings in `admin_settings` table control: `allow_invoice_members`, `allow_invoice_non_members`, `non_member_invoice_threshold`. Invoice transactions include `customer_email`, `membership_number`, and `is_invoice` fields. ID scanning demo flow available for non-member verification.

### ECDSA Signatures
Used for mobile checkout (Scan & Pay): terminals sign QR code payloads with per-terminal ECDSA keys, backend verifies. System-level ECDSA key signs verification receipts. Web Crypto API produces P1363 format; backend converts to DER for Python cryptography library.

### Couchbase Cloud Sync
- Optional best-effort sync layer — SQLite is the local source of truth, Couchbase is resilient cloud backup.
- Document key formats: `txn::{terminal_code}::{transaction_id}`, `terminal::{terminal_code}`.
- Gracefully degrades if Couchbase is not configured or unreachable.
- Initialized in FastAPI lifespan; sync calls are fire-and-forget.

### Database Notes
- SQLite with WAL journal mode for concurrent reads.
- Schema migrations are idempotent (CREATE IF NOT EXISTS + try/except ALTER TABLE).
- Three tables: `terminals`, `transactions`, `admin_settings`.
- `get_db()` creates a new connection per call — no connection pooling. Close connections after use.

## Configuration
Backend settings via environment variables or `backend/.env`:
- `DATABASE_PATH` — SQLite path (default: `./edge_checkout.db`)
- `JWT_SECRET` — JWT signing secret
- `ACCESS_TOKEN_EXP_MINUTES` — Token expiry (default: 480)
- `ECDSA_PRIVATE_KEY` / `ECDSA_PUBLIC_KEY` — System-level keys

Couchbase (all optional):
- `COUCHBASE_CONNECTION_STRING`, `COUCHBASE_USERNAME`, `COUCHBASE_PASSWORD`, `COUCHBASE_BUCKET`

Frontend env vars (via Vite's `VITE_` prefix):
- `VITE_API_BASE` — Backend URL (default: `http://localhost:8000`)
- `VITE_MOBILE_CHECKOUT_BASE` — Mobile checkout base URL

## Running the Full System
1. Start backend first (`uvicorn app.main:app --reload`).
2. Open dashboard and create a terminal account via the UI.
3. Login from self-checkout frontend using terminal credentials.
4. Process transactions online or offline (disconnect network to test offline mode).
5. Reconnect network; background sync flushes the local queue automatically.

## Codebase Conventions
- Backend has no test suite. Validate changes by running the server.
- All three apps are independent — no shared code or monorepo tooling.
- Frontend apps are essentially single-file: all logic lives in `App.jsx` / `DashboardApp.jsx`.
- Backend routes are all in `main.py` — no router splitting.
- Mobile checkout pages use server-rendered HTML (inline in Python), not React.
- Swedish characters (å, ä, ö) appear in product names — ensure UTF-8 handling.
- No linting or formatting tools are configured for any of the three apps.
- Frontend uses jsQR for QR scanning and qrcode for QR generation (Scan & Pay flow).
