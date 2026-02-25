import json
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite

from .config import settings
from .models import CheckoutRequest


EDGE_SCHEMA = """
CREATE TABLE IF NOT EXISTS edge_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    customer_reference TEXT,
    amount_total REAL NOT NULL,
    currency TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synced_at TEXT
);
"""

CENTRAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS central_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_transaction_id INTEGER NOT NULL,
    store_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    amount_total REAL NOT NULL,
    currency TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE(edge_transaction_id, store_id)
);
"""


def _ensure_db_parent(path_str: str) -> None:
    path = Path(path_str)
    path.parent.mkdir(parents=True, exist_ok=True)


async def init_databases() -> None:
    _ensure_db_parent(settings.edge_db_path)
    _ensure_db_parent(settings.central_db_path)
    async with aiosqlite.connect(settings.edge_db_uri) as conn:
        await conn.execute(EDGE_SCHEMA)
        await conn.commit()
    async with aiosqlite.connect(settings.central_db_uri) as conn:
        await conn.execute(CENTRAL_SCHEMA)
        await conn.commit()


async def create_edge_transaction(payload: CheckoutRequest, store_id: str) -> int:
    total = round(sum(item.quantity * item.unit_price for item in payload.items), 2)
    now = datetime.now(UTC).isoformat()
    serialized = payload.model_dump_json()

    async with aiosqlite.connect(settings.edge_db_uri) as conn:
        cursor = await conn.execute(
            """
            INSERT INTO edge_transactions (
                store_id, cashier_id, customer_reference, amount_total,
                currency, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                store_id,
                payload.cashier_id,
                payload.customer_reference,
                total,
                payload.currency,
                serialized,
                now,
            ),
        )
        await conn.commit()
        return cursor.lastrowid


async def list_edge_transactions(*, synced: bool | None = None) -> list[dict]:
    query = "SELECT * FROM edge_transactions"
    params: tuple = ()
    if synced is True:
        query += " WHERE synced_at IS NOT NULL"
    elif synced is False:
        query += " WHERE synced_at IS NULL"
    query += " ORDER BY id DESC"

    async with aiosqlite.connect(settings.edge_db_uri) as conn:
        conn.row_factory = aiosqlite.Row
        rows = await conn.execute_fetchall(query, params)
        return [dict(row) for row in rows]


async def list_central_transactions() -> list[dict]:
    async with aiosqlite.connect(settings.central_db_uri) as conn:
        conn.row_factory = aiosqlite.Row
        rows = await conn.execute_fetchall(
            "SELECT * FROM central_transactions ORDER BY id DESC"
        )
        return [dict(row) for row in rows]


async def push_unsynced_transactions(*, online: bool = True) -> tuple[int, int]:
    if not online:
        return 0, 0

    push_count = 0
    skip_count = 0
    now = datetime.now(UTC).isoformat()

    async with aiosqlite.connect(settings.edge_db_uri) as edge_conn, aiosqlite.connect(
        settings.central_db_uri
    ) as central_conn:
        edge_conn.row_factory = aiosqlite.Row
        pending = await edge_conn.execute_fetchall(
            "SELECT * FROM edge_transactions WHERE synced_at IS NULL ORDER BY id ASC"
        )

        for row in pending:
            payload_obj = json.loads(row["payload_json"])
            try:
                await central_conn.execute(
                    """
                    INSERT INTO central_transactions (
                        edge_transaction_id, store_id, cashier_id,
                        amount_total, currency, payload_json, received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["id"],
                        row["store_id"],
                        row["cashier_id"],
                        row["amount_total"],
                        row["currency"],
                        json.dumps(payload_obj),
                        now,
                    ),
                )
                await edge_conn.execute(
                    "UPDATE edge_transactions SET synced_at = ? WHERE id = ?",
                    (now, row["id"]),
                )
                push_count += 1
            except aiosqlite.IntegrityError:
                await edge_conn.execute(
                    "UPDATE edge_transactions SET synced_at = ? WHERE id = ?",
                    (now, row["id"]),
                )
                skip_count += 1

        await central_conn.commit()
        await edge_conn.commit()

    return push_count, skip_count
