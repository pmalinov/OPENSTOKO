from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..auth import create_access_token, verify_password
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import AppSetting, User
from ..schemas import LoginRequest, TokenResponse, UserOut
from ..services.audit import log_action

router = APIRouter(prefix='/auth', tags=['auth'])

SESSION_TIMEOUT_KEY = 'session_timeout_minutes'


def _get_session_timeout_minutes(db: Session) -> int:
    row = db.query(AppSetting).filter(AppSetting.key == SESSION_TIMEOUT_KEY).first()
    if not row:
        return int(settings.access_token_expire_minutes)
    try:
        value = int(row.value)
    except Exception:
        return int(settings.access_token_expire_minutes)
    return value if value > 0 else int(settings.access_token_expire_minutes)


@router.post('/login', response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username, User.is_active.is_(True)).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        log_action(
            db,
            entity='auth',
            entity_id=payload.username,
            action='unauthorized_login',
            old_value=None,
            new_value={'reason': 'bad_credentials'},
            username=payload.username,
            ip_address=request.client.host if request.client else 'unknown',
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')

    token = create_access_token(user.username)
    log_action(
        db,
        entity='auth',
        entity_id=str(user.id),
        action='login',
        old_value=None,
        new_value={'status': 'success'},
        username=user.username,
        ip_address=request.client.host if request.client else 'unknown',
    )
    db.commit()
    return TokenResponse(access_token=token)


@router.get('/me', response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.get('/session-policy')
def session_policy(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {'session_timeout_minutes': _get_session_timeout_minutes(db)}
