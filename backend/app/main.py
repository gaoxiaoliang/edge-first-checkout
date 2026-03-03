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
from .models import (
    DashboardStatsResponse,
    HeartbeatRequest,
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

    try:
        cur = await db.execute(
            """
            INSERT INTO transactions
            (terminal_id, idempotency_key, total_amount, item_count, payload_json, occurred_at, created_at, synced_from_offline, payment_type, payment_details_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            payment_type=existing["payment_type"],
        )

    row = await (
        await db.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,))
    ).fetchone()
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
        payment_type=row["payment_type"],
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
            payment_type=row["payment_type"],
        )
        for row in rows
    ]


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
            "SELECT id, payment_status FROM mobile_transactions WHERE terminal_id = ? AND idempotency_key = ?",
            (terminal_id, idempotency_key),
        )
    ).fetchone()

    if existing:
        tx_id = existing["id"]
        payment_status = existing["payment_status"]
    else:
        # Create new mobile transaction
        cur = await db.execute(
            """
            INSERT INTO mobile_transactions (terminal_id, idempotency_key, total_amount, items_json, payment_status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)
            """,
            (terminal_id, idempotency_key, total_amount, json.dumps(items), now_iso()),
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
        await db.execute("SELECT * FROM mobile_transactions WHERE id = ?", (tx_id,))
    ).fetchone()

    if not row:
        await db.close()
        raise HTTPException(status_code=404, detail="Transaction not found")

    if row["payment_status"] == "paid":
        await db.close()
        return {"status": "already_paid", "tx_id": tx_id}

    # Update payment status
    await db.execute(
        "UPDATE mobile_transactions SET payment_status = 'paid', paid_at = ? WHERE id = ?",
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
            """SELECT mt.*, t.terminal_code 
               FROM mobile_transactions mt 
               JOIN terminals t ON mt.terminal_id = t.id 
               WHERE mt.id = ?""",
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
        "verified": row["verified"] == 1 if row["verified"] else False,
    }

    # Sign the verification data
    verification_str = json.dumps(verification_data, sort_keys=True)
    signature = sign_with_system_key(verification_str)

    verification_data["signature"] = signature

    return HTMLResponse(content=_verification_html(verification_data))


@app.post("/verify-payment")
async def verify_payment(data: dict):
    """Verify payment QR code scanned by terminal"""
    tx_id = data.get("tx_id")
    signature = data.get("signature")

    if not tx_id or not signature:
        raise HTTPException(status_code=400, detail="Missing tx_id or signature")

    # Recreate the data that was signed (without signature)
    verify_data = {k: v for k, v in data.items() if k != "signature"}
    verify_str = json.dumps(verify_data, sort_keys=True)

    # Verify with system public key
    public_key_pem = settings.ecdsa_public_key
    if not verify_ecdsa_signature(public_key_pem, verify_str, signature):
        raise HTTPException(status_code=403, detail="Invalid signature")

    # Check payment status
    db = await get_db()
    row = await (
        await db.execute("SELECT * FROM mobile_transactions WHERE id = ?", (tx_id,))
    ).fetchone()

    if not row:
        await db.close()
        raise HTTPException(status_code=404, detail="Transaction not found")

    if row["payment_status"] != "paid":
        await db.close()
        raise HTTPException(status_code=400, detail="Payment not completed")

    # Mark as verified
    await db.execute(
        "UPDATE mobile_transactions SET verified = 1, verified_at = ? WHERE id = ?",
        (now_iso(), tx_id),
    )
    await db.commit()

    # Also create a regular transaction record for sync
    terminal_id = row["terminal_id"]
    items = json.loads(row["items_json"])
    item_count = sum(item.get("quantity", 1) for item in items)

    try:
        await db.execute(
            """
            INSERT INTO transactions
            (terminal_id, idempotency_key, total_amount, item_count, payload_json, occurred_at, created_at, synced_from_offline, payment_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'scan_pay')
            """,
            (
                terminal_id,
                row["idempotency_key"],
                row["total_amount"],
                item_count,
                row["items_json"],
                row["created_at"],
                now_iso(),
            ),
        )
        await db.commit()
    except Exception:
        # Transaction might already exist (idempotent)
        pass

    await db.close()

    return {
        "status": "verified",
        "tx_id": tx_id,
        "terminal_code": data.get("terminal_code"),
        "idempotency_key": data.get("idempotency_key"),
        "total_amount": data.get("total_amount"),
    }


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
        <button class="pay-btn" onclick="processPayment()">
            Pay with Swish 📱
        </button>
        <script>
            async function processPayment() {{
                const btn = document.querySelector('.pay-btn');
                btn.disabled = true;
                btn.textContent = 'Processing...';
                
                // Show Swish animation
                document.querySelector('.swish-modal').style.display = 'flex';
                
                // Simulate Swish payment delay
                await new Promise(r => setTimeout(r, 2000));
                
                try {{
                    const res = await fetch('/mobile-checkout/{tx_id}/pay', {{ method: 'POST' }});
                    if (res.ok) {{
                        document.querySelector('.swish-modal').innerHTML = `
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
                        alert('Payment failed. Please try again.');
                        btn.disabled = false;
                        btn.textContent = 'Pay with Swish 📱';
                        document.querySelector('.swish-modal').style.display = 'none';
                    }}
                }} catch (e) {{
                    alert('Network error. Please try again.');
                    btn.disabled = false;
                    btn.textContent = 'Pay with Swish 📱';
                    document.querySelector('.swish-modal').style.display = 'none';
                }}
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
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #ea580c 0%, #dc2626 100%); min-height: 100vh; padding: 1rem; }}
            .container {{ max-width: 500px; margin: 0 auto; }}
            .header {{ text-align: center; color: white; padding: 1.5rem 0; }}
            .header h1 {{ font-size: 1.5rem; margin-bottom: 0.25rem; }}
            .header p {{ opacity: 0.9; font-size: 0.875rem; }}
            .cart-card {{ background: white; border-radius: 16px; padding: 1.5rem; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }}
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
            .swish-modal {{ display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); align-items: center; justify-content: center; z-index: 100; }}
            .swish-animation {{ text-align: center; color: white; }}
            .swish-animation h2 {{ margin-bottom: 1rem; }}
            .swish-spinner {{ width: 80px; height: 80px; border: 4px solid rgba(255,255,255,0.3); border-top-color: #7c3aed; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }}
            @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
            .swish-success {{ text-align: center; }}
            .success-icon {{ width: 80px; height: 80px; background: #16a34a; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin: 0 auto 1rem; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🛒 ICA Mobile Checkout</h1>
                <p>Complete your purchase</p>
            </div>
            <div class="cart-card">
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
    verified = data.get("verified", False)
    qr_data = json.dumps(data)

    status_html = (
        """
        <div class="status pending">
            <span class="status-icon">⏳</span>
            <span>Waiting for terminal verification</span>
        </div>
    """
        if not verified
        else """
        <div class="status verified">
            <span class="status-icon">✓</span>
            <span>Verified by terminal</span>
        </div>
    """
    )

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
            
            {status_html}
            
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
        
        <script>
            // Poll for verification status
            setInterval(async () => {{
                try {{
                    const res = await fetch('/mobile-checkout/{data.get("tx_id")}/status');
                    const status = await res.json();
                    if (status.verified) {{
                        document.querySelector('.status').className = 'status verified';
                        document.querySelector('.status').innerHTML = '<span class="status-icon">✓</span><span>Verified by terminal</span>';
                    }}
                }} catch (e) {{}}
            }}, 3000);
        </script>
    </body>
    </html>
    """


@app.get("/mobile-checkout/{tx_id}/status")
async def get_mobile_transaction_status(tx_id: int):
    """Get the status of a mobile transaction"""
    db = await get_db()
    row = await (
        await db.execute(
            "SELECT payment_status, verified FROM mobile_transactions WHERE id = ?",
            (tx_id,),
        )
    ).fetchone()
    await db.close()

    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")

    return {
        "payment_status": row["payment_status"],
        "verified": bool(row["verified"]) if row["verified"] else False,
    }
