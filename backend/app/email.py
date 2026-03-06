import asyncio
import logging
from email.message import EmailMessage

import aiosmtplib

from .config import settings

logger = logging.getLogger(__name__)


async def send_invoice_email(
    to_email: str,
    transaction_id: int,
    total_amount: float,
    item_count: int,
    items_json: str,
    terminal_code: str,
    occurred_at: str,
    membership_number: str | None = None,
) -> None:
    """Send an invoice email to the customer. Runs as a background task."""
    if not settings.smtp_host:
        logger.warning("SMTP not configured — skipping invoice email to %s", to_email)
        return

    import json

    items = json.loads(items_json).get("items", [])
    items_lines = "\n".join(
        f"  {it['name']} x{it['quantity']}  —  {it['price'] * it['quantity']:.2f} SEK"
        for it in items
    )

    member_line = (
        f"Membership: {membership_number}" if membership_number else "Guest purchase"
    )

    body = f"""Hej!

Here is your invoice from ICA.

Order #{transaction_id}
Date: {occurred_at}
Terminal: {terminal_code}
{member_line}

Items:
{items_lines}

Total: {total_amount:.2f} SEK

Payment method: Invoice
Please pay within 30 days.

Tack for att du handlar pa ICA!
"""

    msg = EmailMessage()
    msg["Subject"] = f"ICA Invoice #{transaction_id} — {total_amount:.2f} SEK"
    msg["From"] = settings.smtp_from_email
    msg["To"] = to_email
    msg.set_content(body)

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            start_tls=True,
        )
        logger.info("Invoice email sent to %s for transaction %d", to_email, transaction_id)
    except Exception:
        logger.exception("Failed to send invoice email to %s", to_email)
