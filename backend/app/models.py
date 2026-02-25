from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CatalogItem(BaseModel):
    sku: str
    name: str
    price: float


class CartLine(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    quantity: int = Field(gt=0, le=200)
    unit_price: float = Field(gt=0)


class CheckoutRequest(BaseModel):
    kiosk_id: str = Field(min_length=1, max_length=64)
    idempotency_key: str = Field(min_length=8, max_length=128)
    payment_method: Literal["card", "mobile", "cash"] = "card"
    currency: str = Field(default="SEK", min_length=3, max_length=3)
    lines: list[CartLine] = Field(min_length=1)


class HeartbeatRequest(BaseModel):
    kiosk_id: str = Field(min_length=1, max_length=64)
    central_link_up: bool


class HeartbeatResponse(BaseModel):
    kiosk_id: str
    edge_status: Literal["online"]
    central_link_up: bool
    central_reachable: bool
    server_time: datetime


class SyncRequest(BaseModel):
    kiosk_id: str = Field(min_length=1, max_length=64)


class SyncResponse(BaseModel):
    kiosk_id: str
    pushed: int
    duplicates: int
    pending_after: int


class DashboardOverview(BaseModel):
    total_kiosks: int
    online_kiosks: int
    offline_kiosks: int
    pending_sync_orders: int
    central_orders: int
    central_revenue: float


class KioskStats(BaseModel):
    kiosk_id: str
    status: Literal["online", "offline"]
    central_link_up: bool
    last_heartbeat_at: datetime | None
    edge_order_count: int
    edge_order_amount: float
    central_order_count: int
    central_order_amount: float
    pending_sync: int
