from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from models import (
    TransactionCreate,
    TransactionUpdate,
    TransactionResponse,
    TransactionListResponse,
)
from database import db
from config import settings
from couchbase.exceptions import DocumentExistsException, DocumentNotFoundException
import logging
from typing import Optional
import math

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Couchbase Transaction Demo",
    description="A FastAPI application to manage transactions in Couchbase Capella",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    try:
        db.connect()
        logger.info("Application started successfully")
    except Exception as e:
        logger.error(f"Failed to start application: {e}")
        raise


@app.on_event("shutdown")
async def shutdown_event():
    db.close()
    logger.info("Application shutdown")


@app.get("/", response_class=HTMLResponse)
async def root():
    html_content = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Couchbase Transaction Manager</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
            }
            h1 {
                text-align: center;
                color: white;
                margin-bottom: 30px;
                font-size: 2.5em;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
            }
            .card {
                background: white;
                border-radius: 10px;
                padding: 25px;
                margin-bottom: 20px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            h2 {
                color: #667eea;
                margin-bottom: 20px;
                border-bottom: 2px solid #667eea;
                padding-bottom: 10px;
            }
            .form-group {
                margin-bottom: 15px;
            }
            label {
                display: block;
                margin-bottom: 5px;
                color: #333;
                font-weight: 600;
            }
            input, button {
                width: 100%;
                padding: 12px;
                border: 2px solid #e0e0e0;
                border-radius: 5px;
                font-size: 14px;
                transition: all 0.3s;
            }
            input:focus {
                outline: none;
                border-color: #667eea;
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }
            button {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                cursor: pointer;
                font-weight: 600;
                margin-top: 10px;
            }
            button:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
            }
            button:active {
                transform: translateY(0);
            }
            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                gap: 20px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 15px;
            }
            th, td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #e0e0e0;
            }
            th {
                background: #667eea;
                color: white;
                font-weight: 600;
            }
            tr:hover {
                background: #f5f5f5;
            }
            .message {
                padding: 15px;
                border-radius: 5px;
                margin-top: 15px;
                font-weight: 600;
            }
            .success {
                background: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
            }
            .error {
                background: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
            }
            .pagination {
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 10px;
                margin-top: 20px;
            }
            .pagination button {
                width: auto;
                padding: 8px 20px;
            }
            .pagination span {
                color: #666;
            }
            .loading {
                text-align: center;
                padding: 20px;
                color: #666;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Couchbase Transaction Manager</h1>
            
            <div class="grid">
                <!-- Create Transaction -->
                <div class="card">
                    <h2>Create Transaction</h2>
                    <form id="createForm">
                        <div class="form-group">
                            <label>Transaction ID:</label>
                            <input type="text" id="createTransactionId" placeholder="e.g., TXN001" required>
                        </div>
                        <div class="form-group">
                            <label>Total Amount:</label>
                            <input type="number" id="createAmount" step="0.01" placeholder="e.g., 99.99" required>
                        </div>
                        <div class="form-group">
                            <label>Customer Name (Optional):</label>
                            <input type="text" id="createCustomerName" placeholder="e.g., John Doe">
                        </div>
                        <div class="form-group">
                            <label>Items (JSON Array, Optional):</label>
                            <input type="text" id="createItems" placeholder='e.g., [{"name":"Apple","qty":2}]'>
                        </div>
                        <button type="submit">Create Transaction</button>
                    </form>
                    <div id="createMessage"></div>
                </div>

                <!-- Update Transaction -->
                <div class="card">
                    <h2>Update Transaction</h2>
                    <form id="updateForm">
                        <div class="form-group">
                            <label>Transaction ID:</label>
                            <input type="text" id="updateTransactionId" placeholder="e.g., TXN001" required>
                        </div>
                        <div class="form-group">
                            <label>New Total Amount:</label>
                            <input type="number" id="updateAmount" step="0.01" placeholder="e.g., 149.99" required>
                        </div>
                        <button type="submit">Update Transaction</button>
                    </form>
                    <div id="updateMessage"></div>
                </div>

                <!-- Delete Transaction -->
                <div class="card">
                    <h2>Delete Transaction</h2>
                    <form id="deleteForm">
                        <div class="form-group">
                            <label>Transaction ID:</label>
                            <input type="text" id="deleteTransactionId" placeholder="e.g., TXN001" required>
                        </div>
                        <button type="submit">Delete Transaction</button>
                    </form>
                    <div id="deleteMessage"></div>
                </div>

                <!-- List Transactions -->
                <div class="card">
                    <h2>Search Transactions</h2>
                    <form id="searchForm">
                        <div class="form-group">
                            <label>Page:</label>
                            <input type="number" id="page" value="1" min="1" required>
                        </div>
                        <div class="form-group">
                            <label>Page Size:</label>
                            <input type="number" id="pageSize" value="10" min="1" max="100" required>
                        </div>
                        <button type="submit">Search</button>
                    </form>
                    <div id="searchMessage"></div>
                </div>
            </div>

            <!-- Transaction List -->
            <div class="card">
                <h2>Transaction List</h2>
                <div id="transactionList">
                    <div class="loading">Click "Search" to load transactions...</div>
                </div>
            </div>
        </div>

        <script>
            const API_BASE = window.location.origin;

            function showMessage(elementId, message, isSuccess) {
                const element = document.getElementById(elementId);
                element.innerHTML = `<div class="message ${isSuccess ? 'success' : 'error'}">${message}</div>`;
                setTimeout(() => element.innerHTML = '', 5000);
            }

            function escapeHtml(text) {
                if (text === null || text === undefined) return '';
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            document.getElementById('createForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const transactionId = document.getElementById('createTransactionId').value;
                const amount = parseFloat(document.getElementById('createAmount').value);
                const customerName = document.getElementById('createCustomerName').value || null;
                const itemsText = document.getElementById('createItems').value;
                
                let items = [];
                if (itemsText) {
                    try {
                        items = JSON.parse(itemsText);
                    } catch (err) {
                        showMessage('createMessage', 'Invalid JSON format for items', false);
                        return;
                    }
                }

                try {
                    const response = await fetch(`${API_BASE}/transactions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            transaction_id: transactionId,
                            total_amount: amount,
                            customer_name: customerName,
                            items: items
                        })
                    });
                    const data = await response.json();
                    if (response.ok) {
                        showMessage('createMessage', 'Transaction created successfully!', true);
                        e.target.reset();
                    } else {
                        showMessage('createMessage', `Error: ${data.detail}`, false);
                    }
                } catch (error) {
                    showMessage('createMessage', `Error: ${error.message}`, false);
                }
            });

            document.getElementById('updateForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const transactionId = document.getElementById('updateTransactionId').value;
                const amount = parseFloat(document.getElementById('updateAmount').value);

                try {
                    const response = await fetch(`${API_BASE}/transactions/${transactionId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ total_amount: amount })
                    });
                    const data = await response.json();
                    if (response.ok) {
                        showMessage('updateMessage', 'Transaction updated successfully!', true);
                        e.target.reset();
                    } else {
                        showMessage('updateMessage', `Error: ${data.detail}`, false);
                    }
                } catch (error) {
                    showMessage('updateMessage', `Error: ${error.message}`, false);
                }
            });

            document.getElementById('deleteForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const transactionId = document.getElementById('deleteTransactionId').value;

                if (!confirm(`Are you sure you want to delete transaction ${transactionId}?`)) {
                    return;
                }

                try {
                    const response = await fetch(`${API_BASE}/transactions/${transactionId}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();
                    if (response.ok) {
                        showMessage('deleteMessage', 'Transaction deleted successfully!', true);
                        e.target.reset();
                    } else {
                        showMessage('deleteMessage', `Error: ${data.detail}`, false);
                    }
                } catch (error) {
                    showMessage('deleteMessage', `Error: ${error.message}`, false);
                }
            });

            document.getElementById('searchForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const page = parseInt(document.getElementById('page').value);
                const pageSize = parseInt(document.getElementById('pageSize').value);
                await loadTransactions(page, pageSize);
            });

            async function loadTransactions(page = 1, pageSize = 10) {
                const listDiv = document.getElementById('transactionList');
                listDiv.innerHTML = '<div class="loading">Loading...</div>';

                try {
                    const response = await fetch(`${API_BASE}/transactions?page=${page}&page_size=${pageSize}`);
                    const data = await response.json();
                    
                    if (data.transactions.length === 0) {
                        listDiv.innerHTML = '<div class="loading">No transactions found.</div>';
                        return;
                    }

                    let html = '<table><thead><tr><th>Transaction ID</th><th>Amount</th><th>Customer</th><th>Created At</th><th>Items</th></tr></thead><tbody>';
                    
                    data.transactions.forEach(tx => {
                        html += `<tr>
                            <td>${escapeHtml(tx.transaction_id)}</td>
                            <td>$${escapeHtml(tx.total_amount.toFixed(2))}</td>
                            <td>${escapeHtml(tx.customer_name || 'N/A')}</td>
                            <td>${escapeHtml(tx.created_at || 'N/A')}</td>
                            <td>${escapeHtml(JSON.stringify(tx.items || []))}</td>
                        </tr>`;
                    });
                    
                    html += '</tbody></table>';
                    
                    html += `<div class="pagination">
                        <button onclick="loadTransactions(${page - 1}, ${pageSize})" ${page <= 1 ? 'disabled' : ''}>Previous</button>
                        <span>Page ${data.page} of ${data.total_pages} (Total: ${data.total} records)</span>
                        <button onclick="loadTransactions(${page + 1}, ${pageSize})" ${page >= data.total_pages ? 'disabled' : ''}>Next</button>
                    </div>`;
                    
                    listDiv.innerHTML = html;
                    
                    document.getElementById('page').value = page;
                } catch (error) {
                    listDiv.innerHTML = `<div class="message error">Error loading transactions: ${error.message}</div>`;
                }
            }

            // Load initial transactions
            loadTransactions(1, 10);
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)


@app.post("/transactions", response_model=TransactionResponse, status_code=201)
async def create_transaction(transaction: TransactionCreate):
    try:
        collection = db.get_collection()

        doc = {
            "transaction_id": transaction.transaction_id,
            "total_amount": transaction.total_amount,
            "items": transaction.items or [],
            "customer_name": transaction.customer_name,
            "created_at": transaction.created_at.isoformat()
            if transaction.created_at
            else None,
            "type": "transaction",
        }

        collection.insert(transaction.transaction_id, doc)

        return TransactionResponse(
            transaction_id=transaction.transaction_id,
            total_amount=transaction.total_amount,
            items=transaction.items,
            customer_name=transaction.customer_name,
            created_at=transaction.created_at,
            type="transaction",
        )
    except DocumentExistsException:
        raise HTTPException(
            status_code=400, detail="Transaction with this ID already exists"
        )
    except Exception as e:
        logger.error(f"Error creating transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/transactions/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(transaction_id: str, update: TransactionUpdate):
    try:
        collection = db.get_collection()

        result = collection.get(transaction_id)
        doc = result.value

        if doc.get("type") != "transaction":
            raise HTTPException(status_code=400, detail="Document is not a transaction")

        doc["total_amount"] = update.total_amount

        collection.replace(transaction_id, doc)

        return TransactionResponse(
            transaction_id=doc["transaction_id"],
            total_amount=doc["total_amount"],
            items=doc.get("items", []),
            customer_name=doc.get("customer_name"),
            created_at=doc.get("created_at"),
            type=doc["type"],
        )
    except DocumentNotFoundException:
        raise HTTPException(status_code=404, detail="Transaction not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/transactions/{transaction_id}")
async def delete_transaction(transaction_id: str):
    try:
        collection = db.get_collection()

        result = collection.get(transaction_id)
        doc = result.value

        if doc.get("type") != "transaction":
            raise HTTPException(status_code=400, detail="Document is not a transaction")

        collection.remove(transaction_id)

        return {
            "message": "Transaction deleted successfully",
            "transaction_id": transaction_id,
        }
    except DocumentNotFoundException:
        raise HTTPException(status_code=404, detail="Transaction not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/transactions", response_model=TransactionListResponse)
async def list_transactions(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Page size"),
):
    try:
        cluster = db.get_cluster()

        offset = (page - 1) * page_size

        bucket_name = settings.couchbase_bucket
        count_query = (
            f"SELECT COUNT(*) as count FROM `{bucket_name}` WHERE type = 'transaction'"
        )
        count_result = cluster.query(count_query).execute()
        total = count_result[0]["count"]

        query = f"SELECT META().id, * FROM `{bucket_name}` WHERE type = 'transaction' ORDER BY created_at DESC LIMIT $limit OFFSET $offset"
        result = cluster.query(query, limit=page_size, offset=offset).execute()

        transactions = []
        for row in result:
            tx_data = row.get(bucket_name, row)
            transactions.append(
                TransactionResponse(
                    transaction_id=str(
                        tx_data.get("transaction_id", row.get("id", ""))
                    ),
                    total_amount=float(tx_data.get("total_amount", 0)),
                    items=tx_data.get("items", []),
                    customer_name=tx_data.get("customer_name"),
                    created_at=tx_data.get("created_at"),
                    type=tx_data.get("type", "transaction"),
                )
            )

        total_pages = math.ceil(total / page_size)

        return TransactionListResponse(
            transactions=transactions,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )
    except Exception as e:
        logger.error(f"Error listing transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    try:
        db.get_collection()
        return {"status": "healthy", "couchbase": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
