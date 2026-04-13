from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_client_ip, require_admin
from ..models import AppSetting, AuditLog, User
from ..schemas import AuditLogOut
from ..services.audit import log_action

router = APIRouter(prefix='/admin', tags=['admin'])

SESSION_TIMEOUT_KEY = 'session_timeout_minutes'


class SessionPolicyUpdate(BaseModel):
    session_timeout_minutes: int = Field(ge=1, le=1440)


def _get_session_timeout_minutes(db: Session) -> int:
    row = db.query(AppSetting).filter(AppSetting.key == SESSION_TIMEOUT_KEY).first()
    if not row:
        return int(settings.access_token_expire_minutes)
    try:
        value = int(row.value)
    except Exception:
        return int(settings.access_token_expire_minutes)
    return value if value > 0 else int(settings.access_token_expire_minutes)


@router.get('/audit-logs', response_model=list[AuditLogOut])
def audit_logs(
    entity: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    username: str | None = Query(default=None),
    serial_number: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    q = db.query(AuditLog)
    if entity:
        q = q.filter(AuditLog.entity == entity)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id.strip())
    if username:
        q = q.filter(AuditLog.username == username)
    if serial_number:
        serial = serial_number.strip()
        if serial:
            like = f'%{serial}%'
            q = q.filter(
                or_(
                    AuditLog.entity_id == serial,
                    AuditLog.old_value.like(like),
                    AuditLog.new_value.like(like),
                )
            )
    return q.order_by(AuditLog.created_at.desc()).limit(limit).all()


@router.get('/session-policy')
def get_session_policy(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return {'session_timeout_minutes': _get_session_timeout_minutes(db)}


@router.put('/session-policy')
def update_session_policy(
    payload: SessionPolicyUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    minutes = int(payload.session_timeout_minutes)
    if minutes < 1 or minutes > 1440:
        raise HTTPException(status_code=400, detail='session_timeout_minutes must be between 1 and 1440')

    row = db.query(AppSetting).filter(AppSetting.key == SESSION_TIMEOUT_KEY).first()
    old_minutes = _get_session_timeout_minutes(db)
    if not row:
        row = AppSetting(key=SESSION_TIMEOUT_KEY, value=str(minutes))
        db.add(row)
    else:
        row.value = str(minutes)
    db.commit()

    log_action(
        db,
        entity='app_setting',
        entity_id=SESSION_TIMEOUT_KEY,
        action='session_timeout_update',
        old_value={'session_timeout_minutes': old_minutes},
        new_value={'session_timeout_minutes': minutes},
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    return {'session_timeout_minutes': minutes}
