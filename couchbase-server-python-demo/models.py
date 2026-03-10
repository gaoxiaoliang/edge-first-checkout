from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from decimal import Decimal


class TransactionCreate(BaseModel):
    transaction_id: str = Field(..., description="Unique transaction ID")
    total_amount: float = Field(..., gt=0, description="Total amount must be positive")
    items: Optional[list] = Field(default_factory=list, description="List of items")
    customer_name: Optional[str] = Field(None, description="Customer name")
    created_at: Optional[datetime] = Field(
        default_factory=datetime.utcnow, description="Creation timestamp"
    )


class TransactionUpdate(BaseModel):
    total_amount: float = Field(..., gt=0, description="Total amount must be positive")


class TransactionResponse(BaseModel):
    transaction_id: str
    total_amount: float
    items: Optional[list] = []
    customer_name: Optional[str] = None
    created_at: Optional[datetime] = None
    type: str = "transaction"


class TransactionListResponse(BaseModel):
    transactions: list[TransactionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
