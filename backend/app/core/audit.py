import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


def audit(
    db: AsyncSession,
    action: str,
    *,
    actor_id: uuid.UUID | None,
    target_type: str | None = None,
    target_id: str | None = None,
    ip: str | None = None,
    **data,
) -> None:
    """Adds an audit row to the current transaction (committed with the change it records)."""
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            ip=ip,
            data={k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in data.items()},
        )
    )
