from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..auth import get_password_hash
from ..database import get_db
from ..deps import get_client_ip, require_admin
from ..models import User
from ..schemas import UserCreate, UserOut, UserPasswordUpdate
from ..services.audit import log_action

router = APIRouter(prefix='/users', tags=['users'])


@router.post('', response_model=UserOut)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = User(
        username=payload.username,
        full_name=payload.full_name,
        role=payload.role,
        hashed_password=get_password_hash(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    log_action(
        db,
        entity='user',
        entity_id=str(user.id),
        action='create',
        old_value=None,
        new_value={'username': user.username, 'role': user.role.value},
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return user


@router.get('', response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return db.query(User).order_by(User.id.asc()).all()


@router.put('/{user_id}/password')
def update_password(
    user_id: int,
    payload: UserPasswordUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    user.hashed_password = get_password_hash(payload.password)
    db.commit()

    log_action(
        db,
        entity='user',
        entity_id=str(user.id),
        action='password_reset',
        old_value=None,
        new_value={'target_username': user.username, 'target_role': user.role.value},
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return {'updated': True}
