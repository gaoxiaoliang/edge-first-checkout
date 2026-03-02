import hashlib
from datetime import UTC, datetime, timedelta

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from .config import settings


def get_ecdsa_private_key() -> ec.EllipticCurvePrivateKey:
    """Get the system ECDSA private key object.

    Returns:
        EllipticCurvePrivateKey: The private key object for signing operations.
    """
    return serialization.load_pem_private_key(
        settings.ecdsa_private_key.encode("utf-8"),
        password=None,
        backend=default_backend(),
    )


def get_ecdsa_public_key() -> ec.EllipticCurvePublicKey:
    """Get the system ECDSA public key object.

    Returns:
        EllipticCurvePublicKey: The public key object for verification operations.
    """
    return serialization.load_pem_public_key(
        settings.ecdsa_public_key.encode("utf-8"), backend=default_backend()
    )


def get_ecdsa_public_key_pem() -> str:
    """Get the system ECDSA public key in PEM format.

    Returns:
        str: The public key in PEM format (for sharing with clients).
    """
    return settings.ecdsa_public_key


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(raw_password: str) -> str:
    return hashlib.sha256(raw_password.encode("utf-8")).hexdigest()


def verify_password(raw_password: str, hashed_password: str) -> bool:
    return hash_password(raw_password) == hashed_password


def create_access_token(subject: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_exp_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


async def get_current_terminal_code(token: str = Depends(oauth2_scheme)) -> str:
    payload = decode_access_token(token)
    terminal_code = payload.get("sub")
    if not terminal_code:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        )
    return terminal_code
