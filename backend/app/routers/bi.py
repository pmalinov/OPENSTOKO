from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin, require_operator_or_admin
from ..models import User
from ..services.bi import abc_analysis, time_machine, velocity_analysis, warranty_check
from ..services.business_summary import get_business_summary

router = APIRouter(prefix='/bi', tags=['bi'])


@router.get('/time-machine')
def bi_time_machine(
    month: int = Query(default=datetime.utcnow().month, ge=1, le=12),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    return time_machine(db, month)


@router.get('/velocity')
def bi_velocity(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return velocity_analysis(db)


@router.get('/abc')
def bi_abc(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return abc_analysis(db)


@router.get('/warranty/{serial_number}')
def bi_warranty(serial_number: str, db: Session = Depends(get_db), user: User = Depends(require_operator_or_admin)):
    data = warranty_check(db, serial_number)
    if not data:
        raise HTTPException(status_code=404, detail='Serial not sold yet')
    return data

@router.get('/business-summary')
def business_summary(
    period: str = Query(default='current_month'),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    try:
        return get_business_summary(db, period=period, start_date=start_date, end_date=end_date)
    except HTTPException:
        raise
