from datetime import datetime, timedelta
import json
import re

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_client_ip, require_operator_or_admin
from ..models import InventoryItem, MovementType, Product, RefundRequest, RefundRequestStatus, Role, StockMovement, User
from ..schemas import MovementCreate, MovementOut
from ..services.audit import log_action
from ..services.barcode import generate_warranty_label_pdf
from ..services.excel import dataframe_to_xlsx_bytes

router = APIRouter(prefix='/movements', tags=['movements'])


class BulkInputRequest(BaseModel):
    product_id: int
    serial_numbers: list[str]
    comment: str = ''


class ReconcileRequest(BaseModel):
    product_id: int
    serial_numbers_found: list[str]
    comment: str = ''


class QuickOutputRequest(BaseModel):
    product_id: int
    qty: int
    unit_price: float
    customer_name: str
    comment: str = ''


class GeneratedInputRequest(BaseModel):
    product_id: int
    qty: int
    serial_prefix: str | None = None
    comment: str = ''


class CheckoutItem(BaseModel):
    product_id: int
    qty: int
    unit_price: float


class CheckoutRequest(BaseModel):
    customer_name: str
    comment: str = ''
    items: list[CheckoutItem]


class RefundSaleRequest(BaseModel):
    movement_ids: list[int]
    comment: str = 'Sale refund/cancel'


class RefundRequestCreate(BaseModel):
    sale_ref: str
    movement_ids: list[int]
    reason: str = ''


class RefundRequestReview(BaseModel):
    action: str
    note: str = ''


def _ensure_refund_requests_table(db: Session):
    db.execute(
        text(
            "CREATE TABLE IF NOT EXISTS refund_requests ("
            "id INT AUTO_INCREMENT PRIMARY KEY, "
            "sale_ref VARCHAR(120) NOT NULL, "
            "movement_ids_json TEXT NOT NULL, "
            "reason TEXT NOT NULL, "
            "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending', "
            "requested_by_user_id INT NOT NULL, "
            "reviewed_by_user_id INT NULL, "
            "review_note TEXT NOT NULL, "
            "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "reviewed_at DATETIME NULL, "
            "INDEX idx_refund_requests_status_created (status, created_at), "
            "INDEX idx_refund_requests_sale_ref (sale_ref)"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        )
    )
    db.commit()


def _serial_prefix_from_product(product: Product) -> str:
    source = (product.category or product.name or 'PRD').upper()
    cleaned = re.sub(r'[^A-Z0-9]+', '', source)
    return (cleaned[:4] if cleaned else 'PRD')


def _sale_ref_from_comment(comment: str | None) -> str | None:
    if not comment:
        return None
    match = re.search(r'\[sale:([A-Za-z0-9_-]+)\]', comment)
    return match.group(1) if match else None


def _create_movement(
    db: Session,
    payload: MovementCreate,
    user: User,
    ip: str,
):
    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    if payload.movement_type in (MovementType.adjustment, MovementType.inventory_reconcile) and not payload.comment.strip():
        raise HTTPException(status_code=400, detail='Comment required for adjustment/inventory reconcile')

    if payload.movement_type == MovementType.input and not payload.serial_number:
        raise HTTPException(status_code=400, detail='Serial number is required for input')

    if payload.movement_type == MovementType.output:
        if payload.unit_price < float(product.min_sell_price):
            raise HTTPException(
                status_code=400,
                detail=f'PRICE_BELOW_MIN: {product.name} min={float(product.min_sell_price):.2f}, requested={float(payload.unit_price):.2f}',
            )
        if not payload.serial_number:
            raise HTTPException(status_code=400, detail='Serial number is required for output')

    if payload.movement_type in (MovementType.output, MovementType.defect):
        item = (
            db.query(InventoryItem)
            .filter(
                InventoryItem.product_id == payload.product_id,
                InventoryItem.serial_number == payload.serial_number,
                InventoryItem.in_stock.is_(True),
            )
            .first()
        )
        if not item:
            raise HTTPException(status_code=400, detail='SN_NOT_AVAILABLE: Serial not available in stock')
        item.in_stock = False
        if payload.movement_type == MovementType.output:
            item.sold_to = payload.customer_name
            item.sold_at = datetime.utcnow()

    if payload.movement_type == MovementType.input:
        existing = (
            db.query(InventoryItem)
            .filter(
                InventoryItem.product_id == payload.product_id,
                InventoryItem.serial_number == payload.serial_number,
            )
            .first()
        )
        if existing and existing.in_stock:
            raise HTTPException(status_code=400, detail='SN_CONFLICT: Serial already in stock')
        if existing and not existing.in_stock:
            # Re-open existing serial row (used by sale refund/cancel).
            existing.in_stock = True
            existing.sold_to = None
            existing.sold_at = None
        if not existing:
            db.add(
                InventoryItem(
                    product_id=payload.product_id,
                    serial_number=payload.serial_number,
                    in_stock=True,
                )
            )

    movement = StockMovement(
        movement_type=payload.movement_type,
        product_id=payload.product_id,
        serial_number=payload.serial_number,
        qty=payload.qty,
        unit_price=payload.unit_price,
        customer_name=payload.customer_name,
        comment=payload.comment,
        created_by_user_id=user.id,
    )
    db.add(movement)
    db.flush()

    log_action(
        db,
        entity='stock_movement',
        entity_id=str(movement.id),
        action=payload.movement_type.value,
        old_value=None,
        new_value={
            **payload.model_dump(),
            'movement_id': movement.id,
            'product_name': product.name,
            'product_sku': product.internal_sku,
            'purchase_price': float(product.purchase_price),
            'min_sell_price': float(product.min_sell_price),
            'profit_per_unit': (float(payload.unit_price) - float(product.purchase_price))
            if payload.movement_type == MovementType.output
            else None,
            'created_by_user_id': user.id,
            'created_by_username': user.username,
            'created_at': movement.created_at,
        },
        username=user.username,
        ip_address=ip,
    )
    return movement


def _available_items(db: Session, product_id: int):
    return (
        db.query(InventoryItem)
        .filter(InventoryItem.product_id == product_id, InventoryItem.in_stock.is_(True))
        .order_by(InventoryItem.id.asc())
        .all()
    )


@router.post('', response_model=MovementOut)
def create_movement(
    payload: MovementCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    movement = _create_movement(db, payload, user, get_client_ip(request))
    db.commit()
    db.refresh(movement)
    return movement


@router.post('/input-bulk')
def input_bulk(
    payload: BulkInputRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    ip = get_client_ip(request)
    created = 0
    for sn in payload.serial_numbers:
        move = MovementCreate(
            movement_type=MovementType.input,
            product_id=payload.product_id,
            serial_number=sn,
            qty=1,
            unit_price=0,
            comment=payload.comment,
        )
        _create_movement(db, move, user, ip)
        created += 1

    db.commit()
    return {'created': created}


@router.get('/available-serials/{product_id}')
def available_serials(product_id: int, db: Session = Depends(get_db), user: User = Depends(require_operator_or_admin)):
    items = _available_items(db, product_id)
    return {'product_id': product_id, 'available_qty': len(items), 'serial_numbers': [i.serial_number for i in items]}


@router.post('/output-quick')
def output_quick(
    payload: QuickOutputRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    if payload.qty <= 0:
        raise HTTPException(status_code=400, detail='qty must be > 0')
    if not payload.customer_name.strip():
        raise HTTPException(status_code=400, detail='customer_name is required')

    items = _available_items(db, payload.product_id)
    if len(items) < payload.qty:
        raise HTTPException(status_code=400, detail=f'Not enough stock. Available: {len(items)}')

    ip = get_client_ip(request)
    selected = items[: payload.qty]
    created_ids: list[int] = []
    selected_serials: list[str] = []
    for item in selected:
        movement = _create_movement(
            db,
            MovementCreate(
                movement_type=MovementType.output,
                product_id=payload.product_id,
                serial_number=item.serial_number,
                qty=1,
                unit_price=payload.unit_price,
                customer_name=payload.customer_name.strip(),
                comment=payload.comment,
            ),
            user,
            ip,
        )
        created_ids.append(movement.id)
        selected_serials.append(item.serial_number)

    db.commit()
    return {'created': len(created_ids), 'movement_ids': created_ids, 'serial_numbers': selected_serials}


@router.post('/checkout')
def checkout(
    payload: CheckoutRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    if not payload.customer_name.strip():
        raise HTTPException(status_code=400, detail='customer_name is required')
    if not payload.items:
        raise HTTPException(status_code=400, detail='items are required')

    ip = get_client_ip(request)
    sale_ref = datetime.utcnow().strftime('SALE%Y%m%d%H%M%S%f')
    sale_comment = f'[sale:{sale_ref}] {payload.comment or "Cashier checkout"}'.strip()

    # Validate all lines first to keep checkout atomic.
    allocations: list[tuple[CheckoutItem, list[InventoryItem], Product]] = []
    for item in payload.items:
        if item.qty <= 0:
            raise HTTPException(status_code=400, detail='INVALID_QTY: qty must be > 0')
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f'Product {item.product_id} not found')
        if item.unit_price < float(product.min_sell_price):
            raise HTTPException(
                status_code=400,
                detail=f'PRICE_BELOW_MIN: {product.name} min={float(product.min_sell_price):.2f}, requested={float(item.unit_price):.2f}',
            )
        available = _available_items(db, item.product_id)
        if len(available) < item.qty:
            raise HTTPException(
                status_code=400,
                detail=f'OUT_OF_STOCK: {product.name} requested={item.qty}, available={len(available)}',
            )
        allocations.append((item, available[: item.qty], product))

    created_ids: list[int] = []
    sold_serials: list[str] = []
    line_summary: list[dict] = []
    total_amount = 0.0
    for line, selected_items, _product in allocations:
        line_total = float(line.unit_price or 0) * int(line.qty or 0)
        total_amount += line_total
        line_summary.append(
            {
                'product_id': line.product_id,
                'qty': int(line.qty or 0),
                'unit_price': float(line.unit_price or 0),
                'line_total': line_total,
            }
        )
        for inventory_item in selected_items:
            movement = _create_movement(
                db,
                MovementCreate(
                    movement_type=MovementType.output,
                    product_id=line.product_id,
                    serial_number=inventory_item.serial_number,
                    qty=1,
                    unit_price=line.unit_price,
                    customer_name=payload.customer_name.strip(),
                    comment=sale_comment,
                ),
                user,
                ip,
            )
            created_ids.append(movement.id)
            sold_serials.append(inventory_item.serial_number)

    log_action(
        db,
        entity='sale_transaction',
        entity_id=sale_ref,
        action='checkout',
        old_value=None,
        new_value={
            'sale_ref': sale_ref,
            'customer_name': payload.customer_name.strip(),
            'comment': payload.comment,
            'items': line_summary,
            'total_qty': sum(int(i.qty or 0) for i in payload.items),
            'total_amount': total_amount,
            'movement_ids': created_ids,
            'serial_numbers': sold_serials,
        },
        username=user.username,
        ip_address=ip,
    )

    db.commit()
    return {'created': len(created_ids), 'movement_ids': created_ids, 'serial_numbers': sold_serials, 'sale_ref': sale_ref}


def _require_admin(user: User):
    if user.role != Role.admin:
        raise HTTPException(status_code=403, detail='Admin only')


def _execute_refund(
    db: Session,
    movement_ids: list[int],
    user: User,
    ip: str,
    comment: str,
):
    ids = sorted({i for i in movement_ids if i > 0})
    if not ids:
        raise HTTPException(status_code=400, detail='movement_ids are required')

    rows = db.query(StockMovement).filter(StockMovement.id.in_(ids)).all()
    by_id = {r.id: r for r in rows}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise HTTPException(status_code=404, detail=f'Movements not found: {missing}')

    restored = 0
    refund_ids: list[int] = []
    for movement_id in ids:
        movement = by_id[movement_id]
        if movement.movement_type != MovementType.output:
            raise HTTPException(status_code=400, detail=f'Movement {movement.id} is not output and cannot be refunded')
        if not movement.serial_number:
            raise HTTPException(status_code=400, detail=f'Movement {movement.id} has no serial number')
        inv = (
            db.query(InventoryItem)
            .filter(InventoryItem.product_id == movement.product_id, InventoryItem.serial_number == movement.serial_number)
            .first()
        )
        if inv and inv.in_stock:
            raise HTTPException(status_code=400, detail=f'SN_CONFLICT: {movement.serial_number} is already in stock')

        created = _create_movement(
            db,
            MovementCreate(
                movement_type=MovementType.input,
                product_id=movement.product_id,
                serial_number=movement.serial_number,
                qty=1,
                unit_price=0,
                customer_name=None,
                comment=comment.strip(),
            ),
            user,
            ip,
        )
        restored += 1
        refund_ids.append(created.id)
    return {'restored': restored, 'refund_movement_ids': refund_ids}


@router.get('/recent-sales')
def recent_sales(
    limit: int = 10,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    _require_admin(user)
    _ensure_refund_requests_table(db)
    safe_limit = max(1, min(limit, 30))
    rows = (
        db.query(StockMovement)
        .filter(StockMovement.movement_type == MovementType.output)
        .order_by(StockMovement.created_at.desc())
        .limit(600)
        .all()
    )
    if not rows:
        return []

    product_ids = {r.product_id for r in rows}
    product_map = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()} if product_ids else {}
    user_ids = {r.created_by_user_id for r in rows}
    user_map = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    sale_pattern = re.compile(r'\[sale:([A-Za-z0-9_-]+)\]')

    grouped: dict[str, dict] = {}
    ordered_keys: list[str] = []
    for movement in rows:
        match = sale_pattern.search(movement.comment or '')
        if match:
            key = match.group(1)
            sale_ref = match.group(1)
        else:
            created_key = movement.created_at.strftime('%Y%m%d%H%M')
            key = f'LEGACY-{movement.created_by_user_id}-{movement.customer_name or "walk-in"}-{created_key}'
            sale_ref = key

        if key not in grouped:
            ordered_keys.append(key)
            grouped[key] = {
                'sale_ref': sale_ref,
                'customer_name': movement.customer_name or 'Walk-in',
                'comment': movement.comment or '',
                'created_at': movement.created_at,
                'operator_username': user_map.get(movement.created_by_user_id, f'user-{movement.created_by_user_id}'),
                'movement_ids': [],
                'total_qty': 0,
                'total_amount': 0.0,
                'items': [],
                'can_refund': True,
                'refund_lock_reason': None,
            }

        sale = grouped[key]
        sale['movement_ids'].append(movement.id)
        line_qty = int(movement.qty or 1)
        sale['total_qty'] += line_qty
        sale['total_amount'] += float(movement.unit_price or 0) * line_qty
        if movement.created_at > sale['created_at']:
            sale['created_at'] = movement.created_at
        product = product_map.get(movement.product_id)
        sale['items'].append(
            {
                'movement_id': movement.id,
                'product_id': movement.product_id,
                'product_name': product.name if product else f'Product #{movement.product_id}',
                'product_category': product.category if product else '-',
                'product_barcode': product.factory_barcode if product else '-',
                'serial_number': movement.serial_number,
                'unit_price': float(movement.unit_price or 0),
                'qty': int(movement.qty or 1),
            }
        )
        inv = (
            db.query(InventoryItem)
            .filter(InventoryItem.product_id == movement.product_id, InventoryItem.serial_number == movement.serial_number)
            .first()
        )
        if not inv:
            sale['can_refund'] = False
            if not sale.get('refund_lock_reason'):
                sale['refund_lock_reason'] = 'missing_serial'
        elif inv.in_stock:
            sale['can_refund'] = False
            if not sale.get('refund_lock_reason'):
                sale['refund_lock_reason'] = 'already_refunded'

    sale_refs = [grouped[k]['sale_ref'] for k in ordered_keys[:safe_limit]]
    refund_rows = (
        db.query(RefundRequest)
        .order_by(RefundRequest.created_at.desc())
        .limit(500)
        .all()
    )
    parsed_refunds: list[tuple[RefundRequest, set[int]]] = []
    latest_refund_status: dict[str, str] = {}
    for row in refund_rows:
        try:
            rid_list = json.loads(row.movement_ids_json or '[]')
            rid_set = {int(x) for x in rid_list if int(x) > 0}
        except Exception:
            rid_set = set()
        parsed_refunds.append((row, rid_set))
        if row.sale_ref in sale_refs and row.sale_ref not in latest_refund_status:
            latest_refund_status[row.sale_ref] = row.status.value

    result = [grouped[k] for k in ordered_keys[:safe_limit]]
    for entry in result:
        entry['movement_count'] = len(entry['movement_ids'])
        req_status = latest_refund_status.get(entry['sale_ref'])
        if not req_status:
            movement_set = {int(x) for x in entry.get('movement_ids', [])}
            for row, rid_set in parsed_refunds:
                if rid_set and movement_set.intersection(rid_set):
                    req_status = row.status.value
                    break
        entry['refund_request_status'] = req_status
        if req_status == 'pending':
            entry['can_refund'] = False
            entry['refund_lock_reason'] = 'pending_request'
        elif req_status == 'approved':
            entry['can_refund'] = False
            entry['refund_lock_reason'] = 'approved_request'
        elif req_status == 'rejected':
            entry['can_refund'] = True
            entry['refund_lock_reason'] = None
    return result


@router.post('/refund-sale')
def refund_sale(
    payload: RefundSaleRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    _require_admin(user)
    ip = get_client_ip(request)
    res = _execute_refund(db, payload.movement_ids, user, ip, payload.comment or 'Sale refund/cancel')
    db.commit()
    return res


@router.post('/refund-requests')
def create_refund_request(
    payload: RefundRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    _ensure_refund_requests_table(db)
    sale_ref = payload.sale_ref.strip()
    ids = sorted({i for i in payload.movement_ids if i > 0})
    if not sale_ref:
        raise HTTPException(status_code=400, detail='sale_ref is required')
    if not ids:
        raise HTTPException(status_code=400, detail='movement_ids are required')

    existing_pending = (
        db.query(RefundRequest)
        .filter(RefundRequest.sale_ref == sale_ref, RefundRequest.status == RefundRequestStatus.pending)
        .first()
    )
    if existing_pending:
        raise HTTPException(status_code=400, detail='Pending refund request already exists for this sale')

    refund_request = RefundRequest(
        sale_ref=sale_ref,
        movement_ids_json=json.dumps(ids),
        reason=payload.reason.strip(),
        status=RefundRequestStatus.pending,
        requested_by_user_id=user.id,
    )
    db.add(refund_request)
    db.commit()
    db.refresh(refund_request)

    log_action(
        db,
        entity='refund_request',
        entity_id=str(refund_request.id),
        action='create',
        old_value=None,
        new_value={'sale_ref': sale_ref, 'movement_ids': ids, 'reason': payload.reason.strip(), 'status': 'pending'},
        username=user.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return {'ok': True, 'request_id': refund_request.id}


@router.get('/refund-requests')
def list_refund_requests(
    status: str = 'pending',
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    _ensure_refund_requests_table(db)
    if user.role != Role.admin:
        raise HTTPException(status_code=403, detail='Admin only')

    q = db.query(RefundRequest)
    status_norm = (status or '').strip().lower()
    if status_norm in {'pending', 'approved', 'rejected'}:
        q = q.filter(RefundRequest.status == RefundRequestStatus(status_norm))
    rows = q.order_by(RefundRequest.created_at.desc()).limit(max(1, min(limit, 200))).all()

    user_ids = {r.requested_by_user_id for r in rows if r.requested_by_user_id} | {r.reviewed_by_user_id for r in rows if r.reviewed_by_user_id}
    users_map = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    result = []
    for row in rows:
        try:
            movement_ids = json.loads(row.movement_ids_json or '[]')
        except Exception:
            movement_ids = []
        result.append(
            {
                'id': row.id,
                'sale_ref': row.sale_ref,
                'movement_ids': movement_ids,
                'reason': row.reason,
                'status': row.status.value,
                'requested_by_username': users_map.get(row.requested_by_user_id, f'user-{row.requested_by_user_id}'),
                'reviewed_by_username': users_map.get(row.reviewed_by_user_id, '') if row.reviewed_by_user_id else None,
                'review_note': row.review_note,
                'created_at': row.created_at,
                'reviewed_at': row.reviewed_at,
            }
        )
    return result


@router.post('/refund-requests/{request_id}/review')
def review_refund_request(
    request_id: int,
    payload: RefundRequestReview,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    _require_admin(user)
    _ensure_refund_requests_table(db)
    action = (payload.action or '').strip().lower()
    if action not in {'approve', 'reject'}:
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

    row = db.query(RefundRequest).filter(RefundRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail='Refund request not found')
    if row.status != RefundRequestStatus.pending:
        raise HTTPException(status_code=400, detail='Refund request already reviewed')

    movement_ids = json.loads(row.movement_ids_json or '[]')
    if action == 'approve':
        ip = get_client_ip(request)
        _execute_refund(
            db,
            movement_ids,
            user,
            ip,
            f"[refund_request:{row.id}] {(payload.note or row.reason or 'Approved refund').strip()}",
        )
        row.status = RefundRequestStatus.approved
    else:
        row.status = RefundRequestStatus.rejected

    row.reviewed_by_user_id = user.id
    row.review_note = payload.note.strip()
    row.reviewed_at = datetime.utcnow()
    db.commit()

    log_action(
        db,
        entity='refund_request',
        entity_id=str(row.id),
        action=action,
        old_value={'status': 'pending'},
        new_value={'status': row.status.value, 'sale_ref': row.sale_ref, 'movement_ids': movement_ids, 'note': row.review_note},
        username=user.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    return {'ok': True, 'request_id': row.id, 'status': row.status.value}


@router.post('/input-generate')
def input_generate(
    payload: GeneratedInputRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    if payload.qty <= 0:
        raise HTTPException(status_code=400, detail='qty must be > 0')
    if payload.qty > 1000:
        raise HTTPException(status_code=400, detail='qty too high (max 1000 per request)')

    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    ip = get_client_ip(request)
    generated: list[str] = []
    current_second = datetime.utcnow().replace(microsecond=0)
    seq = 1
    next_item_id = int((db.query(func.max(InventoryItem.id)).scalar() or 0)) + 1
    existing_serials = {row[0] for row in db.query(InventoryItem.serial_number).all()}
    serial_prefix = (payload.serial_prefix.strip().upper() if payload.serial_prefix and payload.serial_prefix.strip() else _serial_prefix_from_product(product))

    while len(generated) < payload.qty:
        if seq > 999:
            current_second = current_second + timedelta(seconds=1)
            seq = 1

        sn = f"{serial_prefix}-{current_second.strftime('%Y%m%d')}-{current_second.strftime('%H%M%S')}-{next_item_id:06d}"
        seq += 1
        next_item_id += 1

        if sn in existing_serials:
            continue

        _create_movement(
            db,
            MovementCreate(
                movement_type=MovementType.input,
                product_id=payload.product_id,
                serial_number=sn,
                qty=1,
                unit_price=0,
                comment=payload.comment or 'Auto-generated serial input',
            ),
            user,
            ip,
        )
        existing_serials.add(sn)
        generated.append(sn)

    db.commit()
    return {'created': len(generated), 'serial_numbers': generated}


@router.post('/inventory-reconcile')
def reconcile_inventory(
    payload: ReconcileRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    software_items = db.query(InventoryItem).filter(InventoryItem.product_id == payload.product_id, InventoryItem.in_stock.is_(True)).all()
    software_set = {i.serial_number for i in software_items}
    physical_set = {s.strip() for s in payload.serial_numbers_found if s.strip()}

    missing = sorted(list(software_set - physical_set))
    unexpected = sorted(list(physical_set - software_set))

    ip = get_client_ip(request)
    for sn in missing:
        item = db.query(InventoryItem).filter(InventoryItem.product_id == payload.product_id, InventoryItem.serial_number == sn).first()
        if item:
            item.in_stock = False

        _create_movement(
            db,
            MovementCreate(
                movement_type=MovementType.inventory_reconcile,
                product_id=payload.product_id,
                serial_number=sn,
                qty=-1,
                unit_price=0,
                comment=f'Reconcile missing serial. {payload.comment}'.strip(),
            ),
            user,
            ip,
        )

    for sn in unexpected:
        existing = db.query(InventoryItem).filter(InventoryItem.product_id == payload.product_id, InventoryItem.serial_number == sn).first()
        if not existing:
            db.add(InventoryItem(product_id=payload.product_id, serial_number=sn, in_stock=True))

        _create_movement(
            db,
            MovementCreate(
                movement_type=MovementType.inventory_reconcile,
                product_id=payload.product_id,
                serial_number=sn,
                qty=1,
                unit_price=0,
                comment=f'Reconcile unexpected serial. {payload.comment}'.strip(),
            ),
            user,
            ip,
        )

    db.commit()
    return {'missing': missing, 'unexpected': unexpected, 'auto_adjusted': len(missing) + len(unexpected)}


@router.get('/warranty-label/{serial_number}')
def warranty_label_pdf(
    serial_number: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    sn = serial_number.strip()
    if not sn:
        raise HTTPException(status_code=400, detail='serial_number is required')

    movement = (
        db.query(StockMovement)
        .filter(StockMovement.movement_type == MovementType.output, StockMovement.serial_number == sn)
        .order_by(StockMovement.created_at.desc())
        .first()
    )
    if not movement:
        raise HTTPException(status_code=404, detail='Sold serial not found')

    product = db.query(Product).filter(Product.id == movement.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    sold_at_text = movement.created_at.strftime('%Y-%m-%d %H:%M:%S UTC') if movement.created_at else None
    sale_ref = _sale_ref_from_comment(movement.comment)
    pdf = generate_warranty_label_pdf(
        serial_number=sn,
        product_name=product.name,
        customer_name=movement.customer_name,
        sold_at_text=sold_at_text,
        sale_ref=sale_ref,
    )
    headers = {'Content-Disposition': f'attachment; filename=warranty_{sn}.pdf'}
    return Response(content=pdf, media_type='application/pdf', headers=headers)


@router.get('/defects-report.xlsx')
def defects_report(db: Session = Depends(get_db), user: User = Depends(require_operator_or_admin)):
    rows = db.query(StockMovement).filter(StockMovement.movement_type == MovementType.defect).order_by(StockMovement.created_at.desc()).all()
    df = pd.DataFrame(
        [
            {
                'id': r.id,
                'product_id': r.product_id,
                'serial_number': r.serial_number,
                'comment': r.comment,
                'created_at': r.created_at,
                'operator_user_id': r.created_by_user_id,
            }
            for r in rows
        ]
    )
    content = dataframe_to_xlsx_bytes(df)
    headers = {'Content-Disposition': 'attachment; filename=defects_report.xlsx'}
    return Response(content=content, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers=headers)


@router.get('', response_model=list[MovementOut])
def list_movements(db: Session = Depends(get_db), user: User = Depends(require_operator_or_admin)):
    query = db.query(StockMovement)
    if user.role == Role.operator:
        query = query.filter(StockMovement.created_by_user_id == user.id)
    return query.order_by(StockMovement.created_at.desc()).limit(500).all()
