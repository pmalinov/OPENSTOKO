from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .auth import decode_token
from .database import get_db
from .models import Role, User

security = HTTPBearer()


def get_client_ip(request: Request) -> str:
    if request.client:
        return request.client.host
    return 'unknown'


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    username = decode_token(creds.credentials)
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token')
    user = db.query(User).filter(User.username == username, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found')
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Admin only')
    return user


def require_operator_or_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in (Role.admin, Role.operator):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Operator or Admin only')
    return user
