from pydantic_settings import BaseSettings, SettingsConfigDict


# Fixed system-level ECDSA P-256 key pair for development
# In production, these should be loaded from secure storage or environment variables
_DEFAULT_SYSTEM_PRIVATE_KEY = """-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgZ+8dWjRtrGWwvyJi
/AuRgxJ271l4FzIvuoctqi74WRWhRANCAARx6R5AqquPGF+ixN1sV9fGEVpH2wfO
91l1wY8JT4B9A/YONCwFTVMsadxCdkTpIjI1Co6ujL+dwBsa/zIfLIjs
-----END PRIVATE KEY-----"""

_DEFAULT_SYSTEM_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEcekeQKqrjxhfosTdbFfXxhFaR9sH
zvdZdcGPCU+AfQP2DjQsBU1TLGncQnZE6SIyNQqOroy/ncAbGv8yHyyI7A==
-----END PUBLIC KEY-----"""


class Settings(BaseSettings):
    app_name: str = "ICA Edge-First Checkout Backend"
    database_path: str = "./edge_checkout.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 480

    # ECDSA P-256 key pair (PEM format)
    # Can be overridden via environment variables or .env file
    ecdsa_private_key: str = _DEFAULT_SYSTEM_PRIVATE_KEY
    ecdsa_public_key: str = _DEFAULT_SYSTEM_PUBLIC_KEY

    # SMTP for invoice emails
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""

    # Couchbase Cloud
    couchbase_connection_string: str = ""
    couchbase_username: str = ""
    couchbase_password: str = ""
    couchbase_bucket: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
