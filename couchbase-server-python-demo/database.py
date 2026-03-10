from couchbase.cluster import Cluster, ClusterOptions
from couchbase.auth import PasswordAuthenticator
from couchbase.options import ClusterOptions as CBOptions
from config import settings
import logging

logger = logging.getLogger(__name__)


class CouchbaseConnection:
    _instance = None
    _cluster = None
    _bucket = None
    _collection = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def connect(self):
        if self._cluster is None:
            try:
                auth = PasswordAuthenticator(
                    settings.couchbase_username, settings.couchbase_password
                )
                options = ClusterOptions(auth)
                self._cluster = Cluster(settings.couchbase_connection_string, options)
                self._bucket = self._cluster.bucket(settings.couchbase_bucket)
                self._collection = self._bucket.default_collection()
                logger.info("Connected to Couchbase successfully")
            except Exception as e:
                logger.error(f"Failed to connect to Couchbase: {e}")
                raise
        return self._cluster

    def get_collection(self):
        if self._collection is None:
            self.connect()
        return self._collection

    def get_cluster(self):
        if self._cluster is None:
            self.connect()
        return self._cluster

    def close(self):
        if self._cluster:
            self._cluster.close()
            self._cluster = None
            self._bucket = None
            self._collection = None


db = CouchbaseConnection()
