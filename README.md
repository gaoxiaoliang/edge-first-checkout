# Edge First Checkout

Edge-first, always-on checkout demo for the ICA hackathon challenge.

## What is implemented
- **Requirements document**: [`REQUIREMENTS.md`](./REQUIREMENTS.md)
- **System design document**: [`DESIGN.md`](./DESIGN.md)
- **Architecture diagram source (PlantUML)**: [`docs/diagrams/architecture.puml`](./docs/diagrams/architecture.puml)
- **Backend** (`backend/`): FastAPI + SQLite, with edge queue and central ledger
- **Frontend** (`frontend/`): React app simulating cashier flow, online/offline mode, and sync

## Technology choices
### Backend
- Python 3.12
- uvicorn 0.40.0
- FastAPI 0.128.7
- python-multipart 0.0.22
- pydantic 2.12.5
- pydantic-settings 2.12.0
- aiosqlite 0.22.1

### Frontend
- React 19.2.0
- Vite 7.x (lightweight dev/build tooling)

## Why web app instead of mobile app
For hackathon speed and easier teammate onboarding, a web app provides:
- Zero mobile packaging overhead
- Fast iteration and demo readiness
- Cross-platform access from any laptop/browser

## Project structure
```
.
├── REQUIREMENTS.md
├── DESIGN.md
├── docs/
│   └── diagrams/
│       └── architecture.puml
├── backend/
│   ├── .env.example
│   ├── pyproject.toml
│   └── app/
└── frontend/
    ├── package.json
    └── src/
```

## Backend setup and run
```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs are available at: `http://127.0.0.1:8000/docs`

## Frontend setup and run
```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Optional environment variable:
- `VITE_API_BASE` (default: `http://127.0.0.1:8000`)

## Demo walkthrough
1. Start backend and frontend.
2. In UI, toggle network state to **Offline**.
3. Submit checkout transactions; they appear in Edge queue as unsynced.
4. Toggle to **Online** and click **Sync pending transactions**.
5. Verify records appear in Central ledger.

## Notes for production hardening
- Split edge and central services physically
- Add authN/authZ and cashier identity integration
- Add TLS, encryption-at-rest, audit logs
- Use message bus / durable replication for larger scale
- Add conflict handling and replay metrics dashboards
