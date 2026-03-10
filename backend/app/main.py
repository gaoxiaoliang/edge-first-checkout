import asyncio
import json
import base64
from contextlib import asynccontextmanager
from datetime import datetime

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend
from cryptography.exceptions import InvalidSignature
from fastapi import Depends, FastAPI, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from .database import get_db, init_db, now_iso, terminal_status
from .config import settings
from .couchbase_sync import init_couchbase, sync_transaction, sync_heartbeat, is_connected
from .email import send_invoice_email
from .models import (
    AdminSettingsResponse,
    AdminSettingsUpdateRequest,
    DashboardStatsResponse,
    HeartbeatRequest,
    InvoiceStatsResponse,
    LoginRequest,
    SyncBatchRequest,
    SyncStatusResponse,
    TerminalCreateRequest,
    TerminalCreateResponse,
    TerminalResponse,
    TokenResponse,
    TransactionCreateRequest,
    TransactionResponse,
)
from .security import (
    create_access_token,
    generate_terminal_ecdsa_keypair,
    get_current_terminal_code,
    get_ecdsa_private_key,
    hash_password,
    verify_password,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    init_couchbase()
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


@app.get("/dashboard/couchbase-status")
async def couchbase_status() -> dict:
    return {
        "connected": is_connected(),
        "bucket": settings.couchbase_bucket or None,
    }


@app.post("/terminals", response_model=TerminalCreateResponse)
async def create_terminal(payload: TerminalCreateRequest):
    db = await get_db()
    now = now_iso()

    # Generate ECDSA key pair for this terminal
    private_key_pem, public_key_pem = generate_terminal_ecdsa_keypair()

    try:
        cur = await db.execute(
            """
            INSERT INTO terminals (terminal_code, password_hash, store_name, created_at, updated_at, ecdsa_private_key, ecdsa_public_key)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.terminal_code,
                hash_password(payload.password),
                payload.store_name,
                now,
                now,
                private_key_pem,
                public_key_pem,
            ),
        )
        await db.commit()
        terminal_id = cur.lastrowid
        row = await (
            await db.execute("SELECT * FROM terminals WHERE id = ?", (terminal_id,))
        ).fetchone()
    except Exception as exc:
        await db.close()
        raise HTTPException(status_code=409, detail="Terminal already exists") from exc

    await db.close()
    return TerminalCreateResponse(
        id=row["id"],
        terminal_code=row["terminal_code"],
        store_name=row["store_name"],
        active=bool(row["active"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        last_seen_at=datetime.fromisoformat(row["last_seen_at"])
        if row["last_seen_at"]
        else None,
        status=terminal_status(row["last_seen_at"]),
        ecdsa_private_key=row["ecdsa_private_key"],
        ecdsa_public_key=row["ecdsa_public_key"],
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
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


def _tx_response(row) -> TransactionResponse:
    return TransactionResponse(
        id=row["id"],
        terminal_id=row["terminal_id"],
        idempotency_key=row["idempotency_key"],
        total_amount=row["total_amount"],
        item_count=row["item_count"],
        occurred_at=datetime.fromisoformat(row["occurred_at"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        synced_from_offline=bool(row["synced_from_offline"]),
        payment_type=row["payment_type"],
        customer_email=row["customer_email"],
        membership_number=row["membership_number"],
        is_invoice=bool(row["is_invoice"]),
    )


async def _record_transaction(
    terminal_id: int, payload: TransactionCreateRequest
) -> TransactionResponse:
    db = await get_db()
    created_at = now_iso()
    item_count = sum(item.quantity for item in payload.items)

    # Extract payment information
    payment_type = payload.payment.payment_type if payload.payment else None
    payment_details_json = (
        json.dumps(payload.payment.model_dump(), default=str)
        if payload.payment
        else None
    )

    # Extract invoice fields
    customer_email = None
    membership_number = None
    is_invoice = 0
    if payment_type == "invoice" and payload.payment and payload.payment.invoice:
        inv = payload.payment.invoice
        is_invoice = 1
        customer_email = inv.customer_email
        membership_number = inv.membership_number

        # Check admin settings for invoice permissions
        is_member = inv.is_member
        settings_rows = await (
            await db.execute("SELECT key, value FROM admin_settings")
        ).fetchall()
        admin = {r["key"]: r["value"] for r in settings_rows}

        if is_member and admin.get("allow_invoice_members") != "true":
            await db.close()
            raise HTTPException(
                status_code=403, detail="Member invoices are currently disabled"
            )
        if not is_member and admin.get("allow_invoice_non_members") != "true":
            await db.close()
            raise HTTPException(
                status_code=403, detail="Non-member invoices are currently disabled"
            )

        # Check threshold for non-members
        if not is_member:
            threshold = int(admin.get("non_member_invoice_threshold", "10"))
            count_row = await (
                await db.execute(
                    "SELECT COUNT(*) as cnt FROM transactions WHERE is_invoice = 1 AND membership_number IS NULL"
                )
            ).fetchone()
            current_count = count_row["cnt"]
            if current_count >= threshold:
                # Auto-disable non-member invoices
                await db.execute(
                    "UPDATE admin_settings SET value = 'false', updated_at = ? WHERE key = 'allow_invoice_non_members'",
                    (now_iso(),),
                )
                await db.commit()
                await db.close()
                raise HTTPException(
                    status_code=403,
                    detail="Non-member invoice threshold exceeded. Non-member invoices have been auto-disabled.",
                )

    try:
        cur = await db.execute(
            """
            INSERT INTO transactions
            (terminal_id, idempotency_key, total_amount, item_count, payload_json, occurred_at, created_at, synced_from_offline, payment_type, payment_details_json, customer_email, membership_number, is_invoice)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                payment_type,
                payment_details_json,
                customer_email,
                membership_number,
                is_invoice,
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
        return _tx_response(existing)

    row = await (
        await db.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,))
    ).fetchone()

    # Look up terminal code for the email
    terminal_row = await (
        await db.execute("SELECT terminal_code FROM terminals WHERE id = ?", (terminal_id,))
    ).fetchone()
    await db.close()

    # Sync to Couchbase (best-effort, non-blocking)
    t_code = terminal_row["terminal_code"] if terminal_row else "unknown"
    sync_transaction(transaction_id, t_code, {
        "type": "transaction",
        "transaction_id": transaction_id,
        "terminal_id": terminal_id,
        "terminal_code": t_code,
        "idempotency_key": payload.idempotency_key,
        "total_amount": payload.total_amount,
        "item_count": item_count,
        "items": [it.model_dump() for it in payload.items],
        "occurred_at": payload.occurred_at.isoformat(),
        "created_at": created_at,
        "synced_from_offline": bool(payload.offline_created),
        "payment_type": payment_type,
        "is_invoice": bool(is_invoice),
        "customer_email": customer_email,
        "membership_number": membership_number,
    })

    # Send invoice email in the background (non-blocking)
    if is_invoice and customer_email:
        asyncio.create_task(
            send_invoice_email(
                to_email=customer_email,
                transaction_id=transaction_id,
                total_amount=payload.total_amount,
                item_count=item_count,
                items_json=json.dumps({"items": [it.model_dump() for it in payload.items]}),
                terminal_code=terminal_row["terminal_code"] if terminal_row else "unknown",
                occurred_at=payload.occurred_at.isoformat(),
                membership_number=membership_number,
            )
        )

    return _tx_response(row)


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
    now = now_iso()
    db = await get_db()
    await db.execute(
        """
        UPDATE terminals
        SET last_seen_at = ?, pending_sync_count = ?, updated_at = ?
        WHERE id = ?
        """,
        (now, payload.current_load, now, terminal_id),
    )
    await db.commit()
    await db.close()
    sync_heartbeat(terminal_code, now, payload.current_load)
    return {"status": "alive"}


@app.get("/dashboard/system-public-key")
async def get_system_public_key() -> dict:
    """Get the system ECDSA public key for terminal to verify payment QR codes."""
    return {"ecdsa_public_key": settings.ecdsa_public_key}


@app.get("/dashboard/terminals", response_model=list[TerminalResponse])
async def list_terminals() -> list[TerminalResponse]:
    db = await get_db()
    rows = await (
        await db.execute("SELECT * FROM terminals ORDER BY id DESC")
    ).fetchall()
    await db.close()

    return [
        TerminalResponse(
            id=row["id"],
            terminal_code=row["terminal_code"],
            store_name=row["store_name"],
            active=bool(row["active"]),
            created_at=datetime.fromisoformat(row["created_at"]),
            last_seen_at=datetime.fromisoformat(row["last_seen_at"])
            if row["last_seen_at"]
            else None,
            status=terminal_status(row["last_seen_at"]),
            ecdsa_public_key=row["ecdsa_public_key"],
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
        await db.execute(
            "SELECT COUNT(*) AS count FROM transactions WHERE synced_from_offline = 1"
        )
    ).fetchone()
    terminals = await (
        await db.execute("SELECT last_seen_at FROM terminals")
    ).fetchall()
    await db.close()

    online_count = sum(
        1 for row in terminals if terminal_status(row["last_seen_at"]) == "online"
    )
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
            last_synced_at=datetime.fromisoformat(row["last_synced_at"])
            if row["last_synced_at"]
            else None,
        )
        for row in rows
    ]


@app.get("/dashboard/transactions", response_model=list[TransactionResponse])
async def list_transactions(limit: int = 100) -> list[TransactionResponse]:
    db = await get_db()
    rows = await (
        await db.execute(
            "SELECT * FROM transactions ORDER BY id DESC LIMIT ?", (limit,)
        )
    ).fetchall()
    await db.close()

    return [_tx_response(row) for row in rows]


@app.get("/dashboard/terminals/{terminal_id}/private-key")
async def get_terminal_private_key(terminal_id: int) -> dict:
    """Get the private key for a terminal (dashboard only)"""
    db = await get_db()
    row = await (
        await db.execute(
            "SELECT ecdsa_private_key FROM terminals WHERE id = ?", (terminal_id,)
        )
    ).fetchone()
    await db.close()

    if not row:
        raise HTTPException(status_code=404, detail="Terminal not found")

    return {"ecdsa_private_key": row["ecdsa_private_key"]}


@app.delete("/dashboard/terminals/{terminal_id}")
async def delete_terminal(terminal_id: int) -> dict:
    """Delete a terminal and all its transactions"""
    db = await get_db()

    # Check if terminal exists
    row = await (
        await db.execute("SELECT id FROM terminals WHERE id = ?", (terminal_id,))
    ).fetchone()

    if not row:
        await db.close()
        raise HTTPException(status_code=404, detail="Terminal not found")

    # Delete associated transactions first
    await db.execute("DELETE FROM transactions WHERE terminal_id = ?", (terminal_id,))

    # Delete the terminal
    await db.execute("DELETE FROM terminals WHERE id = ?", (terminal_id,))

    await db.commit()
    await db.close()

    return {"status": "deleted", "terminal_id": terminal_id}


# ============================================
# Admin Settings Endpoints
# ============================================


@app.get("/admin/settings", response_model=AdminSettingsResponse)
async def get_admin_settings():
    db = await get_db()
    rows = await (await db.execute("SELECT key, value FROM admin_settings")).fetchall()
    await db.close()
    s = {r["key"]: r["value"] for r in rows}
    return _build_admin_settings_response(s)


_BOOL_SETTINGS = [
    "allow_cash", "allow_credit_card", "allow_swish", "allow_apple_pay",
    "allow_google_pay", "allow_scan_pay", "allow_invoice",
    "allow_invoice_members", "allow_invoice_non_members",
]
_INT_SETTINGS = ["non_member_invoice_threshold", "max_invoice_amount", "max_invoices_per_person", "offline_card_limit"]


def _build_admin_settings_response(s: dict) -> AdminSettingsResponse:
    kwargs = {}
    for k in _BOOL_SETTINGS:
        kwargs[k] = s.get(k, "true") == "true"
    for k in _INT_SETTINGS:
        kwargs[k] = int(s.get(k, "0"))
    return AdminSettingsResponse(**kwargs)


@app.put("/admin/settings", response_model=AdminSettingsResponse)
async def update_admin_settings(payload: AdminSettingsUpdateRequest):
    db = await get_db()
    now = now_iso()
    for key in _BOOL_SETTINGS + _INT_SETTINGS:
        value = getattr(payload, key, None)
        if value is not None:
            stored = str(value).lower() if key in _BOOL_SETTINGS else str(value)
            await db.execute(
                "INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
                (key, stored, now, stored, now),
            )
    await db.commit()
    rows = await (await db.execute("SELECT key, value FROM admin_settings")).fetchall()
    await db.close()
    s = {r["key"]: r["value"] for r in rows}
    return _build_admin_settings_response(s)


@app.get("/admin/invoice-stats", response_model=InvoiceStatsResponse)
async def get_invoice_stats():
    db = await get_db()
    total_row = await (
        await db.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as amt FROM transactions WHERE is_invoice = 1"
        )
    ).fetchone()
    member_row = await (
        await db.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as amt FROM transactions WHERE is_invoice = 1 AND membership_number IS NOT NULL"
        )
    ).fetchone()
    non_member_row = await (
        await db.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as amt FROM transactions WHERE is_invoice = 1 AND membership_number IS NULL"
        )
    ).fetchone()
    settings_rows = await (
        await db.execute("SELECT key, value FROM admin_settings")
    ).fetchall()
    await db.close()
    s = {r["key"]: r["value"] for r in settings_rows}
    threshold = int(s.get("non_member_invoice_threshold", "10"))
    return InvoiceStatsResponse(
        total_invoices=total_row["cnt"],
        total_invoice_amount=float(total_row["amt"]),
        member_invoices=member_row["cnt"],
        member_invoice_amount=float(member_row["amt"]),
        non_member_invoices=non_member_row["cnt"],
        non_member_invoice_amount=float(non_member_row["amt"]),
        non_member_invoice_threshold=threshold,
        auto_disabled=s.get("allow_invoice_non_members") != "true"
        and non_member_row["cnt"] >= threshold,
    )


# ============================================
# Mobile Checkout (Scan & Pay) Endpoints
# ============================================


def convert_p1363_to_der(signature: bytes) -> bytes:
    """Convert IEEE P1363 signature format to DER format.

    Web Crypto API produces P1363 format (r || s, each 32 bytes for P-256).
    Python cryptography library expects DER format.
    """
    if len(signature) != 64:
        # Not P1363 format, might already be DER
        return signature

    r = int.from_bytes(signature[:32], byteorder="big")
    s = int.from_bytes(signature[32:], byteorder="big")

    # Encode as DER
    def encode_int(value: int) -> bytes:
        # Get the minimal byte representation
        length = (value.bit_length() + 8) // 8  # +8 to handle sign bit
        value_bytes = value.to_bytes(length, byteorder="big")
        # If high bit is set, prepend 0x00 to indicate positive number
        if value_bytes[0] & 0x80:
            value_bytes = b"\x00" + value_bytes
        return b"\x02" + bytes([len(value_bytes)]) + value_bytes

    r_encoded = encode_int(r)
    s_encoded = encode_int(s)

    sequence = r_encoded + s_encoded
    return b"\x30" + bytes([len(sequence)]) + sequence


def verify_ecdsa_signature(public_key_pem: str, data: str, signature_b64: str) -> bool:
    """Verify ECDSA signature using terminal's public key.

    Supports both DER format and IEEE P1363 format (from Web Crypto API).
    """
    try:
        print(f"[VERIFY] Loading public key...")
        public_key = serialization.load_pem_public_key(
            public_key_pem.encode("utf-8"), backend=default_backend()
        )

        print(f"[VERIFY] Decoding signature from base64...")
        signature_raw = base64.b64decode(signature_b64)
        print(f"[VERIFY] Raw signature length: {len(signature_raw)} bytes")

        # Try P1363 format first (from Web Crypto API), convert to DER
        if len(signature_raw) == 64:
            print(f"[VERIFY] Converting P1363 to DER format...")
            signature = convert_p1363_to_der(signature_raw)
            print(f"[VERIFY] DER signature length: {len(signature)} bytes")
        else:
            print(f"[VERIFY] Using signature as-is (already DER or other format)")
            signature = signature_raw

        print(f"[VERIFY] Data to verify (length={len(data)}): {data[:100]}...")
        print(f"[VERIFY] Calling verify...")
        public_key.verify(signature, data.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        print(f"[VERIFY] SUCCESS!")
        return True
    except InvalidSignature as e:
        print(f"[VERIFY] InvalidSignature: {e}")
        return False
    except Exception as e:
        print(f"[VERIFY] Exception: {type(e).__name__}: {e}")
        import traceback

        traceback.print_exc()
        return False


def sign_with_system_key(data: str) -> str:
    """Sign data with system private key"""
    private_key = get_ecdsa_private_key()
    signature = private_key.sign(data.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(signature).decode("utf-8")


@app.get("/mobile-checkout", response_class=HTMLResponse)
async def mobile_checkout(
    payload: str = Query(..., description="Base64 encoded payload"),
    signature: str = Query(..., description="ECDSA signature"),
):
    """
    Mobile checkout page - verifies signature and creates unpaid transaction
    """
    print(f"[DEBUG] Received payload (base64): {payload[:50]}...")
    print(f"[DEBUG] Received signature: {signature[:50]}...")

    try:
        # Decode payload
        payload_str = base64.b64decode(payload).decode("utf-8")
        payload_data = json.loads(payload_str)
        print(f"[DEBUG] Decoded payload: {payload_str[:100]}...")
    except Exception as e:
        print(f"[DEBUG] Failed to decode payload: {e}")
        return HTMLResponse(content=_error_html("Invalid payload"), status_code=400)

    terminal_code = payload_data.get("terminal_code")
    if not terminal_code:
        return HTMLResponse(
            content=_error_html("Missing terminal code"), status_code=400
        )

    print(f"[DEBUG] Terminal code: {terminal_code}")

    # Get terminal's public key
    db = await get_db()
    row = await (
        await db.execute(
            "SELECT id, ecdsa_public_key FROM terminals WHERE terminal_code = ?",
            (terminal_code,),
        )
    ).fetchone()

    if not row:
        await db.close()
        print(f"[DEBUG] Terminal not found: {terminal_code}")
        return HTMLResponse(content=_error_html("Terminal not found"), status_code=404)

    terminal_id = row["id"]
    public_key = row["ecdsa_public_key"]
    print(f"[DEBUG] Found terminal ID: {terminal_id}")
    print(f"[DEBUG] Public key: {public_key[:50]}...")

    # Verify signature
    if not verify_ecdsa_signature(public_key, payload_str, signature):
        await db.close()
        print(f"[DEBUG] Signature verification FAILED")
        print(f"[DEBUG] Data signed: {payload_str}")
        print(f"[DEBUG] Signature: {signature}")
        return HTMLResponse(content=_error_html("Invalid signature"), status_code=403)

    print(f"[DEBUG] Signature verification SUCCESS")

    # Create unpaid transaction
    idempotency_key = payload_data.get("idempotency_key")
    total_amount = payload_data.get("total_amount", 0)
    items = payload_data.get("items", [])

    # Check if transaction already exists
    existing = await (
        await db.execute(
            "SELECT id, payment_status FROM transactions WHERE terminal_id = ? AND idempotency_key = ?",
            (terminal_id, idempotency_key),
        )
    ).fetchone()

    if existing:
        tx_id = existing["id"]
        payment_status = existing["payment_status"]
    else:
        # Create new transaction with pending status
        item_count = sum(item.get("quantity", 1) for item in items)
        cur = await db.execute(
            """
            INSERT INTO transactions (terminal_id, idempotency_key, total_amount, item_count, payload_json, occurred_at, created_at, payment_type, payment_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'scan_pay', 'pending')
            """,
            (
                terminal_id,
                idempotency_key,
                total_amount,
                item_count,
                json.dumps(items),
                now_iso(),
                now_iso(),
            ),
        )
        await db.commit()
        tx_id = cur.lastrowid
        payment_status = "pending"

    await db.close()

    # Return shopping cart HTML page
    return HTMLResponse(
        content=_cart_html(
            tx_id, terminal_code, idempotency_key, items, total_amount, payment_status
        )
    )


@app.post("/mobile-checkout/{tx_id}/pay")
async def process_mobile_payment(tx_id: int):
    """Process payment for mobile checkout transaction"""
    db = await get_db()

    row = await (
        await db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,))
    ).fetchone()

    if not row:
        await db.close()
        raise HTTPException(status_code=404, detail="Transaction not found")

    if row["payment_status"] == "completed":
        await db.close()
        return {"status": "already_paid", "tx_id": tx_id}

    # Update payment status to completed
    await db.execute(
        "UPDATE transactions SET payment_status = 'completed', paid_at = ? WHERE id = ?",
        (now_iso(), tx_id),
    )
    await db.commit()
    await db.close()

    return {"status": "success", "tx_id": tx_id}


@app.get("/mobile-checkout/{tx_id}/verification", response_class=HTMLResponse)
async def get_verification_page(tx_id: int):
    """Get verification page with QR code for terminal to scan"""
    db = await get_db()

    row = await (
        await db.execute(
            """SELECT tx.*, t.terminal_code 
               FROM transactions tx 
               JOIN terminals t ON tx.terminal_id = t.id 
               WHERE tx.id = ?""",
            (tx_id,),
        )
    ).fetchone()

    if not row:
        await db.close()
        return HTMLResponse(
            content=_error_html("Transaction not found"), status_code=404
        )

    await db.close()

    # Create verification data
    verification_data = {
        "tx_id": row["id"],
        "terminal_code": row["terminal_code"],
        "idempotency_key": row["idempotency_key"],
        "total_amount": row["total_amount"],
        "payment_status": row["payment_status"],
    }

    # Sign the verification data
    verification_str = json.dumps(verification_data, sort_keys=True)
    print(f"[DEBUG] Verification data to sign: {verification_str}")
    print(
        f"[DEBUG] System public key (first 50 chars): {settings.ecdsa_public_key[27:77]}"
    )
    signature = sign_with_system_key(verification_str)
    print(f"[DEBUG] Generated signature: {signature}")

    verification_data["signature"] = signature

    return HTMLResponse(content=_verification_html(verification_data))


def _error_html(message: str) -> str:
    """Generate error HTML page"""
    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error - ICA Mobile Checkout</title>
        <style>
            * {{ margin: 0; padding: 0; box-sizing: border-box; }}
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fee2e2; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }}
            .error-box {{ background: white; padding: 2rem; border-radius: 16px; text-align: center; max-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }}
            .error-icon {{ font-size: 3rem; margin-bottom: 1rem; }}
            h1 {{ color: #dc2626; margin-bottom: 0.5rem; }}
            p {{ color: #64748b; }}
        </style>
    </head>
    <body>
        <div class="error-box">
            <div class="error-icon">❌</div>
            <h1>Error</h1>
            <p>{message}</p>
        </div>
    </body>
    </html>
    """


def _cart_html(
    tx_id: int,
    terminal_code: str,
    idempotency_key: str,
    items: list,
    total: float,
    payment_status: str,
) -> str:
    """Generate shopping cart HTML page"""
    items_html = ""
    for item in items:
        name = item.get("name", "Unknown")
        price = item.get("price", 0)
        qty = item.get("quantity", 1)
        items_html += f"""
        <div class="cart-item">
            <div class="item-info">
                <span class="item-name">{name}</span>
                <span class="item-qty">x{qty}</span>
            </div>
            <span class="item-price">{price * qty:.2f} SEK</span>
        </div>
        """

    if payment_status == "paid":
        action_html = f"""
        <div class="paid-notice">
            <div class="check-icon">✓</div>
            <p>Payment Complete!</p>
            <a href="/mobile-checkout/{tx_id}/verification" class="verify-link">Show Verification Code</a>
        </div>
        """
    else:
        action_html = f"""
        <button class="pay-btn" onclick="launchSwish()">
            Pay with Swish 📱
        </button>
        <script>
            // Step 1: Show "launching Swish" animation
            function launchSwish() {{
                const btn = document.querySelector('.pay-btn');
                btn.disabled = true;
                btn.textContent = 'Opening Swish...';
                
                // Show launching animation
                const modal = document.querySelector('.swish-modal');
                modal.style.display = 'flex';
                modal.innerHTML = `
                    <div class="swish-launching">
                        <div class="swish-logo">📱</div>
                        <div class="swish-rings">
                            <div class="swish-ring"></div>
                            <div class="swish-ring delay-1"></div>
                            <div class="swish-ring delay-2"></div>
                        </div>
                        <h2>Opening Swish App...</h2>
                        <p class="swish-hint">Please complete payment in Swish</p>
                    </div>
                `;
                
                // After 2.5 seconds, show confirmation UI
                setTimeout(() => {{
                    showConfirmation();
                }}, 2500);
            }}
            
            // Step 2: Show confirmation UI
            function showConfirmation() {{
                const modal = document.querySelector('.swish-modal');
                modal.innerHTML = `
                    <div class="swish-confirm">
                        <div class="swish-confirm-icon">✓</div>
                        <h2>Payment Completed in Swish?</h2>
                        <p class="swish-confirm-hint">Click the button below after you have completed the payment in Swish app</p>
                        <button class="confirm-btn" onclick="confirmPayment()">
                            I've Completed Payment
                        </button>
                        <button class="cancel-btn" onclick="cancelPayment()">
                            Cancel
                        </button>
                    </div>
                `;
            }}
            
            // Step 3: Process payment after user confirmation
            async function confirmPayment() {{
                const modal = document.querySelector('.swish-modal');
                modal.innerHTML = `
                    <div class="swish-animation">
                        <div class="swish-spinner"></div>
                        <h2>Verifying Payment...</h2>
                        <p>Please wait</p>
                    </div>
                `;
                
                // Simulate verification delay
                await new Promise(r => setTimeout(r, 1500));
                
                try {{
                    const res = await fetch('/mobile-checkout/{tx_id}/pay', {{ method: 'POST' }});
                    if (res.ok) {{
                        modal.innerHTML = `
                            <div class="swish-success">
                                <div class="success-icon">✓</div>
                                <h2>Payment Successful!</h2>
                                <p>Redirecting to verification...</p>
                            </div>
                        `;
                        setTimeout(() => {{
                            window.location.href = '/mobile-checkout/{tx_id}/verification';
                        }}, 1500);
                    }} else {{
                        alert('Payment verification failed. Please try again.');
                        resetPayment();
                    }}
                }} catch (e) {{
                    alert('Network error. Please try again.');
                    resetPayment();
                }}
            }}
            
            // Cancel payment and reset
            function cancelPayment() {{
                resetPayment();
            }}
            
            function resetPayment() {{
                const btn = document.querySelector('.pay-btn');
                btn.disabled = false;
                btn.textContent = 'Pay with Swish 📱';
                document.querySelector('.swish-modal').style.display = 'none';
            }}
        </script>
        """

    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ICA Mobile Checkout</title>
        <style>
            * {{ margin: 0; padding: 0; box-sizing: border-box; }}
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }}
            .card {{ background: white; border-radius: 16px; padding: 2rem; max-width: 400px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }}
            .header {{ text-align: center; margin-bottom: 1.5rem; }}
            .header h1 {{ font-size: 1.5rem; color: #ea580c; margin-bottom: 0.25rem; }}
            .header p {{ opacity: 0.8; font-size: 0.875rem; color: #64748b; }}
            .cart-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #e2e8f0; }}
            .cart-header h2 {{ font-size: 1.125rem; color: #0f172a; }}
            .terminal-badge {{ background: #f1f5f9; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; color: #64748b; }}
            .cart-items {{ margin-bottom: 1.5rem; }}
            .cart-item {{ display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; }}
            .cart-item:last-child {{ border-bottom: none; }}
            .item-info {{ display: flex; align-items: center; gap: 0.5rem; }}
            .item-name {{ font-weight: 500; color: #0f172a; }}
            .item-qty {{ color: #64748b; font-size: 0.875rem; }}
            .item-price {{ font-weight: 600; color: #0f172a; }}
            .total-row {{ display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-top: 2px solid #0f172a; margin-top: 0.5rem; }}
            .total-label {{ font-size: 1.125rem; font-weight: 600; color: #0f172a; }}
            .total-amount {{ font-size: 1.5rem; font-weight: 700; color: #ea580c; }}
            .pay-btn {{ width: 100%; padding: 1rem; background: #7c3aed; color: white; border: none; border-radius: 12px; font-size: 1.125rem; font-weight: 600; cursor: pointer; margin-top: 1rem; }}
            .pay-btn:hover {{ background: #6d28d9; }}
            .pay-btn:disabled {{ background: #94a3b8; cursor: not-allowed; }}
            .paid-notice {{ text-align: center; padding: 1.5rem 0; }}
            .check-icon {{ width: 60px; height: 60px; background: #16a34a; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 1rem; }}
            .paid-notice p {{ color: #16a34a; font-weight: 600; font-size: 1.25rem; margin-bottom: 1rem; }}
            .verify-link {{ display: inline-block; padding: 0.75rem 1.5rem; background: #0f172a; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; }}
            .swish-modal {{ display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); align-items: center; justify-content: center; z-index: 100; }}
            .swish-animation {{ text-align: center; color: white; }}
            .swish-animation h2 {{ margin-bottom: 1rem; }}
            .swish-spinner {{ width: 80px; height: 80px; border: 4px solid rgba(255,255,255,0.3); border-top-color: #7c3aed; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }}
            @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
            .swish-success {{ text-align: center; }}
            .success-icon {{ width: 80px; height: 80px; background: #16a34a; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin: 0 auto 1rem; }}
            
            /* Swish launching animation */
            .swish-launching {{ text-align: center; color: white; position: relative; }}
            .swish-launching h2 {{ margin-bottom: 0.5rem; font-size: 1.5rem; }}
            .swish-hint {{ opacity: 0.8; font-size: 0.875rem; }}
            .swish-logo {{ font-size: 4rem; margin-bottom: 1rem; animation: bounce 1s ease-in-out infinite; }}
            @keyframes bounce {{ 0%, 100% {{ transform: translateY(0); }} 50% {{ transform: translateY(-10px); }} }}
            .swish-rings {{ position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 200px; height: 200px; pointer-events: none; }}
            .swish-ring {{ position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 100px; height: 100px; border: 3px solid rgba(124, 58, 237, 0.6); border-radius: 50%; animation: ripple 1.5s ease-out infinite; }}
            .swish-ring.delay-1 {{ animation-delay: 0.5s; }}
            .swish-ring.delay-2 {{ animation-delay: 1s; }}
            @keyframes ripple {{ 0% {{ width: 100px; height: 100px; opacity: 1; }} 100% {{ width: 200px; height: 200px; opacity: 0; }} }}
            
            /* Swish confirmation UI */
            .swish-confirm {{ text-align: center; color: white; padding: 2rem; max-width: 320px; }}
            .swish-confirm-icon {{ width: 80px; height: 80px; background: #7c3aed; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin: 0 auto 1.5rem; border: 3px solid rgba(255,255,255,0.3); }}
            .swish-confirm h2 {{ margin-bottom: 0.75rem; font-size: 1.375rem; }}
            .swish-confirm-hint {{ opacity: 0.85; font-size: 0.875rem; margin-bottom: 2rem; line-height: 1.5; }}
            .confirm-btn {{ width: 100%; padding: 1rem; background: #16a34a; color: white; border: none; border-radius: 12px; font-size: 1.125rem; font-weight: 600; cursor: pointer; margin-bottom: 0.75rem; }}
            .confirm-btn:hover {{ background: #15803d; }}
            .cancel-btn {{ width: 100%; padding: 0.875rem; background: transparent; color: rgba(255,255,255,0.8); border: 1px solid rgba(255,255,255,0.3); border-radius: 12px; font-size: 1rem; cursor: pointer; }}
            .cancel-btn:hover {{ background: rgba(255,255,255,0.1); }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="header">
                <h1>🛒 ICA Mobile Checkout</h1>
                <p>Complete your purchase</p>
            </div>
            <div class="cart-header">
                <h2>Your Cart</h2>
                <span class="terminal-badge">{terminal_code}</span>
            </div>
            <div class="cart-items">
                {items_html}
            </div>
            <div class="total-row">
                <span class="total-label">Total</span>
                <span class="total-amount">{total:.2f} SEK</span>
            </div>
            {action_html}
        </div>
        <div class="swish-modal">
            <div class="swish-animation">
                <div class="swish-spinner"></div>
                <h2>Processing Swish Payment...</h2>
                <p>Please wait</p>
            </div>
        </div>
    </body>
    </html>
    """


def _verification_html(data: dict) -> str:
    """Generate verification page with QR code"""
    qr_data = json.dumps(data)

    # URL encode the QR data for the API
    import urllib.parse

    qr_data_encoded = urllib.parse.quote(qr_data)

    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Verification - ICA</title>
        <style>
            * {{ margin: 0; padding: 0; box-sizing: border-box; }}
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }}
            .card {{ background: white; border-radius: 16px; padding: 2rem; max-width: 400px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.1); text-align: center; }}
            h1 {{ color: #16a34a; margin-bottom: 0.5rem; font-size: 1.5rem; }}
            .subtitle {{ color: #64748b; margin-bottom: 1.5rem; }}
            .qr-container {{ background: white; padding: 1rem; border-radius: 12px; border: 2px solid #e2e8f0; display: inline-block; margin-bottom: 1.5rem; }}
            .qr-container img {{ display: block; width: 200px; height: 200px; }}
            .instruction {{ font-size: 0.875rem; color: #475569; margin-bottom: 1rem; }}
            .status {{ display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem; border-radius: 8px; font-weight: 500; }}
            .status.pending {{ background: #fef3c7; color: #92400e; }}
            .status.verified {{ background: #dcfce7; color: #16a34a; }}
            .status-icon {{ font-size: 1.25rem; }}
            .details {{ margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #e2e8f0; text-align: left; }}
            .detail-row {{ display: flex; justify-content: space-between; padding: 0.5rem 0; font-size: 0.875rem; }}
            .detail-label {{ color: #64748b; }}
            .detail-value {{ color: #0f172a; font-weight: 500; }}
            .amount {{ font-size: 1.25rem; color: #ea580c; }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1>✓ Payment Complete</h1>
            <p class="subtitle">Show this to the checkout terminal</p>
            
            <div class="qr-container">
                <img id="qrcode" src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={qr_data_encoded}" alt="Verification QR Code" />
            </div>
            
            <p class="instruction">Terminal will scan this QR code to verify your payment</p>
            
            <div class="status pending">
                <span class="status-icon">⏳</span>
                <span>Waiting for terminal verification</span>
            </div>
            
            <div class="details">
                <div class="detail-row">
                    <span class="detail-label">Transaction ID</span>
                    <span class="detail-value">#{data.get("tx_id")}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Terminal</span>
                    <span class="detail-value">{data.get("terminal_code")}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Amount</span>
                    <span class="detail-value amount">{data.get("total_amount", 0):.2f} SEK</span>
                </div>
            </div>
        </div>
    </body>
    </html>
    """
