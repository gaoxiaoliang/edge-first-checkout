from datetime import datetime

from pydantic import BaseModel, Field


class CheckoutItem(BaseModel):
    sku: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=200)
    quantity: int = Field(gt=0)
    unit_price: float = Field(gt=0)


class CheckoutRequest(BaseModel):
    cashier_id: str = Field(min_length=1, max_length=64)
    customer_reference: str | None = Field(default=None, max_length=128)
    items: list[CheckoutItem] = Field(min_length=1)
    currency: str = Field(default="SEK", min_length=3, max_length=3)


class EdgeTransaction(BaseModel):
    id: int
    store_id: str
    cashier_id: str
    customer_reference: str | None
    amount_total: float
    currency: str
    payload_json: str
    created_at: datetime
    synced_at: datetime | None


class SyncPushRequest(BaseModel):
    online: bool = True


class SyncPushResponse(BaseModel):
    pushed: int
    skipped: int
    online: bool


class CentralTransaction(BaseModel):
    id: int
    edge_transaction_id: int
    store_id: str
    cashier_id: str
    amount_total: float
    currency: str
    received_at: datetime
