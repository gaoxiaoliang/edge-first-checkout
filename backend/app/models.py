from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


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
