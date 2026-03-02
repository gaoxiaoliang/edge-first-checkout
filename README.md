# ICA Edge-First Checkout System

Hackathon-ready implementation of an edge-first checkout platform for ICA Sweden.

## Project Background

This project was created for the [Couchbase Edge Resilience Hackathon](https://2hero.dev/hackathons/couchbase-edge-resilience-hackathon).

### Hackathon Format

The hackathon organizers assign multiple participants into teams, along with enterprise personnel who present real business challenges from their companies for the teams to solve.

### Challenge: Always-On Checkout

Our team received a challenge from **ICA** (a major Swedish grocery retailer):

> **Main Problem:**
> Store customers and cashiers need to complete purchases without interruptions, but network outages can stop checkout operations and cause lost revenue. Today, transaction recording depends on central systems, creating downtime when connectivity fails.
>
> **Challenge:**
> Build an edge-first checkout system that processes transactions locally during outages and automatically syncs with central systems once connectivity returns—ensuring continuous store operations and zero lost sales.

### Solution Approach

We are building an **edge-first, offline-first** checkout system that:
- Processes transactions locally on edge terminals (self-checkout kiosks)
- Caches sales data in browser localStorage during network outages
- Automatically syncs with central backend when connectivity returns
- Ensures idempotent transaction handling for eventual consistency
- Provides a dashboard for monitoring terminal health and sync status

## Technology Choices

### Frontend (Self-checkout + Dashboard)
- React 19.2
- Vite build tooling for fast local development
- Native browser `localStorage` for offline transaction persistence
- Native Fetch API for backend communication

### Backend (Central Service)
- Python 3.12
- FastAPI 0.128.7
- Uvicorn 0.40.0
- aiosqlite 0.22.1 for asynchronous SQLite persistence
- pydantic 2.12.5 + pydantic-settings 2.12.0
- python-multipart 0.22.0
- PyJWT for JWT token handling

### Why these choices
- Supports rapid hackathon delivery with strong async performance.
- Keeps dependency footprint minimal and practical.
- Enables edge-first/offline-first behavior without complex infrastructure.

## Repository Structure

- `/frontend` - self-checkout system (React)
- `/dashboard` - dashboard system (React)
- `/backend` - central backend service (FastAPI)
- `/docs` - additional documentation assets
- `/plantuml` - architecture diagrams (text-based)

## System Architecture Overview

- Self-checkout authenticates with JWT and processes sales.
- Network heartbeat detects online/offline conditions.
- Offline transactions are cached locally (edge terminal).
- Background sync worker pushes cached transactions after network recovery.
- Backend enforces idempotency for eventual consistency and zero lost sales.
- Dashboard visualizes terminal health, sales, and sync conditions.

See:
- `REQUIREMENTS.md`
- `DESIGN.md`
- `plantuml/architecture.puml`

## Installation Guide

### 1) Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2) Self-checkout frontend

```bash
cd frontend
npm install
npm run dev
```

Default URL: `http://localhost:5173`

### 3) Dashboard frontend

```bash
cd dashboard
npm install
npm run dev
```

Default URL: `http://localhost:5174`

## Running Instructions

1. Start backend first.
2. Open dashboard and create a terminal account (`/terminals` via UI).
3. Login from self-checkout using terminal credentials.
4. Process transactions online or offline.
5. Reconnect network; background sync will automatically flush local queue.
6. Observe terminal status and sync metrics in dashboard.

## Project Explanation

This project is built around an **edge-first, offline-first, eventually consistent** architecture:

- **Edge-first**: store terminal continues checkout flow even if WAN fails.
- **Offline-first**: sales are cached locally to preserve continuity.
- **Eventual consistency**: backend receives delayed data via retryable sync batches.
- **Idempotent pipeline**: duplicate retries are safe via terminal+idempotency unique key.
- **Zero lost sales**: every sale is either centrally stored or durably queued until synced.
