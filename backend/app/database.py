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

        CREATE TABLE IF NOT EXISTS inventory (
            product_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            stock_qty INTEGER NOT NULL DEFAULT 0,
            reorder_threshold INTEGER NOT NULL DEFAULT 10,
            reorder_qty INTEGER NOT NULL DEFAULT 50,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS replenishment_proposals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            proposed_qty INTEGER NOT NULL,
            current_stock INTEGER NOT NULL,
            threshold INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            resolved_at TEXT
        );
        """
    )

    # Seed inventory with default products
    inventory_seed = [
        ("banan", "Banan Eko i klase Klass 1 ICA", 15.00),
        ("mjolk", "Mellanmjölkdryck 1,5% Laktosfri 1,5l Arla Ko", 26.90),
        ("cola", "Läsk Cola Zero 1,5l Coca-Cola", 24.90),
        ("druvor", "Druvor Crimson Röda Kärnfria 500g Klass 1 ICA", 25.00),
        ("tortilla", "Tortilla Original Medium 8p 320g Santa Maria", 17.90),
    ]
    for pid, name, price in inventory_seed:
        await db.execute(
            "INSERT OR IGNORE INTO inventory (product_id, name, price, stock_qty, reorder_threshold, reorder_qty, updated_at) VALUES (?, ?, ?, 100, 10, 50, ?)",
            (pid, name, price, now_iso()),
        )

    # Seed default admin settings
    now = now_iso()
    defaults = {
        "allow_cash": "true",
        "allow_credit_card": "true",
        "allow_swish": "true",
        "allow_apple_pay": "true",
        "allow_google_pay": "true",
        "allow_scan_pay": "true",
        "allow_invoice": "true",
        "allow_invoice_members": "true",
        "allow_invoice_non_members": "true",
        "non_member_invoice_threshold": "10",
        "max_invoice_amount": "5000",
        "max_invoices_per_person": "3",
        "offline_card_limit": "400",
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
