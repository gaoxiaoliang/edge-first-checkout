from datetime import UTC, datetime, timedelta

import aiosqlite

from .config import settings


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(settings.database_path)
    db.row_factory = aiosqlite.Row
    return db


async def init_db() -> None:
    db = await get_db()
    await db.executescript(
        """
        PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS terminals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            terminal_code TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            store_name TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_seen_at TEXT,
            pending_sync_count INTEGER NOT NULL DEFAULT 0,
            last_synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            terminal_id INTEGER NOT NULL,
            idempotency_key TEXT NOT NULL,
            total_amount REAL NOT NULL,
            item_count INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            synced_from_offline INTEGER NOT NULL DEFAULT 0,
            UNIQUE(terminal_id, idempotency_key),
            FOREIGN KEY (terminal_id) REFERENCES terminals(id)
        );
        """
    )
    await db.commit()
    await db.close()


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def terminal_status(last_seen_at_iso: str | None) -> str:
    if not last_seen_at_iso:
        return "offline"

    last_seen = datetime.fromisoformat(last_seen_at_iso)
    if datetime.now(UTC) - last_seen <= timedelta(seconds=30):
        return "online"
    return "offline"
