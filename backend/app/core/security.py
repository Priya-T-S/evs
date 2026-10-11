import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import settings

ALGORITHM = "HS256"

ROLES = ("citizen", "moderator", "analyst", "officer", "admin")
STAFF_ROLES = frozenset({"moderator", "analyst", "officer", "admin"})

# Coarse permission map. Endpoints depend on permissions, never on role names directly.
PERMISSIONS: dict[str, frozenset[str]] = {
    "incident.view_exact": STAFF_ROLES,
    "incident.moderate": frozenset({"moderator", "officer", "admin"}),
    "incident.assign": frozenset({"officer", "admin"}),
    "incident.resolve": frozenset({"officer", "admin"}),
    "analytics.view": STAFF_ROLES,
    "recommendation.manage": frozenset({"analyst", "officer", "admin"}),
    "users.manage": frozenset({"admin"}),
    "audit.view": frozenset({"admin"}),
    "jobs.run": frozenset({"analyst", "admin"}),
}


def has_permission(role: str, permission: str) -> bool:
    return role in PERMISSIONS.get(permission, frozenset())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: uuid.UUID, role: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def new_refresh_token() -> tuple[str, str]:
    """Returns (raw token for the client, sha256 hash for storage)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
