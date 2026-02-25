import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import aiosqlite

from .config import settings
from .models import CheckoutRequest

EDGE_SCHEMA = """
CREATE TABLE IF NOT EXISTS kiosks (
    kiosk_id TEXT PRIMARY KEY,
    central_link_up INTEGER NOT NULL,
    last_heartbeat_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_uuid TEXT NOT NULL UNIQUE,
    kiosk_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    amount_total REAL NOT NULL,
    currency TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    lines_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sync_state TEXT NOT NULL DEFAULT 'pending',
    synced_at TEXT,
    UNIQUE(kiosk_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_edge_orders_sync_state ON edge_orders(sync_state);
"""

CENTRAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS central_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_uuid TEXT NOT NULL UNIQUE,
    kiosk_id TEXT NOT NULL,
    amount_total REAL NOT NULL,
    currency TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    lines_json TEXT NOT NULL,
    received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_central_orders_kiosk ON central_orders(kiosk_id);
"""


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_parent(path_str: str) -> None:
    Path(path_str).parent.mkdir(parents=True, exist_ok=True)


async def init_databases() -> None:
    _ensure_parent(settings.edge_db_path)
    _ensure_parent(settings.central_db_path)

    async with aiosqlite.connect(settings.edge_db_path) as edge:
        await edge.executescript(EDGE_SCHEMA)
        await edge.commit()

    async with aiosqlite.connect(settings.central_db_path) as central:
        await central.executescript(CENTRAL_SCHEMA)
        await central.commit()


async def heartbeat_kiosk(*, kiosk_id: str, central_link_up: bool) -> None:
    now = _iso_now()
    async with aiosqlite.connect(settings.edge_db_path) as conn:
        await conn.execute(
            """
            INSERT INTO kiosks (kiosk_id, central_link_up, last_heartbeat_at, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(kiosk_id) DO UPDATE SET
                central_link_up=excluded.central_link_up,
                last_heartbeat_at=excluded.last_heartbeat_at
            """,
            (kiosk_id, int(central_link_up), now, now),
        )
        await conn.commit()


async def create_order(payload: CheckoutRequest) -> tuple[str, bool]:
    now = _iso_now()
    total = round(sum(line.quantity * line.unit_price for line in payload.lines), 2)
    order_uuid = f"{payload.kiosk_id}:{payload.idempotency_key}"
    lines_json = json.dumps([line.model_dump() for line in payload.lines], ensure_ascii=False)

    async with aiosqlite.connect(settings.edge_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        existing = await conn.execute_fetchone(
            "SELECT order_uuid FROM edge_orders WHERE kiosk_id = ? AND idempotency_key = ?",
            (payload.kiosk_id, payload.idempotency_key),
        )
        if existing:
            return existing["order_uuid"], True

        await conn.execute(
            """
            INSERT INTO edge_orders (
                order_uuid, kiosk_id, idempotency_key, amount_total, currency,
                payment_method, lines_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_uuid,
                payload.kiosk_id,
                payload.idempotency_key,
                total,
                payload.currency,
                payload.payment_method,
                lines_json,
                now,
            ),
        )
        await conn.commit()
    return order_uuid, False


async def list_edge_orders(*, kiosk_id: str | None = None, pending_only: bool = False) -> list[dict]:
    query = "SELECT * FROM edge_orders"
    clauses: list[str] = []
    params: list = []

    if kiosk_id:
        clauses.append("kiosk_id = ?")
        params.append(kiosk_id)
    if pending_only:
        clauses.append("sync_state = 'pending'")

    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY id DESC"

    async with aiosqlite.connect(settings.edge_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        rows = await conn.execute_fetchall(query, tuple(params))
        return [dict(r) for r in rows]


async def list_central_orders() -> list[dict]:
    async with aiosqlite.connect(settings.central_db_path) as conn:
        conn.row_factory = aiosqlite.Row
        rows = await conn.execute_fetchall("SELECT * FROM central_orders ORDER BY id DESC")
        return [dict(r) for r in rows]


async def sync_pending_for_kiosk(kiosk_id: str) -> tuple[int, int, int]:
    now = _iso_now()
    pushed = 0
    duplicates = 0

    async with aiosqlite.connect(settings.edge_db_path) as edge, aiosqlite.connect(
        settings.central_db_path
    ) as central:
        edge.row_factory = aiosqlite.Row
        rows = await edge.execute_fetchall(
            """
            SELECT * FROM edge_orders
            WHERE kiosk_id = ? AND sync_state = 'pending'
            ORDER BY id ASC
            """,
            (kiosk_id,),
        )

        for row in rows:
            try:
                await central.execute(
                    """
                    INSERT INTO central_orders (
                        order_uuid, kiosk_id, amount_total, currency, payment_method,
                        lines_json, received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["order_uuid"],
                        row["kiosk_id"],
                        row["amount_total"],
                        row["currency"],
                        row["payment_method"],
                        row["lines_json"],
                        now,
                    ),
                )
                pushed += 1
            except aiosqlite.IntegrityError:
                duplicates += 1

            await edge.execute(
                "UPDATE edge_orders SET sync_state='synced', synced_at = ? WHERE id = ?",
                (now, row["id"]),
            )

        await central.commit()
        await edge.commit()

        remaining = await edge.execute_fetchone(
            "SELECT COUNT(*) as c FROM edge_orders WHERE kiosk_id = ? AND sync_state='pending'",
            (kiosk_id,),
        )

    return pushed, duplicates, int(remaining[0])


async def get_dashboard_overview() -> dict:
    now = datetime.now(UTC)
    timeout = now - timedelta(seconds=settings.heartbeat_timeout_seconds)

    async with aiosqlite.connect(settings.edge_db_path) as edge, aiosqlite.connect(
        settings.central_db_path
    ) as central:
        edge.row_factory = aiosqlite.Row
        central.row_factory = aiosqlite.Row

        kiosks = await edge.execute_fetchall("SELECT * FROM kiosks")
        total_kiosks = len(kiosks)
        online = 0
        offline = 0
        for k in kiosks:
            hb = datetime.fromisoformat(k["last_heartbeat_at"]) if k["last_heartbeat_at"] else None
            if hb and hb >= timeout and k["central_link_up"] == 1:
                online += 1
            else:
                offline += 1

        pending = await edge.execute_fetchone(
            "SELECT COUNT(*) as c FROM edge_orders WHERE sync_state='pending'"
        )
        central_total = await central.execute_fetchone("SELECT COUNT(*) as c FROM central_orders")
        central_amount = await central.execute_fetchone(
            "SELECT COALESCE(SUM(amount_total), 0) as total FROM central_orders"
        )

    return {
        "total_kiosks": total_kiosks,
        "online_kiosks": online,
        "offline_kiosks": offline,
        "pending_sync_orders": int(pending[0]),
        "central_orders": int(central_total[0]),
        "central_revenue": round(float(central_amount[0]), 2),
    }


async def get_kiosk_stats() -> list[dict]:
    now = datetime.now(UTC)
    timeout = now - timedelta(seconds=settings.heartbeat_timeout_seconds)

    async with aiosqlite.connect(settings.edge_db_path) as edge, aiosqlite.connect(
        settings.central_db_path
    ) as central:
        edge.row_factory = aiosqlite.Row
        central.row_factory = aiosqlite.Row

        kiosks = await edge.execute_fetchall("SELECT * FROM kiosks ORDER BY kiosk_id ASC")
        results: list[dict] = []
        for k in kiosks:
            kiosk_id = k["kiosk_id"]
            hb = datetime.fromisoformat(k["last_heartbeat_at"]) if k["last_heartbeat_at"] else None
            is_online = bool(hb and hb >= timeout and k["central_link_up"] == 1)

            edge_agg = await edge.execute_fetchone(
                """
                SELECT COUNT(*) as c, COALESCE(SUM(amount_total), 0) as total,
                       SUM(CASE WHEN sync_state='pending' THEN 1 ELSE 0 END) as pending
                FROM edge_orders
                WHERE kiosk_id = ?
                """,
                (kiosk_id,),
            )
            central_agg = await central.execute_fetchone(
                "SELECT COUNT(*) as c, COALESCE(SUM(amount_total), 0) as total FROM central_orders WHERE kiosk_id = ?",
                (kiosk_id,),
            )

            results.append(
                {
                    "kiosk_id": kiosk_id,
                    "status": "online" if is_online else "offline",
                    "central_link_up": bool(k["central_link_up"]),
                    "last_heartbeat_at": hb.isoformat() if hb else None,
                    "edge_order_count": int(edge_agg["c"]),
                    "edge_order_amount": round(float(edge_agg["total"]), 2),
                    "central_order_count": int(central_agg["c"]),
                    "central_order_amount": round(float(central_agg["total"]), 2),
                    "pending_sync": int(edge_agg["pending"] or 0),
                }
            )

    return results
