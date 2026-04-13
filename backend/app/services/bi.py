from collections import defaultdict
from datetime import datetime

from sqlalchemy import extract
from sqlalchemy.orm import Session

from ..models import MovementType, Product, StockMovement


def time_machine(db: Session, month: int):
    rows = (
        db.query(
            extract('year', StockMovement.created_at).label('year'),
            StockMovement.product_id,
            Product.name,
            StockMovement.qty,
        )
        .join(Product, Product.id == StockMovement.product_id)
        .filter(StockMovement.movement_type == MovementType.output)
        .filter(extract('month', StockMovement.created_at) == month)
        .all()
    )
    yearly = defaultdict(int)
    for row in rows:
        yearly[int(row.year)] += int(row.qty)
    return [{'year': y, 'output_qty': q} for y, q in sorted(yearly.items())]


def velocity_analysis(db: Session):
    now = datetime.utcnow()
    start_month = datetime(now.year, now.month, 1)

    sales = (
        db.query(StockMovement.product_id, StockMovement.qty)
        .filter(StockMovement.movement_type == MovementType.output)
        .filter(StockMovement.created_at >= start_month)
        .all()
    )

    sold_map = defaultdict(int)
    for s in sales:
        sold_map[s.product_id] += int(s.qty)

    inventory = db.query(Product.id, Product.name).all()
    result = []
    days_so_far = max((now - start_month).days, 1)
    for p in inventory:
        sold = sold_map[p.id]
        daily_rate = sold / days_so_far if sold else 0
        if daily_rate == 0:
            days_left = None
        else:
            in_stock = (
                db.query(StockMovement)
                .filter(StockMovement.product_id == p.id)
                .filter(StockMovement.movement_type == MovementType.input)
                .count()
                - db.query(StockMovement)
                .filter(StockMovement.product_id == p.id)
                .filter(StockMovement.movement_type.in_([MovementType.output, MovementType.defect]))
                .count()
            )
            days_left = max(int(in_stock / daily_rate), 0)
        result.append({'product_id': p.id, 'product_name': p.name, 'days_left': days_left})
    return result


def abc_analysis(db: Session):
    rows = (
        db.query(Product.id, Product.name, StockMovement.qty, StockMovement.unit_price)
        .join(Product, Product.id == StockMovement.product_id)
        .filter(StockMovement.movement_type == MovementType.output)
        .all()
    )
    revenue_by_product = defaultdict(float)
    for r in rows:
        revenue_by_product[(r.id, r.name)] += float(r.qty) * float(r.unit_price)

    total = sum(revenue_by_product.values()) or 1
    sorted_items = sorted(revenue_by_product.items(), key=lambda x: x[1], reverse=True)

    cumulative = 0
    response = []
    for (pid, name), revenue in sorted_items:
        cumulative += revenue / total
        if cumulative <= 0.8:
            klass = 'A'
        elif cumulative <= 0.95:
            klass = 'B'
        else:
            klass = 'C'
        response.append({'product_id': pid, 'product_name': name, 'revenue': revenue, 'class': klass})
    return response


def warranty_check(db: Session, serial_number: str):
    serial = serial_number.strip()
    if not serial:
        return None

    last_movement = (
        db.query(StockMovement)
        .filter(StockMovement.serial_number == serial)
        .order_by(StockMovement.created_at.desc())
        .first()
    )
    if not last_movement:
        return None

    last_output = (
        db.query(StockMovement)
        .filter(StockMovement.serial_number == serial)
        .filter(StockMovement.movement_type == MovementType.output)
        .order_by(StockMovement.created_at.desc())
        .first()
    )
    if not last_output:
        return None

    sold_at = last_output.created_at
    expires_at = sold_at.replace(year=sold_at.year + 2)

    if last_movement.movement_type != MovementType.output:
        return {
            'serial_number': serial,
            'status': 'REFUNDED_OR_RETURNED',
            'warranty_active': False,
            'sold_at': sold_at,
            'sold_to': last_output.customer_name,
            'warranty_valid_until': expires_at,
            'last_movement_type': last_movement.movement_type.value,
            'last_movement_at': last_movement.created_at,
        }

    return {
        'serial_number': serial,
        'status': 'SOLD_ACTIVE',
        'warranty_active': True,
        'sold_at': sold_at,
        'sold_to': last_output.customer_name,
        'warranty_valid_until': expires_at,
        'last_movement_type': last_movement.movement_type.value,
        'last_movement_at': last_movement.created_at,
    }
