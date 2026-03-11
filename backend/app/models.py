from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# Payment type definitions
PaymentType = Literal[
    "cash", "credit_card", "swish", "apple_pay", "google_pay", "scan_pay", "invoice"
]


class CreditCardDetails(BaseModel):
    """Details for credit card payments"""

    card_number: str | None = None  # Masked card number (e.g., "****-****-****-1234")
    card_type: str | None = None  # Visa, Mastercard, etc.
    expiry_month: int | None = None
    expiry_year: int | None = None


class SwishDetails(BaseModel):
    """Details for Swish payments"""

    phone_number: str | None = None  # Swedish phone number
    transaction_id: str | None = None


class MobilePayDetails(BaseModel):
    """Details for Apple Pay / Google Pay payments"""

    device_id: str | None = None
    transaction_token: str | None = None


class InvoiceDetails(BaseModel):
    """Details for invoice payments (offline fallback)"""

    customer_email: str | None = None
    membership_number: str | None = None
    is_member: bool = False


class PaymentDetails(BaseModel):
    """Payment information for a transaction"""

    payment_type: PaymentType
    credit_card: CreditCardDetails | None = None
    swish: SwishDetails | None = None
    mobile_pay: MobilePayDetails | None = None
    invoice: InvoiceDetails | None = None
    cash_tendered: float | None = None  # For cash payments
    cash_change: float | None = None  # Change given back


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    terminal_code: str
    password: str


class TerminalCreateRequest(BaseModel):
    terminal_code: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6)
    store_name: str = Field(min_length=1)


class TerminalResponse(BaseModel):
    id: int
    terminal_code: str
    store_name: str
    active: bool
    created_at: datetime
    last_seen_at: datetime | None = None
    status: Literal["online", "offline"]
    ecdsa_public_key: str | None = None


class TerminalCreateResponse(BaseModel):
    """Response for terminal creation - includes private key (only shown once)"""

    id: int
    terminal_code: str
    store_name: str
    active: bool
    created_at: datetime
    last_seen_at: datetime | None = None
    status: Literal["online", "offline"]
    ecdsa_private_key: str  # Only returned on creation
    ecdsa_public_key: str


class HeartbeatRequest(BaseModel):
    current_load: int = Field(default=0, ge=0)


class TransactionItem(BaseModel):
    product_id: str
    name: str
    price: float
    quantity: int = Field(gt=0)


class TransactionCreateRequest(BaseModel):
    idempotency_key: str
    total_amount: float = Field(ge=0)
    items: list[TransactionItem]
    occurred_at: datetime
    offline_created: bool = False
    payment: PaymentDetails | None = None  # Payment information


class SyncBatchRequest(BaseModel):
    transactions: list[TransactionCreateRequest]


class TransactionResponse(BaseModel):
    id: int
    terminal_id: int
    idempotency_key: str
    total_amount: float
    item_count: int
    occurred_at: datetime
    created_at: datetime
    synced_from_offline: bool
    payment_type: PaymentType | None = None
    customer_email: str | None = None
    membership_number: str | None = None
    is_invoice: bool = False


class DashboardStatsResponse(BaseModel):
    total_sales: float
    total_transactions: int
    offline_synced_transactions: int
    online_terminals: int
    offline_terminals: int


class SyncStatusResponse(BaseModel):
    terminal_code: str
    pending_sync_count: int
    last_synced_at: datetime | None


class AdminSettingsResponse(BaseModel):
    allow_cash: bool
    allow_credit_card: bool
    allow_swish: bool
    allow_apple_pay: bool
    allow_google_pay: bool
    allow_scan_pay: bool
    allow_invoice: bool
    allow_invoice_members: bool
    allow_invoice_non_members: bool
    non_member_invoice_threshold: int
    max_invoice_amount: int
    max_invoices_per_person: int
    offline_card_limit: int


class AdminSettingsUpdateRequest(BaseModel):
    allow_cash: bool | None = None
    allow_credit_card: bool | None = None
    allow_swish: bool | None = None
    allow_apple_pay: bool | None = None
    allow_google_pay: bool | None = None
    allow_scan_pay: bool | None = None
    allow_invoice: bool | None = None
    allow_invoice_members: bool | None = None
    allow_invoice_non_members: bool | None = None
    non_member_invoice_threshold: int | None = None
    max_invoice_amount: int | None = None
    max_invoices_per_person: int | None = None
    offline_card_limit: int | None = None


class InvoiceStatsResponse(BaseModel):
    total_invoices: int
    total_invoice_amount: float
    member_invoices: int
    member_invoice_amount: float
    non_member_invoices: int
    non_member_invoice_amount: float
    non_member_invoice_threshold: int
    auto_disabled: bool


class InventoryItemResponse(BaseModel):
    product_id: str
    name: str
    price: float
    stock_qty: int
    reorder_threshold: int
    reorder_qty: int
    low_stock: bool


class InventoryUpdateRequest(BaseModel):
    stock_qty: int | None = None
    reorder_threshold: int | None = None
    reorder_qty: int | None = None


class ReplenishmentProposalResponse(BaseModel):
    id: int
    product_id: str
    proposed_qty: int
    current_stock: int
    threshold: int
    status: str
    created_at: str
    resolved_at: str | None = None


class ReplenishmentUpdateRequest(BaseModel):
    status: Literal["ordered", "fulfilled", "dismissed"]


class LowStockReportItem(BaseModel):
    product_id: str
    name: str
    stock_qty: int
    reorder_threshold: int
    suggested_order_qty: int


class LowStockReportResponse(BaseModel):
    items: list[LowStockReportItem]
