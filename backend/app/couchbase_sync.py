import logging
from datetime import timedelta

from couchbase.auth import PasswordAuthenticator
from couchbase.cluster import Cluster
from couchbase.options import ClusterOptions

from .config import settings

logger = logging.getLogger(__name__)

_cluster = None
_bucket = None
_collection = None


def init_couchbase():
    """Connect to Couchbase Cloud. Call once at startup."""
    global _cluster, _bucket, _collection

    if not settings.couchbase_connection_string:
        logger.warning("Couchbase not configured — sync disabled")
        return

    try:
        auth = PasswordAuthenticator(
            settings.couchbase_username,
            settings.couchbase_password,
        )
        _cluster = Cluster(
            settings.couchbase_connection_string,
            ClusterOptions(auth),
        )
        _cluster.wait_until_ready(timedelta(seconds=10))
        _bucket = _cluster.bucket(settings.couchbase_bucket)
        _collection = _bucket.default_collection()
        logger.info("Connected to Couchbase bucket '%s'", settings.couchbase_bucket)
    except Exception:
        logger.exception("Failed to connect to Couchbase — sync disabled")
        _collection = None


def sync_transaction(transaction_id: int, terminal_code: str, doc: dict) -> None:
    """Write a transaction document to Couchbase. Non-blocking best-effort."""
    if _collection is None:
        return

    key = f"txn::{terminal_code}::{transaction_id}"
    try:
        _collection.upsert(key, doc)
        logger.info("Synced transaction %s to Couchbase", key)
    except Exception:
        logger.exception("Failed to sync transaction %s to Couchbase", key)


def sync_terminal(terminal_id: int, terminal_code: str, doc: dict) -> None:
    """Write a terminal document to Couchbase. Non-blocking best-effort."""
    if _collection is None:
        return

    key = f"terminal::{terminal_code}"
    try:
        _collection.upsert(key, doc)
        logger.info("Synced terminal %s to Couchbase", key)
    except Exception:
        logger.exception("Failed to sync terminal %s to Couchbase", key)


def sync_heartbeat(terminal_code: str, last_seen_at: str, pending_sync_count: int) -> None:
    """Update terminal heartbeat in Couchbase."""
    if _collection is None:
        return

    key = f"terminal::{terminal_code}"
    try:
        _collection.upsert(key, {
            "type": "terminal_heartbeat",
            "terminal_code": terminal_code,
            "last_seen_at": last_seen_at,
            "pending_sync_count": pending_sync_count,
            "status": "online",
        })
    except Exception:
        logger.exception("Failed to sync heartbeat for %s to Couchbase", terminal_code)


def is_connected() -> bool:
    return _collection is not None
