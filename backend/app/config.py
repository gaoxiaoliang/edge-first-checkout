from pydantic_settings import BaseSettings, SettingsConfigDict
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend


def _generate_ecdsa_keypair() -> tuple[str, str]:
    """Generate a new ECDSA P-256 (secp256r1) key pair.

    Returns:
        tuple: (private_key_pem, public_key_pem) as strings
    """
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    public_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
    )

    return private_pem, public_pem


# Generate system-level ECDSA key pair at module load time
# In production, these should be loaded from secure storage or environment variables
_SYSTEM_PRIVATE_KEY, _SYSTEM_PUBLIC_KEY = _generate_ecdsa_keypair()


class Settings(BaseSettings):
    app_name: str = "ICA Edge-First Checkout Backend"
    database_path: str = "./edge_checkout.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 480

    # ECDSA P-256 key pair (PEM format)
    # Can be overridden via environment variables or .env file
    ecdsa_private_key: str = _SYSTEM_PRIVATE_KEY
    ecdsa_public_key: str = _SYSTEM_PUBLIC_KEY

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
