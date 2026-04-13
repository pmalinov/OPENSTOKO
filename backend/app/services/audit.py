import json
from sqlalchemy.orm import Session

from ..models import AuditLog


def log_action(
    db: Session,
    *,
    entity: str,
    entity_id: str,
    action: str,
    old_value: dict | None,
    new_value: dict | None,
    username: str,
    ip_address: str,
) -> None:
    row = AuditLog(
        entity=entity,
        entity_id=str(entity_id),
        action=action,
        old_value=json.dumps(old_value or {}, default=str),
        new_value=json.dumps(new_value or {}, default=str),
        username=username,
        ip_address=ip_address,
    )
    db.add(row)
