import uuid
from datetime import UTC, datetime

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_access_token, has_permission
from app.models import User

bearer = HTTPBearer(auto_error=False)


async def _user_from_token(token: str, db: AsyncSession) -> User:
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Session expired.", code="token_expired")
    except jwt.PyJWTError:
        raise Unauthorized("Invalid credentials.")
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise Unauthorized("Account not found or disabled.")
    return user


async def optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: AsyncSession = Depends(get_db)
) -> User | None:
    if creds is None:
        return None
    return await _user_from_token(creds.credentials, db)


async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: AsyncSession = Depends(get_db)
) -> User:
    if creds is None:
        raise Unauthorized("Sign in to continue.")
    user = await _user_from_token(creds.credentials, db)
    now = datetime.now(UTC)
    if user.last_seen_at is None or (now - user.last_seen_at).total_seconds() > 300:
        user.last_seen_at = now
        await db.commit()
    return user


def require(permission: str):
    async def _dep(user: User = Depends(current_user)) -> User:
        if not has_permission(user.role, permission):
            raise Forbidden("You do not have permission to do that.", details={"permission": permission})
        return user

    return _dep


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")
