from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import (
    create_edge_transaction,
    init_databases,
    list_central_transactions,
    list_edge_transactions,
    push_unsynced_transactions,
)
from .models import CheckoutRequest, SyncPushRequest, SyncPushResponse


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_databases()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/edge/transactions")
async def create_transaction(payload: CheckoutRequest) -> dict:
    transaction_id = await create_edge_transaction(payload=payload, store_id=settings.default_store_id)
    return {
        "message": "Transaction recorded on edge",
        "edge_transaction_id": transaction_id,
    }


@app.get("/edge/transactions")
async def get_edge_transactions(
    synced: bool | None = Query(default=None, description="Filter by sync state"),
) -> list[dict]:
    return await list_edge_transactions(synced=synced)


@app.post("/edge/sync/push", response_model=SyncPushResponse)
async def push_sync(payload: SyncPushRequest) -> SyncPushResponse:
    if not payload.online:
        raise HTTPException(status_code=503, detail="Store is offline: sync postponed")

    pushed, skipped = await push_unsynced_transactions(online=payload.online)
    return SyncPushResponse(pushed=pushed, skipped=skipped, online=payload.online)


@app.get("/central/transactions")
async def get_central_transactions() -> list[dict]:
    return await list_central_transactions()
