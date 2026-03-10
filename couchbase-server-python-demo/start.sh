#!/bin/bash

echo "Starting Couchbase Transaction Demo..."
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "Virtual environment not found. Creating one..."
    python3.12 -m venv .venv
fi

echo "Activating virtual environment..."
source .venv/bin/activate

echo "Installing dependencies..."
pip install -q -r requirements.txt

echo "Starting FastAPI server on http://localhost:8001..."
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
