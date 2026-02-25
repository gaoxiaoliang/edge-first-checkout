import json
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from .database import get_db, init_db, now_iso, terminal_status
from .models import (
    DashboardStatsResponse,
    HeartbeatRequest,
    LoginRequest,
    SyncBatchRequest,
    SyncStatusResponse,
    TerminalCreateRequest,
    TerminalResponse,
    TokenResponse,
    TransactionCreateRequest,
    TransactionResponse,
)
from .security import create_access_token, get_current_terminal_code, hash_password, verify_password


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield


app = FastAPI(title="ICA Edge-First Checkout", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/terminals", response_model=TerminalResponse)
async def create_terminal(payload: TerminalCreateRequest):
    db = await get_db()
    now = now_iso()
    try:
        cur = await db.execute(
            """
            INSERT INTO terminals (terminal_code, password_hash, store_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (payload.terminal_code, hash_password(payload.password), payload.store_name, now, now),
        )
        await db.commit()
        terminal_id = cur.lastrowid
        row = await (await db.execute("SELECT * FROM terminals WHERE id = ?", (terminal_id,))).fetchone()
    except Exception as exc:
        await db.close()
        raise HTTPException(status_code=409, detail="Terminal already exists") from exc

    await db.close()
    return TerminalResponse(
        id=row["id"],
        terminal_code=row["terminal_code"],
        store_name=row["store_name"],
        active=bool(row["active"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        last_seen_at=datetime.fromisoformat(row["last_seen_at"]) if row["last_seen_at"] else None,
        status=terminal_status(row["last_seen_at"]),
    )


@app.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    db = await get_db()
    row = await (
        await db.execute(
            "SELECT terminal_code, password_hash, active FROM terminals WHERE terminal_code = ?",
            (payload.terminal_code,),
        )
    ).fetchone()
    await db.close()

    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not bool(row["active"]):
        raise HTTPException(status_code=403, detail="Terminal inactive")

    token = create_access_token(row["terminal_code"])
    return TokenResponse(access_token=token)


async def _resolve_terminal_id(terminal_code: str) -> tuple[int, str]:
    db = await get_db()
    row = await (
        await db.execute(
            "SELECT id, terminal_code FROM terminals WHERE terminal_code = ?",
            (terminal_code,),
        )
    ).fetchone()
    await db.close()
    if not row:
        raise HTTPException(status_code=404, detail="Terminal not found")
    return row["id"], row["terminal_code"]


async def _record_transaction(terminal_id: int, payload: TransactionCreateRequest) -> TransactionResponse:
    db = await get_db()
    created_at = now_iso()
    item_count = sum(item.quantity for item in payload.items)
    try:
        cur = await db.execute(
            """
            INSERT INTO transactions
            (terminal_id, idempotency_key, total_amount, item_count, payload_json, occurred_at, created_at, synced_from_offline)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                terminal_id,
                payload.idempotency_key,
                payload.total_amount,
                item_count,
                json.dumps(payload.model_dump(), default=str),
                payload.occurred_at.isoformat(),
                created_at,
                1 if payload.offline_created else 0,
            ),
        )
        await db.commit()
        transaction_id = cur.lastrowid
    except Exception:
        existing = await (
            await db.execute(
                "SELECT * FROM transactions WHERE terminal_id = ? AND idempotency_key = ?",
                (terminal_id, payload.idempotency_key),
            )
        ).fetchone()
        await db.close()
        return TransactionResponse(
            id=existing["id"],
            terminal_id=existing["terminal_id"],
            idempotency_key=existing["idempotency_key"],
            total_amount=existing["total_amount"],
            item_count=existing["item_count"],
            occurred_at=datetime.fromisoformat(existing["occurred_at"]),
            created_at=datetime.fromisoformat(existing["created_at"]),
            synced_from_offline=bool(existing["synced_from_offline"]),
        )

    row = await (await db.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,))).fetchone()
    await db.close()

    return TransactionResponse(
        id=row["id"],
        terminal_id=row["terminal_id"],
        idempotency_key=row["idempotency_key"],
        total_amount=row["total_amount"],
        item_count=row["item_count"],
        occurred_at=datetime.fromisoformat(row["occurred_at"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        synced_from_offline=bool(row["synced_from_offline"]),
    )


@app.post("/transactions", response_model=TransactionResponse)
async def create_transaction(
    payload: TransactionCreateRequest,
    terminal_code: str = Depends(get_current_terminal_code),
):
    terminal_id, _ = await _resolve_terminal_id(terminal_code)
    response = await _record_transaction(terminal_id, payload)
    return response


@app.post("/sync/offline", response_model=list[TransactionResponse])
async def sync_offline_transactions(
    payload: SyncBatchRequest,
    terminal_code: str = Depends(get_current_terminal_code),
):
    terminal_id, _ = await _resolve_terminal_id(terminal_code)
    responses: list[TransactionResponse] = []

    for tx in payload.transactions:
        tx.offline_created = True
        responses.append(await _record_transaction(terminal_id, tx))

    db = await get_db()
    await db.execute(
        "UPDATE terminals SET pending_sync_count = 0, last_synced_at = ?, updated_at = ? WHERE id = ?",
        (now_iso(), now_iso(), terminal_id),
    )
    await db.commit()
    await db.close()

    return responses


@app.post("/heartbeat")
async def heartbeat(
    payload: HeartbeatRequest,
    terminal_code: str = Depends(get_current_terminal_code),
) -> dict:
    terminal_id, _ = await _resolve_terminal_id(terminal_code)
    db = await get_db()
    await db.execute(
        """
        UPDATE terminals
        SET last_seen_at = ?, pending_sync_count = ?, updated_at = ?
        WHERE id = ?
        """,
        (now_iso(), payload.current_load, now_iso(), terminal_id),
    )
    await db.commit()
    await db.close()
    return {"status": "alive"}


@app.get("/dashboard/terminals", response_model=list[TerminalResponse])
async def list_terminals() -> list[TerminalResponse]:
    db = await get_db()
    rows = await (await db.execute("SELECT * FROM terminals ORDER BY id DESC")).fetchall()
    await db.close()

    return [
        TerminalResponse(
            id=row["id"],
            terminal_code=row["terminal_code"],
            store_name=row["store_name"],
            active=bool(row["active"]),
            created_at=datetime.fromisoformat(row["created_at"]),
            last_seen_at=datetime.fromisoformat(row["last_seen_at"]) if row["last_seen_at"] else None,
            status=terminal_status(row["last_seen_at"]),
        )
        for row in rows
    ]


@app.get("/dashboard/stats", response_model=DashboardStatsResponse)
async def dashboard_stats() -> DashboardStatsResponse:
    db = await get_db()
    sales_row = await (
        await db.execute(
            "SELECT COALESCE(SUM(total_amount), 0) AS total_sales, COUNT(*) AS total_transactions FROM transactions"
        )
    ).fetchone()
    offline_row = await (
        await db.execute("SELECT COUNT(*) AS count FROM transactions WHERE synced_from_offline = 1")
    ).fetchone()
    terminals = await (await db.execute("SELECT last_seen_at FROM terminals")).fetchall()
    await db.close()

    online_count = sum(1 for row in terminals if terminal_status(row["last_seen_at"]) == "online")
    offline_count = len(terminals) - online_count

    return DashboardStatsResponse(
        total_sales=float(sales_row["total_sales"]),
        total_transactions=int(sales_row["total_transactions"]),
        offline_synced_transactions=int(offline_row["count"]),
        online_terminals=online_count,
        offline_terminals=offline_count,
    )


@app.get("/dashboard/sync-status", response_model=list[SyncStatusResponse])
async def sync_status() -> list[SyncStatusResponse]:
    db = await get_db()
    rows = await (
        await db.execute(
            "SELECT terminal_code, pending_sync_count, last_synced_at FROM terminals ORDER BY terminal_code"
        )
    ).fetchall()
    await db.close()

    return [
        SyncStatusResponse(
            terminal_code=row["terminal_code"],
            pending_sync_count=row["pending_sync_count"],
            last_synced_at=datetime.fromisoformat(row["last_synced_at"]) if row["last_synced_at"] else None,
        )
        for row in rows
    ]


@app.get("/dashboard/transactions", response_model=list[TransactionResponse])
async def list_transactions(limit: int = 100) -> list[TransactionResponse]:
    db = await get_db()
    rows = await (
        await db.execute("SELECT * FROM transactions ORDER BY id DESC LIMIT ?", (limit,))
    ).fetchall()
    await db.close()

    return [
        TransactionResponse(
            id=row["id"],
            terminal_id=row["terminal_id"],
            idempotency_key=row["idempotency_key"],
            total_amount=row["total_amount"],
            item_count=row["item_count"],
            occurred_at=datetime.fromisoformat(row["occurred_at"]),
            created_at=datetime.fromisoformat(row["created_at"]),
            synced_from_offline=bool(row["synced_from_offline"]),
        )
        for row in rows
    ]
