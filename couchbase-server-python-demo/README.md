# Couchbase Server Python Demo

A FastAPI application demonstrating how to use Couchbase Python SDK to perform CRUD operations on transaction data.

## Features

- ✅ Create new transactions with type="transaction"
- ✅ Update transaction total_amount by transaction_id
- ✅ Delete transactions by transaction_id
- ✅ Paginated list of all transactions
- ✅ Beautiful web UI for easy interaction

## Prerequisites

- Python 3.12+
- Couchbase Capella account (or Couchbase Server instance)

## Quick Start

1. **Start the application:**
   ```bash
   ./start.sh
   ```
   
   Or manually:
   ```bash
   source .venv/bin/activate
   uvicorn main:app --host 0.0.0.0 --port 8001
   ```

2. **Access the application:**
   - **Web UI**: http://localhost:8001
   - **API Documentation (Swagger)**: http://localhost:8001/docs
   - **Alternative API Documentation (ReDoc)**: http://localhost:8001/redoc
   - **Health Check**: http://localhost:8001/health

## Configuration

The `.env` file contains your Couchbase Capella credentials:
```
COUCHBASE_CONNECTION_STRING=couchbases://cb.bitqtkdzcekdir.cloud.couchbase.com
COUCHBASE_USERNAME=ica-demo
COUCHBASE_PASSWORD=GGrY9y@8@TBmcsB
COUCHBASE_BUCKET=Ica-demo
```

## API Endpoints

### POST /transactions
Create a new transaction

**Request Body:**
```json
{
  "transaction_id": "TXN001",
  "total_amount": 99.99,
  "customer_name": "John Doe",
  "items": [{"name": "Product 1", "qty": 2}]
}
```

**Example:**
```bash
curl -X POST http://localhost:8001/transactions \
  -H "Content-Type: application/json" \
  -d '{"transaction_id": "TXN001", "total_amount": 99.99, "customer_name": "John Doe"}'
```

### PUT /transactions/{transaction_id}
Update a transaction's total_amount

**Request Body:**
```json
{
  "total_amount": 149.99
}
```

**Example:**
```bash
curl -X PUT http://localhost:8001/transactions/TXN001 \
  -H "Content-Type: application/json" \
  -d '{"total_amount": 149.99}'
```

### DELETE /transactions/{transaction_id}
Delete a transaction by ID

**Example:**
```bash
curl -X DELETE http://localhost:8001/transactions/TXN001
```

### GET /transactions
List all transactions with pagination

**Query Parameters:**
- `page`: Page number (default: 1)
- `page_size`: Items per page (default: 10, max: 100)

**Example:**
```bash
curl "http://localhost:8001/transactions?page=1&page_size=10"
```

## Data Structure

Each transaction document in Couchbase has the following structure:
```json
{
  "transaction_id": "TXN001",
  "total_amount": 99.99,
  "items": [],
  "customer_name": "John Doe",
  "created_at": "2024-01-01T00:00:00",
  "type": "transaction"
}
```

## Project Structure

```
couchbase-server-python-demo/
├── .env                  # Couchbase connection configuration
├── .venv/                # Python virtual environment
├── config.py             # Pydantic settings for environment variables
├── database.py           # Couchbase connection management
├── main.py               # FastAPI application with all routes
├── models.py             # Pydantic models for request/response
├── requirements.txt      # Python dependencies
├── start.sh             # Quick start script
└── README.md            # This file
```

## Troubleshooting

### Connection Issues
- Verify your Couchbase Capella credentials in `.env`
- Ensure your IP is whitelisted in Couchbase Capella
- Check network connectivity
- Verify the bucket name matches your Couchbase bucket

### Import Errors
- Make sure all dependencies are installed: `pip install -r requirements.txt`
- Verify you're in the virtual environment: `source .venv/bin/activate`

### Port Already in Use
If port 8001 is already in use, you can change it in the start command:
```bash
uvicorn main:app --host 0.0.0.0 --port 8002
```

## Technologies Used

- **FastAPI**: Modern, fast web framework for building APIs
- **Couchbase Python SDK 4.5.0**: Official Python SDK for Couchbase
- **Pydantic**: Data validation using Python type annotations
- **Uvicorn**: ASGI server for running FastAPI

## License

MIT
