from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import (
    create_order,
    get_dashboard_overview,
    get_kiosk_stats,
    heartbeat_kiosk,
    init_databases,
    list_central_orders,
    list_edge_orders,
    sync_pending_for_kiosk,
)
from .models import (
    CatalogItem,
    CheckoutRequest,
    DashboardOverview,
    HeartbeatRequest,
    HeartbeatResponse,
    KioskStats,
    SyncRequest,
    SyncResponse,
)

CATALOG: list[CatalogItem] = [
    CatalogItem(sku="MILK-1L", name="Organic Milk 1L", price=18.5),
    CatalogItem(sku="BREAD-RYE", name="Rye Bread", price=29.9),
    CatalogItem(sku="COFFEE-500", name="Ground Coffee 500g", price=62.0),
    CatalogItem(sku="SALMON-200", name="Smoked Salmon 200g", price=79.0),
    CatalogItem(sku="APPLE-1KG", name="Apples 1kg", price=24.5),
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_databases()
    yield


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "time": datetime.now(UTC).isoformat()}


@app.get("/catalog", response_model=list[CatalogItem])
async def get_catalog() -> list[CatalogItem]:
    return CATALOG


@app.post("/edge/heartbeat", response_model=HeartbeatResponse)
async def edge_heartbeat(payload: HeartbeatRequest) -> HeartbeatResponse:
    await heartbeat_kiosk(kiosk_id=payload.kiosk_id, central_link_up=payload.central_link_up)
    return HeartbeatResponse(
        kiosk_id=payload.kiosk_id,
        edge_status="online",
        central_link_up=payload.central_link_up,
        central_reachable=payload.central_link_up,
        server_time=datetime.now(UTC),
    )


@app.post("/edge/checkout")
async def checkout(payload: CheckoutRequest) -> dict:
    order_uuid, duplicate = await create_order(payload)
    return {
        "order_uuid": order_uuid,
        "recorded_on_edge": True,
        "duplicate": duplicate,
        "message": "Checkout captured locally" if not duplicate else "Duplicate request ignored",
    }


@app.post("/edge/sync", response_model=SyncResponse)
async def run_sync(payload: SyncRequest) -> SyncResponse:
    kiosks = await get_kiosk_stats()
    selected = next((k for k in kiosks if k["kiosk_id"] == payload.kiosk_id), None)
    if not selected:
        raise HTTPException(status_code=404, detail="Kiosk not registered")
    if not selected["central_link_up"]:
        raise HTTPException(status_code=503, detail="Central link is down for this kiosk")

    pushed, duplicates, pending_after = await sync_pending_for_kiosk(payload.kiosk_id)
    return SyncResponse(
        kiosk_id=payload.kiosk_id,
        pushed=pushed,
        duplicates=duplicates,
        pending_after=pending_after,
    )


@app.get("/edge/orders")
async def edge_orders(
    kiosk_id: str | None = Query(default=None),
    pending_only: bool = Query(default=False),
) -> list[dict]:
    return await list_edge_orders(kiosk_id=kiosk_id, pending_only=pending_only)


@app.get("/central/orders")
async def central_orders() -> list[dict]:
    return await list_central_orders()


@app.get("/dashboard/overview", response_model=DashboardOverview)
async def dashboard_overview() -> DashboardOverview:
    return DashboardOverview(**(await get_dashboard_overview()))


@app.get("/dashboard/kiosks", response_model=list[KioskStats])
async def dashboard_kiosks() -> list[KioskStats]:
    rows = await get_kiosk_stats()
    return [KioskStats(**row) for row in rows]
