# Edge First Checkout

A richer ICA hackathon implementation focused on **Edge-first + Offline-first + Eventual consistency + Data sync + Zero lost sales**.

## Delivered systems
- `backend/`: FastAPI edge/central simulation API with idempotent checkout and sync.
- `frontend/`: self-checkout kiosk simulator (catalog/cart/edit qty/pay/checkout).
- `dashboard/`: admin dashboard for kiosk fleet and KPI visibility.
- `REQUIREMENTS.md`: formal requirements.
- `DESIGN.md`: architecture and distributed consistency design.
- `docs/diagrams/architecture.puml`: PlantUML source.

## Core behaviors
1. Kiosk submits checkouts that are always committed to edge-local SQLite first.
2. Kiosk heartbeat reports central-link state and drives online/offline status.
3. When central link is down, checkouts continue and accumulate in pending queue.
4. When central link recovers, sync pushes pending orders to central ledger.
5. Idempotency avoids duplicates at both checkout and sync stages.
6. Dashboard shows total kiosks, online/offline split, pending queue depth, and per-kiosk volume/revenue.

## Technology stack
### Backend
- Python 3.12
- FastAPI 0.128.7
- uvicorn 0.40.0
- pydantic 2.12.5
- pydantic-settings 2.12.0
- python-multipart 0.0.22
- aiosqlite 0.22.1

### Frontends
- React 19.2.0 + Vite

## Run locally
### 1) Backend
```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2) Kiosk simulator
```bash
cd frontend
npm install
npm run dev
```
Open: http://127.0.0.1:5173

### 3) Dashboard
```bash
cd dashboard
npm install
npm run dev
```
Open: http://127.0.0.1:5174

## Demo scenario
1. Open kiosk app (`5173`), add products, adjust quantities, and checkout.
2. Toggle **Central Link** to `DOWN` and keep checking out; orders still succeed.
3. Observe pending orders increase in kiosk queue.
4. Toggle **Central Link** to `UP`; sync runs and pending orders drop.
5. Open dashboard (`5174`) and verify online/offline kiosk state and KPI updates.

## Data storage and format
- Edge orders are stored in `backend/data/edge_store.db`, table `edge_orders`.
- Central ledger is stored in `backend/data/central_hq.db`, table `central_orders`.
- Line items are stored as JSON payload (`lines_json`) for replay and auditing.

## API docs
When backend is running, visit: http://127.0.0.1:8000/docs
