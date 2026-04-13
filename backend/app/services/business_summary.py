from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..models import Category, InventoryItem, MonthlyBusinessSnapshot, MovementType, Product, StockMovement


def period_bounds(
    period: str,
    start_date: str | None = None,
    end_date: str | None = None,
    *,
    reference_date: date | None = None,
) -> tuple[datetime, datetime, str, date, date]:
    today = reference_date or datetime.utcnow().date()
    first_this_month = today.replace(day=1)

    if period == 'current_month':
        start = first_this_month
        end = today
        label = 'current_month'
    elif period == 'last_month':
        last_day_prev_month = first_this_month - timedelta(days=1)
        start = last_day_prev_month.replace(day=1)
        end = last_day_prev_month
        label = 'last_month'
    elif period == 'this_year':
        start = today.replace(month=1, day=1)
        end = today
        label = 'this_year'
    elif period == 'last_12_months':
        start = today - timedelta(days=365)
        end = today
        label = 'last_12_months'
    elif period == 'custom':
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail='custom period requires start_date and end_date')
        try:
            start = date.fromisoformat(start_date)
            end = date.fromisoformat(end_date)
        except ValueError:
            raise HTTPException(status_code=400, detail='Invalid date format. Use YYYY-MM-DD')
        if end < start:
            raise HTTPException(status_code=400, detail='end_date must be >= start_date')
        label = 'custom'
    else:
        raise HTTPException(status_code=400, detail='Invalid period')

    start_dt = datetime.combine(start, time.min)
    end_exclusive = datetime.combine(end + timedelta(days=1), time.min)
    return start_dt, end_exclusive, label, start, end


def build_business_summary(
    db: Session,
    *,
    start_dt: datetime,
    end_exclusive: datetime,
    period_label: str,
    start_date: date,
    end_date: date,
) -> dict:
    movement_agg = (
        db.query(
            func.coalesce(func.sum(case((StockMovement.movement_type == MovementType.input, StockMovement.qty), else_=0)), 0).label(
                'purchased_qty'
            ),
            func.coalesce(
                func.sum(case((StockMovement.movement_type == MovementType.input, StockMovement.qty * StockMovement.unit_price), else_=0)),
                0,
            ).label('purchased_amount'),
            func.coalesce(func.sum(case((StockMovement.movement_type == MovementType.output, StockMovement.qty), else_=0)), 0).label(
                'sold_qty'
            ),
            func.coalesce(
                func.sum(case((StockMovement.movement_type == MovementType.output, StockMovement.qty * StockMovement.unit_price), else_=0)),
                0,
            ).label('sold_amount'),
        )
        .filter(StockMovement.created_at >= start_dt, StockMovement.created_at < end_exclusive)
        .one()
    )

    total_products = int(db.query(func.count(Product.id)).scalar() or 0)
    total_categories = int(db.query(func.count(Category.id)).filter(Category.is_active.is_(True)).scalar() or 0)
    inventory_units = int(db.query(func.count(InventoryItem.id)).filter(InventoryItem.in_stock.is_(True)).scalar() or 0)
    inventory_value_purchase = float(
        db.query(func.coalesce(func.sum(Product.purchase_price), 0))
        .join(InventoryItem, InventoryItem.product_id == Product.id)
        .filter(InventoryItem.in_stock.is_(True))
        .scalar()
        or 0
    )

    purchased_amount = float(movement_agg.purchased_amount or 0)
    sold_amount = float(movement_agg.sold_amount or 0)

    return {
        'period': period_label,
        'start_date': start_date.isoformat(),
        'end_date': end_date.isoformat(),
        'purchased_qty': int(movement_agg.purchased_qty or 0),
        'purchased_amount': purchased_amount,
        'sold_qty': int(movement_agg.sold_qty or 0),
        'sold_amount': sold_amount,
        'flow_balance': sold_amount - purchased_amount,
        'inventory_units': inventory_units,
        'inventory_value_purchase': inventory_value_purchase,
        'total_products': total_products,
        'total_categories': total_categories,
        'generated_at': datetime.utcnow().isoformat() + 'Z',
    }


def get_business_summary(
    db: Session,
    *,
    period: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    start_dt, end_exclusive, label, start, end = period_bounds(period, start_date, end_date)
    return build_business_summary(
        db,
        start_dt=start_dt,
        end_exclusive=end_exclusive,
        period_label=label,
        start_date=start,
        end_date=end,
    )


def previous_month_first_day(reference_date: date | None = None) -> date:
    today = reference_date or datetime.utcnow().date()
    first_this_month = today.replace(day=1)
    prev_last_day = first_this_month - timedelta(days=1)
    return prev_last_day.replace(day=1)


def month_range(month_first_day: date) -> tuple[date, date]:
    next_month = (month_first_day.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_last_day = next_month - timedelta(days=1)
    return month_first_day, month_last_day


def upsert_monthly_snapshot(
    db: Session,
    *,
    snapshot_month: date,
    overwrite: bool = False,
) -> MonthlyBusinessSnapshot:
    existing = db.query(MonthlyBusinessSnapshot).filter(MonthlyBusinessSnapshot.snapshot_month == snapshot_month).first()
    if existing and not overwrite:
        return existing

    start, end = month_range(snapshot_month)
    start_dt = datetime.combine(start, time.min)
    end_exclusive = datetime.combine(end + timedelta(days=1), time.min)
    summary = build_business_summary(
        db,
        start_dt=start_dt,
        end_exclusive=end_exclusive,
        period_label='monthly_snapshot',
        start_date=start,
        end_date=end,
    )

    row = existing or MonthlyBusinessSnapshot(snapshot_month=snapshot_month)
    row.period_label = 'monthly_snapshot'
    row.start_date = start
    row.end_date = end
    row.purchased_qty = int(summary['purchased_qty'])
    row.purchased_amount = float(summary['purchased_amount'])
    row.sold_qty = int(summary['sold_qty'])
    row.sold_amount = float(summary['sold_amount'])
    row.flow_balance = float(summary['flow_balance'])
    row.inventory_units = int(summary['inventory_units'])
    row.inventory_value_purchase = float(summary['inventory_value_purchase'])
    row.total_products = int(summary['total_products'])
    row.total_categories = int(summary['total_categories'])
    row.generated_at = datetime.utcnow()

    if not existing:
        db.add(row)

    db.commit()
    db.refresh(row)
    return row
