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
            last_synced_at TEXT,
            ecdsa_private_key TEXT,
            ecdsa_public_key TEXT
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
            payment_type TEXT,
            payment_details_json TEXT,
            payment_status TEXT NOT NULL DEFAULT 'completed',
            paid_at TEXT,
            UNIQUE(terminal_id, idempotency_key),
            FOREIGN KEY (terminal_id) REFERENCES terminals(id)
        );

        CREATE TABLE IF NOT EXISTS admin_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )

    # Seed default admin settings
    now = now_iso()
    defaults = {
        "allow_invoice_members": "true",
        "allow_invoice_non_members": "true",
        "non_member_invoice_threshold": "10",
    }
    for key, value in defaults.items():
        await db.execute(
            "INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now),
        )

    # Add invoice columns to transactions (idempotent ALTER TABLE)
    for col, col_def in [
        ("customer_email", "TEXT"),
        ("membership_number", "TEXT"),
        ("is_invoice", "INTEGER DEFAULT 0"),
    ]:
        try:
            await db.execute(f"ALTER TABLE transactions ADD COLUMN {col} {col_def}")
        except Exception:
            pass  # Column already exists

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
