import json
import math
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_client_ip, get_current_user, require_admin, require_operator_or_admin
from ..models import (
    Category,
    InventoryItem,
    MovementType,
    Notification,
    Product,
    ProductSubstitute,
    Role,
    StockMovement,
    ThresholdSuggestion,
    ThresholdSuggestionStatus,
    User,
)
from ..schemas import CategoryCreate, CategoryOut, CategoryUpdate, ProductCreate, ProductOut
from ..services.audit import log_action
from ..services.barcode import generate_code128_png, generate_label_pdf
from ..services.excel import parse_product_import
from ..services.sku import generate_sku
from ..services.universal_search import (
    resolve_compatibility_group,
    search_brands_for_query,
    select_product_with_alternatives,
)

router = APIRouter(prefix='/products', tags=['products'])

UPLOAD_DIR = Path(__file__).resolve().parent.parent / 'uploads' / 'products'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp'}
CONTENT_TYPE_TO_EXT = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
}


class DossierCommentRequest(BaseModel):
    product_id: int
    serial_number: str | None = None
    comment: str = Field(min_length=1, max_length=2000)


class ProductPricingUpdateRequest(BaseModel):
    purchase_price: float | None = None
    sell_price: float | None = None
    min_sell_price: float | None = None
    warehouse_location: str | None = None


class ProductThresholdUpdateRequest(BaseModel):
    min_threshold: int = Field(ge=0)


class ProductAdminEditRequest(BaseModel):
    name: str | None = None
    category: str | None = None
    brand_name: str | None = None
    supplier_name: str | None = None
    internal_sku: str | None = None
    factory_barcode: str | None = None
    store_barcode: str | None = None
    warehouse_location: str | None = None
    compatibility_group: str | None = None
    product_comment: str | None = None
    technical_specs: str | None = None
    photo_url: str | None = None
    purchase_price: float | None = None
    sell_price: float | None = None
    min_sell_price: float | None = None
    min_threshold: int | None = Field(default=None, ge=0)


class SubstituteLinkRequest(BaseModel):
    substitute_product_id: int
    rank: int = Field(default=100, ge=1, le=1000)
    note: str = ''


class ThresholdSuggestionCreateRequest(BaseModel):
    suggested_min_threshold: int = Field(ge=0)
    confidence: float = Field(default=0.5, ge=0, le=1)
    model_version: str = 'heuristic-v1'
    reason_json: dict = Field(default_factory=dict)


class ThresholdSuggestionReviewRequest(BaseModel):
    action: str = Field(pattern='^(approve|reject)$')


class ThresholdSignalRequest(BaseModel):
    note: str = Field(default='', max_length=500)


def _resolve_image_ext(file: UploadFile) -> str:
    filename = file.filename or ''
    suffix = Path(filename).suffix.lower()
    if suffix in ALLOWED_IMAGE_EXT:
        return suffix

    content_type = (file.content_type or '').lower()
    guessed = CONTENT_TYPE_TO_EXT.get(content_type)
    if guessed:
        return guessed

    raise HTTPException(status_code=400, detail='Unsupported image type. Use JPG/PNG/WEBP')


def _inventory_health_status(current_stock: int, min_threshold: int) -> str:
    threshold = max(0, int(min_threshold or 0))
    if current_stock <= threshold:
        return 'critical'
    warning_limit = int(math.ceil(threshold * 1.2))
    if threshold > 0 and current_stock <= warning_limit:
        return 'warning'
    return 'healthy'


def _stock_count_map(db: Session, product_ids: list[int]) -> dict[int, int]:
    if not product_ids:
        return {}
    rows = (
        db.query(InventoryItem.product_id, func.count(InventoryItem.id))
        .filter(InventoryItem.product_id.in_(product_ids), InventoryItem.in_stock.is_(True))
        .group_by(InventoryItem.product_id)
        .all()
    )
    return {int(product_id): int(cnt) for product_id, cnt in rows}


def _serialize_product_for_user(product: Product, user: User, current_stock: int) -> dict:
    is_admin = user.role == Role.admin
    return {
        'id': product.id,
        'name': product.name,
        'category': product.category,
        'category_id': product.category_id,
        'brand_name': product.brand_name,
        'supplier_name': product.supplier_name,
        'description': product.description,
        'product_comment': product.product_comment,
        'technical_specs': product.technical_specs,
        'photo_url': product.photo_url,
        'warehouse_location': product.warehouse_location,
        'factory_barcode': product.factory_barcode,
        'store_barcode': product.store_barcode,
        'internal_sku': product.internal_sku,
        'purchase_price': float(product.purchase_price) if is_admin else 0.0,
        'sell_price': float(product.sell_price),
        'min_sell_price': float(product.min_sell_price),
        'min_threshold': int(product.min_threshold or 0),
        'compatibility_group': resolve_compatibility_group(product),
        'compatibility_group_code': product.compatibility_group_code,
        'current_stock': int(current_stock),
        'inventory_health': _inventory_health_status(int(current_stock), int(product.min_threshold or 0)),
    }


def _substitute_rows_for_product(db: Session, product: Product, user: User):
    rows = (
        db.query(ProductSubstitute, Product)
        .join(Product, Product.id == ProductSubstitute.substitute_product_id)
        .filter(ProductSubstitute.product_id == product.id)
        .order_by(ProductSubstitute.rank.asc(), Product.id.asc())
        .all()
    )

    resolved_group = resolve_compatibility_group(product)
    if not rows and resolved_group:
        linked = (
            db.query(Product)
            .filter(
                Product.id != product.id,
                Product.category == product.category,
                func.lower(func.coalesce(Product.compatibility_group, Product.compatibility_group_code))
                == resolved_group.lower(),
            )
            .order_by(Product.sell_price.asc(), Product.id.asc())
            .limit(50)
            .all()
        )
        stock_map = _stock_count_map(db, [p.id for p in linked])
        return [
            {
                'product_id': p.id,
                'name': p.name,
                'sku': p.internal_sku,
                'barcode': p.store_barcode or p.factory_barcode,
                'brand_name': p.brand_name,
                'sell_price': float(p.sell_price),
                'current_stock': int(stock_map.get(p.id, 0)),
                'rank': 100,
                'note': 'compatibility_group',
            }
            for p in linked
        ]

    if not rows:
        linked = (
            db.query(Product)
            .filter(Product.id != product.id, Product.category == product.category)
            .order_by(Product.sell_price.asc(), Product.id.asc())
            .limit(20)
            .all()
        )
        stock_map = _stock_count_map(db, [p.id for p in linked])
        return [
            {
                'product_id': p.id,
                'name': p.name,
                'sku': p.internal_sku,
                'barcode': p.store_barcode or p.factory_barcode,
                'brand_name': p.brand_name,
                'sell_price': float(p.sell_price),
                'current_stock': int(stock_map.get(p.id, 0)),
                'rank': 999,
                'note': 'same_category_fallback',
            }
            for p in linked
        ]

    stock_map = _stock_count_map(db, [p.id for _, p in rows])
    return [
        {
            'product_id': substitute.id,
            'name': substitute.name,
            'sku': substitute.internal_sku,
            'barcode': substitute.store_barcode or substitute.factory_barcode,
            'brand_name': substitute.brand_name,
            'sell_price': float(substitute.sell_price),
            'current_stock': int(stock_map.get(substitute.id, 0)),
            'rank': int(link.rank),
            'note': link.note,
        }
        for link, substitute in rows
    ]


@router.post('/upload-photo')
def upload_product_photo(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    content_type = (file.content_type or '').lower()
    if not content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='File must be an image')

    ext = _resolve_image_ext(file)
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail='Empty file')
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail='Image too large. Max 5MB')

    file_name = f'{uuid4().hex}{ext}'
    target = UPLOAD_DIR / file_name
    target.write_bytes(data)

    return {'photo_url': f'/uploads/products/{file_name}'}


@router.get('/inventory-health')
def inventory_health(
    status: str = Query(default='all'),
    category: str = Query(default=''),
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    products = db.query(Product).order_by(Product.name.asc()).all()
    stock_map = _stock_count_map(db, [p.id for p in products])

    rows = []
    for p in products:
        if category.strip() and p.category.lower() != category.strip().lower():
            continue
        current_stock = int(stock_map.get(p.id, 0))
        health = _inventory_health_status(current_stock, int(p.min_threshold or 0))
        if status in {'critical', 'warning', 'healthy'} and health != status:
            continue
        rows.append(
            {
                'product_id': p.id,
                'name': p.name,
                'category': p.category,
                'sku': p.internal_sku,
                'barcode': p.store_barcode or p.factory_barcode,
                'warehouse_location': p.warehouse_location,
                'current_stock': current_stock,
                'min_threshold': int(p.min_threshold or 0),
                'warning_threshold': int(math.ceil((p.min_threshold or 0) * 1.2)),
                'health': health,
            }
        )

    severity_rank = {'critical': 0, 'warning': 1, 'healthy': 2}
    rows.sort(key=lambda r: (severity_rank.get(r['health'], 99), r['current_stock'], r['name']))
    return rows


@router.get('/dossier')
def product_dossier(
    code: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    q = code.strip()
    if not q:
        raise HTTPException(status_code=400, detail='Code is required')

    scanned_serial = None
    q_norm = q.lower()
    serial_item = (
        db.query(InventoryItem)
        .filter(func.lower(InventoryItem.serial_number) == q_norm)
        .first()
    )

    product = None
    if serial_item:
        product = db.query(Product).filter(Product.id == serial_item.product_id).first()
        scanned_serial = serial_item.serial_number
    else:
        # Priority: factory barcode -> internal SKU -> product name
        product = db.query(Product).filter(func.lower(Product.factory_barcode) == q_norm).first()
        if not product:
            product = db.query(Product).filter(func.lower(Product.internal_sku) == q_norm).first()

        if not product:
            # Friendly operator fallback: search by product name contains query text.
            product = (
                db.query(Product)
                .filter(func.lower(Product.name).like(f'%{q_norm}%'))
                .order_by(Product.name.asc())
                .first()
            )
        if not product:
            # Extra fallback for internal store barcode.
            product = db.query(Product).filter(func.lower(func.coalesce(Product.store_barcode, '')) == q_norm).first()

    if not product:
        raise HTTPException(status_code=404, detail='Product or serial not found')

    in_stock_qty = (
        db.query(func.count(InventoryItem.id))
        .filter(InventoryItem.product_id == product.id, InventoryItem.in_stock.is_(True))
        .scalar()
        or 0
    )

    serial_status = None
    if scanned_serial:
        serial_status = {
            'serial_number': scanned_serial,
            'status': 'IN_STOCK' if serial_item and serial_item.in_stock else 'OUT_OF_STOCK',
        }

    recent_moves = (
        db.query(StockMovement)
        .filter(StockMovement.product_id == product.id, StockMovement.comment != '')
        .order_by(StockMovement.created_at.desc())
        .limit(30)
        .all()
    )
    user_ids = {m.created_by_user_id for m in recent_moves}
    users_map = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    comments = [
        {
            'id': m.id,
            'comment': m.comment,
            'serial_number': m.serial_number,
            'created_at': m.created_at,
            'username': users_map.get(m.created_by_user_id, 'unknown'),
        }
        for m in recent_moves
    ]

    last_sale = (
        db.query(StockMovement)
        .filter(StockMovement.product_id == product.id, StockMovement.movement_type == MovementType.output)
        .order_by(StockMovement.created_at.desc())
        .first()
    )
    last_movement = (
        db.query(StockMovement)
        .filter(StockMovement.product_id == product.id)
        .order_by(StockMovement.created_at.desc())
        .first()
    )

    substitutes = _substitute_rows_for_product(db, product, user)

    return {
        'product': {
            'id': product.id,
            'name': product.name,
            'category': product.category,
            'category_id': product.category_id,
            'brand_name': product.brand_name,
            'supplier_name': product.supplier_name,
            'factory_barcode': product.factory_barcode,
            'store_barcode': product.store_barcode,
            'internal_sku': product.internal_sku,
            'warehouse_location': product.warehouse_location,
            'sell_price': float(product.sell_price),
            'min_sell_price': float(product.min_sell_price),
            'purchase_price': float(product.purchase_price) if user.role == Role.admin else 0.0,
            'product_comment': product.product_comment,
            'technical_specs': product.technical_specs,
            'photo_url': product.photo_url,
            'min_threshold': int(product.min_threshold or 0),
            'compatibility_group': resolve_compatibility_group(product),
            'compatibility_group_code': product.compatibility_group_code,
        },
        'stock': {
            'in_stock_qty': int(in_stock_qty),
            'current_serial': serial_status,
            'inventory_health': _inventory_health_status(int(in_stock_qty), int(product.min_threshold or 0)),
        },
        'comments': comments,
        'substitutes': substitutes,
        'last_sale': {
            'created_at': last_sale.created_at,
            'serial_number': last_sale.serial_number,
            'customer_name': last_sale.customer_name,
            'unit_price': float(last_sale.unit_price),
        }
        if last_sale
        else None,
        'last_movement': {
            'created_at': last_movement.created_at,
            'movement_type': last_movement.movement_type.value,
            'serial_number': last_movement.serial_number,
            'comment': last_movement.comment,
        }
        if last_movement
        else None,
    }


@router.post('/dossier/comment')
def add_dossier_comment(
    payload: DossierCommentRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    text = payload.comment.strip()
    if not text:
        raise HTTPException(status_code=400, detail='Comment is required')

    movement = StockMovement(
        movement_type=MovementType.adjustment,
        product_id=payload.product_id,
        serial_number=(payload.serial_number.strip() if payload.serial_number else None),
        qty=0,
        unit_price=0,
        customer_name=None,
        comment=f'[note] {text}',
        created_by_user_id=user.id,
    )
    db.add(movement)
    db.flush()

    log_action(
        db,
        entity='stock_movement',
        entity_id=str(movement.id),
        action='note',
        old_value=None,
        new_value={
            'movement_id': movement.id,
            'product_id': payload.product_id,
            'product_name': product.name,
            'serial_number': movement.serial_number,
            'comment': movement.comment,
            'created_by_user_id': user.id,
            'created_by_username': user.username,
            'created_at': movement.created_at,
        },
        username=user.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return {'ok': True, 'movement_id': movement.id}


@router.post('/{product_id}/admin-pricing')
def admin_update_pricing(
    product_id: int,
    payload: ProductPricingUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    old_value = {
        'purchase_price': float(product.purchase_price),
        'sell_price': float(product.sell_price),
        'min_sell_price': float(product.min_sell_price),
        'warehouse_location': product.warehouse_location,
    }

    if payload.purchase_price is not None:
        product.purchase_price = payload.purchase_price
    if payload.sell_price is not None:
        product.sell_price = payload.sell_price
    if payload.min_sell_price is not None:
        product.min_sell_price = payload.min_sell_price
    if payload.warehouse_location is not None:
        product.warehouse_location = payload.warehouse_location.strip() or product.warehouse_location

    if float(product.min_sell_price) > float(product.sell_price):
        raise HTTPException(status_code=400, detail='MIN_SELL_GT_SELL')

    db.commit()
    db.refresh(product)

    new_value = {
        'purchase_price': float(product.purchase_price),
        'sell_price': float(product.sell_price),
        'min_sell_price': float(product.min_sell_price),
        'warehouse_location': product.warehouse_location,
    }

    log_action(
        db,
        entity='product',
        entity_id=str(product.id),
        action='admin_pricing_update',
        old_value=old_value,
        new_value=new_value,
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    return {'ok': True, 'product_id': product.id, 'updated': new_value}


@router.put('/{product_id}/min-threshold')
def update_min_threshold(
    product_id: int,
    payload: ProductThresholdUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    old_threshold = int(product.min_threshold or 0)
    product.min_threshold = int(payload.min_threshold)
    db.commit()

    log_action(
        db,
        entity='product',
        entity_id=str(product.id),
        action='min_threshold_update',
        old_value={'min_threshold': old_threshold},
        new_value={'min_threshold': int(product.min_threshold)},
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return {'ok': True, 'product_id': product.id, 'min_threshold': int(product.min_threshold)}


@router.put('/{product_id}/admin-edit')
def admin_edit_product(
    product_id: int,
    payload: ProductAdminEditRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    old_value = {
        'name': product.name,
        'category': product.category,
        'brand_name': product.brand_name,
        'supplier_name': product.supplier_name,
        'internal_sku': product.internal_sku,
        'factory_barcode': product.factory_barcode,
        'store_barcode': product.store_barcode,
        'warehouse_location': product.warehouse_location,
        'compatibility_group': resolve_compatibility_group(product),
        'product_comment': product.product_comment,
        'technical_specs': product.technical_specs,
        'photo_url': product.photo_url,
        'purchase_price': float(product.purchase_price),
        'sell_price': float(product.sell_price),
        'min_sell_price': float(product.min_sell_price),
        'min_threshold': int(product.min_threshold or 0),
    }

    if payload.name is not None:
        next_name = payload.name.strip()
        if not next_name:
            raise HTTPException(status_code=400, detail='name cannot be empty')
        product.name = next_name
    if payload.category is not None:
        next_category = payload.category.strip()
        if not next_category:
            raise HTTPException(status_code=400, detail='category cannot be empty')
        product.category = next_category
        category = (
            db.query(Category)
            .filter(func.lower(Category.name) == next_category.lower())
            .first()
        )
        product.category_id = category.id if category else None
    if payload.brand_name is not None:
        product.brand_name = payload.brand_name.strip() or 'Generic'
    if payload.supplier_name is not None:
        product.supplier_name = payload.supplier_name.strip() or None
    if payload.internal_sku is not None:
        next_sku = payload.internal_sku.strip()
        if not next_sku:
            raise HTTPException(status_code=400, detail='internal_sku cannot be empty')
        product.internal_sku = next_sku
    if payload.factory_barcode is not None:
        next_factory_barcode = payload.factory_barcode.strip()
        if not next_factory_barcode:
            raise HTTPException(status_code=400, detail='factory_barcode cannot be empty')
        product.factory_barcode = next_factory_barcode
    if payload.store_barcode is not None:
        product.store_barcode = payload.store_barcode.strip() or None
    if payload.warehouse_location is not None:
        next_location = payload.warehouse_location.strip()
        if not next_location:
            raise HTTPException(status_code=400, detail='warehouse_location cannot be empty')
        product.warehouse_location = next_location
    if payload.compatibility_group is not None:
        normalized_group = payload.compatibility_group.strip() or None
        product.compatibility_group = normalized_group
        product.compatibility_group_code = normalized_group
    if payload.product_comment is not None:
        product.product_comment = payload.product_comment.strip()
    if payload.technical_specs is not None:
        product.technical_specs = payload.technical_specs.strip()
    if payload.photo_url is not None:
        product.photo_url = payload.photo_url.strip() or None
    if payload.purchase_price is not None:
        product.purchase_price = payload.purchase_price
    if payload.sell_price is not None:
        product.sell_price = payload.sell_price
    if payload.min_sell_price is not None:
        product.min_sell_price = payload.min_sell_price
    if payload.min_threshold is not None:
        product.min_threshold = int(payload.min_threshold)

    if float(product.min_sell_price) > float(product.sell_price):
        raise HTTPException(status_code=400, detail='MIN_SELL_GT_SELL')

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        msg = str(exc).lower()
        if 'factory_barcode' in msg:
            raise HTTPException(status_code=400, detail='FACTORY_BARCODE_EXISTS')
        if 'store_barcode' in msg:
            raise HTTPException(status_code=400, detail='STORE_BARCODE_EXISTS')
        if 'internal_sku' in msg:
            raise HTTPException(status_code=400, detail='INTERNAL_SKU_EXISTS')
        raise HTTPException(status_code=400, detail='ADMIN_EDIT_CONSTRAINT')
    db.refresh(product)

    new_value = {
        'name': product.name,
        'category': product.category,
        'brand_name': product.brand_name,
        'supplier_name': product.supplier_name,
        'internal_sku': product.internal_sku,
        'factory_barcode': product.factory_barcode,
        'store_barcode': product.store_barcode,
        'warehouse_location': product.warehouse_location,
        'compatibility_group': resolve_compatibility_group(product),
        'product_comment': product.product_comment,
        'technical_specs': product.technical_specs,
        'photo_url': product.photo_url,
        'purchase_price': float(product.purchase_price),
        'sell_price': float(product.sell_price),
        'min_sell_price': float(product.min_sell_price),
        'min_threshold': int(product.min_threshold or 0),
        'admin_id': int(admin.id),
    }

    log_action(
        db,
        entity='product',
        entity_id=str(product.id),
        action='admin_edit',
        old_value=old_value,
        new_value=new_value,
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    return {'ok': True, 'product_id': product.id, 'updated': new_value}


@router.get('/{product_id}/substitutes')
def list_substitutes(
    product_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')
    return _substitute_rows_for_product(db, product, user)


@router.post('/{product_id}/substitutes')
def add_substitute_link(
    product_id: int,
    payload: SubstituteLinkRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if payload.substitute_product_id == product_id:
        raise HTTPException(status_code=400, detail='Product cannot substitute itself')

    source = db.query(Product).filter(Product.id == product_id).first()
    target = db.query(Product).filter(Product.id == payload.substitute_product_id).first()
    if not source or not target:
        raise HTTPException(status_code=404, detail='Product not found')

    existing = (
        db.query(ProductSubstitute)
        .filter(
            ProductSubstitute.product_id == product_id,
            ProductSubstitute.substitute_product_id == payload.substitute_product_id,
        )
        .first()
    )
    if existing:
        existing.rank = payload.rank
        existing.note = payload.note.strip()
        action = 'substitute_update'
        entity_id = str(existing.id)
    else:
        row = ProductSubstitute(
            product_id=product_id,
            substitute_product_id=payload.substitute_product_id,
            rank=payload.rank,
            note=payload.note.strip(),
            created_by_user_id=admin.id,
        )
        db.add(row)
        db.flush()
        action = 'substitute_create'
        entity_id = str(row.id)

    db.commit()

    log_action(
        db,
        entity='product_substitute',
        entity_id=entity_id,
        action=action,
        old_value=None,
        new_value={
            'product_id': product_id,
            'substitute_product_id': payload.substitute_product_id,
            'rank': payload.rank,
            'note': payload.note.strip(),
        },
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    return {'ok': True}


@router.get('/universal/search')
def universal_search_brands(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    return {
        'query': q.strip(),
        'brands': search_brands_for_query(db, q),
    }


@router.get('/universal/select')
def universal_select_brand(
    q: str = Query(..., min_length=1),
    brand_name: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    result = select_product_with_alternatives(db, q, brand_name)
    if not result:
        raise HTTPException(status_code=404, detail='No product found for this query and brand')
    return result


@router.get('/operator-search')
def operator_search(
    q: str = Query(..., min_length=1),
    mode: str = Query(default='name'),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    query = q.strip().lower()
    mode_norm = mode.strip().lower()
    if mode_norm not in {'barcode', 'code', 'name', 'category'}:
        raise HTTPException(status_code=400, detail='mode must be one of: barcode, code, name, category')

    if mode_norm == 'barcode':
        rows = (
            db.query(Product)
            .filter(
                (func.lower(Product.factory_barcode).like(f'%{query}%'))
                | (func.lower(func.coalesce(Product.store_barcode, '')).like(f'%{query}%'))
            )
            .order_by(Product.name.asc(), Product.brand_name.asc(), Product.id.asc())
            .limit(limit)
            .all()
        )
    elif mode_norm == 'code':
        rows = (
            db.query(Product)
            .filter(
                (func.lower(Product.internal_sku).like(f'%{query}%'))
                | (func.lower(func.coalesce(Product.store_barcode, '')).like(f'%{query}%'))
            )
            .order_by(Product.name.asc(), Product.brand_name.asc(), Product.id.asc())
            .limit(limit)
            .all()
        )
    elif mode_norm == 'category':
        rows = (
            db.query(Product)
            .filter(func.lower(Product.category).like(f'%{query}%'))
            .order_by(Product.category.asc(), Product.name.asc(), Product.id.asc())
            .limit(300)
            .all()
        )
    else:
        rows = (
            db.query(Product)
            .filter(
                (func.lower(Product.name).like(f'%{query}%'))
                | (func.lower(Product.brand_name).like(f'%{query}%'))
            )
            .order_by(Product.name.asc(), Product.brand_name.asc(), Product.id.asc())
            .limit(limit)
            .all()
        )

    stock_map = _stock_count_map(db, [r.id for r in rows])
    sales_map: dict[int, int] = {}
    if rows:
        sales_rows = (
            db.query(StockMovement.product_id, func.coalesce(func.sum(StockMovement.qty), 0))
            .filter(
                StockMovement.product_id.in_([r.id for r in rows]),
                StockMovement.movement_type == MovementType.output,
            )
            .group_by(StockMovement.product_id)
            .all()
        )
        sales_map = {int(pid): int(qty or 0) for pid, qty in sales_rows}

    if mode_norm == 'category':
        rows = sorted(
            rows,
            key=lambda r: (-int(sales_map.get(r.id, 0)), -int(stock_map.get(r.id, 0)), r.name, r.id),
        )[:limit]

    return [
        {
            'product_id': row.id,
            'name': row.name,
            'brand_name': row.brand_name,
            'category': row.category,
            'sku': row.internal_sku,
            'internal_sku': row.internal_sku,
            'factory_barcode': row.factory_barcode,
            'store_barcode': row.store_barcode,
            'barcode': row.store_barcode or row.factory_barcode,
            'current_stock': int(stock_map.get(row.id, 0)),
            'sold_qty': int(sales_map.get(row.id, 0)),
            'sell_price': float(row.sell_price),
            'min_threshold': int(row.min_threshold or 0),
            'inventory_health': _inventory_health_status(int(stock_map.get(row.id, 0)), int(row.min_threshold or 0)),
            'compatibility_group': resolve_compatibility_group(row),
        }
        for row in rows
    ]


@router.get('/{product_id}/operator-card')
def operator_card(
    product_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    in_stock_qty = (
        db.query(func.count(InventoryItem.id))
        .filter(InventoryItem.product_id == product.id, InventoryItem.in_stock.is_(True))
        .scalar()
        or 0
    )
    recent_moves = (
        db.query(StockMovement)
        .filter(StockMovement.product_id == product.id, StockMovement.comment != '')
        .order_by(StockMovement.created_at.desc())
        .limit(15)
        .all()
    )
    user_ids = {m.created_by_user_id for m in recent_moves}
    users_map = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    comments = [
        {
            'id': m.id,
            'comment': m.comment,
            'serial_number': m.serial_number,
            'created_at': m.created_at,
            'username': users_map.get(m.created_by_user_id, 'unknown'),
        }
        for m in recent_moves
    ]
    return {
        'product': {
            'id': product.id,
            'name': product.name,
            'brand_name': product.brand_name,
            'supplier_name': product.supplier_name,
            'category': product.category,
            'factory_barcode': product.factory_barcode,
            'store_barcode': product.store_barcode,
            'internal_sku': product.internal_sku,
            'warehouse_location': product.warehouse_location,
            'sell_price': float(product.sell_price),
            'min_sell_price': float(product.min_sell_price),
            'purchase_price': float(product.purchase_price) if user.role == Role.admin else 0.0,
            'product_comment': product.product_comment,
            'technical_specs': product.technical_specs,
            'photo_url': product.photo_url,
            'min_threshold': int(product.min_threshold or 0),
            'compatibility_group': resolve_compatibility_group(product),
            'compatibility_group_code': product.compatibility_group_code,
        },
        'stock': {
            'in_stock_qty': int(in_stock_qty),
            'current_serial': None,
            'inventory_health': _inventory_health_status(int(in_stock_qty), int(product.min_threshold or 0)),
        },
        'comments': comments,
        'substitutes': _substitute_rows_for_product(db, product, user),
        'last_sale': None,
        'last_movement': None,
    }


@router.post('/{product_id}/signal-threshold')
def signal_threshold_to_admin(
    product_id: int,
    payload: ThresholdSignalRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_operator_or_admin),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    in_stock_qty = (
        db.query(func.count(InventoryItem.id))
        .filter(InventoryItem.product_id == product.id, InventoryItem.in_stock.is_(True))
        .scalar()
        or 0
    )
    health = _inventory_health_status(int(in_stock_qty), int(product.min_threshold or 0))
    db.add(
        Notification(
            target_role='admin',
            type='threshold_signal',
            severity='warning' if health in {'critical', 'warning'} else 'info',
            title=f'Threshold signal for {product.name}',
            payload_json=json.dumps(
                {
                    'product_id': product.id,
                    'product_name': product.name,
                    'brand_name': product.brand_name,
                    'sku': product.internal_sku,
                    'current_stock': int(in_stock_qty),
                    'min_threshold': int(product.min_threshold or 0),
                    'inventory_health': health,
                    'note': payload.note.strip(),
                    'sent_by_user_id': user.id,
                    'sent_by_username': user.username,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()

    log_action(
        db,
        entity='notification',
        entity_id=str(product.id),
        action='threshold_signal',
        old_value=None,
        new_value={
            'product_id': product.id,
            'current_stock': int(in_stock_qty),
            'min_threshold': int(product.min_threshold or 0),
            'inventory_health': health,
            'note': payload.note.strip(),
        },
        username=user.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return {'ok': True}


@router.delete('/{product_id}/substitutes/{substitute_product_id}')
def delete_substitute_link(
    product_id: int,
    substitute_product_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = (
        db.query(ProductSubstitute)
        .filter(
            ProductSubstitute.product_id == product_id,
            ProductSubstitute.substitute_product_id == substitute_product_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail='Substitute link not found')

    db.delete(row)
    db.commit()

    log_action(
        db,
        entity='product_substitute',
        entity_id=str(row.id),
        action='substitute_delete',
        old_value={'product_id': product_id, 'substitute_product_id': substitute_product_id},
        new_value={'deleted': True},
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    return {'deleted': True}


@router.get('/threshold-suggestions')
def list_threshold_suggestions(
    status: str = Query(default='pending'),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    query = db.query(ThresholdSuggestion)
    if status in {'pending', 'approved', 'rejected'}:
        query = query.filter(ThresholdSuggestion.status == ThresholdSuggestionStatus(status))

    rows = query.order_by(ThresholdSuggestion.created_at.desc()).limit(limit).all()
    product_map = {p.id: p for p in db.query(Product).filter(Product.id.in_([r.product_id for r in rows])).all()} if rows else {}

    out = []
    for row in rows:
        out.append(
            {
                'id': row.id,
                'product_id': row.product_id,
                'product_name': product_map[row.product_id].name if row.product_id in product_map else f'#{row.product_id}',
                'current_min_threshold': row.current_min_threshold,
                'suggested_min_threshold': row.suggested_min_threshold,
                'confidence': float(row.confidence),
                'model_version': row.model_version,
                'reason_json': json.loads(row.reason_json or '{}'),
                'status': row.status.value,
                'created_at': row.created_at,
                'reviewed_by_user_id': row.reviewed_by_user_id,
                'reviewed_at': row.reviewed_at,
            }
        )
    return out


@router.post('/{product_id}/threshold-suggestions')
def create_threshold_suggestion(
    product_id: int,
    payload: ThresholdSuggestionCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    suggestion = ThresholdSuggestion(
        product_id=product_id,
        current_min_threshold=int(product.min_threshold or 0),
        suggested_min_threshold=int(payload.suggested_min_threshold),
        reason_json=json.dumps(payload.reason_json or {}, ensure_ascii=False),
        model_version=payload.model_version.strip() or 'heuristic-v1',
        confidence=float(payload.confidence),
        status=ThresholdSuggestionStatus.pending,
    )
    db.add(suggestion)
    db.flush()

    db.add(
        Notification(
            target_role='admin',
            type='threshold_suggestion',
            severity='warning',
            title=f'Threshold suggestion for {product.name}',
            payload_json=json.dumps(
                {
                    'suggestion_id': suggestion.id,
                    'product_id': product_id,
                    'product_name': product.name,
                    'current_min_threshold': suggestion.current_min_threshold,
                    'suggested_min_threshold': suggestion.suggested_min_threshold,
                    'confidence': suggestion.confidence,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()

    log_action(
        db,
        entity='threshold_suggestion',
        entity_id=str(suggestion.id),
        action='create',
        old_value=None,
        new_value={
            'product_id': product_id,
            'current_min_threshold': suggestion.current_min_threshold,
            'suggested_min_threshold': suggestion.suggested_min_threshold,
            'confidence': suggestion.confidence,
            'model_version': suggestion.model_version,
        },
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    return {'ok': True, 'suggestion_id': suggestion.id}


@router.post('/threshold-suggestions/{suggestion_id}/review')
def review_threshold_suggestion(
    suggestion_id: int,
    payload: ThresholdSuggestionReviewRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    suggestion = db.query(ThresholdSuggestion).filter(ThresholdSuggestion.id == suggestion_id).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail='Suggestion not found')
    if suggestion.status != ThresholdSuggestionStatus.pending:
        raise HTTPException(status_code=400, detail='Suggestion already reviewed')

    suggestion.status = ThresholdSuggestionStatus.approved if payload.action == 'approve' else ThresholdSuggestionStatus.rejected
    suggestion.reviewed_by_user_id = admin.id
    suggestion.reviewed_at = func.now()

    product = db.query(Product).filter(Product.id == suggestion.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Product not found')

    old_threshold = int(product.min_threshold or 0)
    if payload.action == 'approve':
        product.min_threshold = int(suggestion.suggested_min_threshold)

    db.commit()

    log_action(
        db,
        entity='threshold_suggestion',
        entity_id=str(suggestion.id),
        action='approve' if payload.action == 'approve' else 'reject',
        old_value={
            'product_id': suggestion.product_id,
            'status': 'pending',
            'current_min_threshold': old_threshold,
        },
        new_value={
            'status': suggestion.status.value,
            'product_min_threshold': int(product.min_threshold or 0),
        },
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    return {
        'ok': True,
        'suggestion_id': suggestion.id,
        'status': suggestion.status.value,
        'product_id': product.id,
        'product_min_threshold': int(product.min_threshold or 0),
    }


@router.post('', response_model=ProductOut)
def create_product(
    payload: ProductCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail='NAME_REQUIRED')
    if not payload.category.strip():
        raise HTTPException(status_code=400, detail='CATEGORY_REQUIRED')
    factory_barcode = payload.factory_barcode.strip()
    if not factory_barcode:
        raise HTTPException(status_code=400, detail='FACTORY_BARCODE_REQUIRED')
    warehouse_location = payload.warehouse_location.strip()
    if not warehouse_location:
        raise HTTPException(status_code=400, detail='WAREHOUSE_LOCATION_REQUIRED')
    if db.query(Product).filter(Product.factory_barcode == factory_barcode).first():
        raise HTTPException(status_code=400, detail='Factory barcode already exists')
    store_barcode = payload.store_barcode.strip() if payload.store_barcode else None
    if store_barcode and db.query(Product).filter(Product.store_barcode == store_barcode).first():
        raise HTTPException(status_code=400, detail='Store barcode already exists')

    provided_sku = payload.internal_sku.strip() if payload.internal_sku else ''
    resolved_sku = provided_sku or generate_sku(db, payload.category.strip())
    if db.query(Product).filter(Product.internal_sku == resolved_sku).first():
        raise HTTPException(status_code=400, detail='Internal SKU already exists')

    category_name = payload.category.strip()
    category = db.query(Category).filter(Category.name == category_name, Category.is_active.is_(True)).first()
    if not category:
        raise HTTPException(status_code=400, detail='Category does not exist. Please ask admin to create it first')

    product_comment = payload.product_comment.strip() or payload.description.strip()
    technical_specs = payload.technical_specs.strip()
    supplier_name = payload.supplier_name.strip() if payload.supplier_name else None

    # Operator can create product master data, but cannot control financials/threshold.
    if user.role == Role.admin:
        purchase_price = payload.purchase_price
        sell_price = payload.sell_price
        min_sell_price = payload.min_sell_price
        min_threshold = int(payload.min_threshold)
        compatibility_group = payload.compatibility_group.strip() if payload.compatibility_group else None
        compatibility_group_code = payload.compatibility_group_code.strip() if payload.compatibility_group_code else None
        if compatibility_group and not compatibility_group_code:
            compatibility_group_code = compatibility_group
    else:
        purchase_price = 0
        sell_price = max(float(payload.sell_price or 0), 0)
        min_sell_price = max(float(payload.min_sell_price or 0), 0)
        min_threshold = 0
        compatibility_group = None
        compatibility_group_code = None

    if float(min_sell_price) > float(sell_price):
        raise HTTPException(status_code=400, detail='MIN_SELL_GT_SELL')

    product = Product(
        name=payload.name,
        category=category_name,
        category_id=category.id,
        brand_name=payload.brand_name.strip() or 'Generic',
        supplier_name=supplier_name,
        description=payload.description,
        product_comment=product_comment,
        technical_specs=technical_specs,
        photo_url=payload.photo_url,
        warehouse_location=warehouse_location,
        factory_barcode=factory_barcode,
        store_barcode=store_barcode,
        internal_sku=resolved_sku,
        purchase_price=purchase_price,
        sell_price=sell_price,
        min_sell_price=min_sell_price,
        min_threshold=min_threshold,
        compatibility_group=compatibility_group,
        compatibility_group_code=compatibility_group_code,
    )
    db.add(product)
    db.commit()
    db.refresh(product)

    log_action(
        db,
        entity='product',
        entity_id=str(product.id),
        action='create',
        old_value=None,
        new_value={
            'id': product.id,
            'name': product.name,
            'category': product.category,
            'supplier_name': product.supplier_name,
            'factory_barcode': product.factory_barcode,
            'store_barcode': product.store_barcode,
            'internal_sku': product.internal_sku,
            'warehouse_location': product.warehouse_location,
            'product_comment': product.product_comment,
            'technical_specs': product.technical_specs,
            'photo_url': product.photo_url,
            'purchase_price': float(product.purchase_price) if user.role == Role.admin else 0,
            'sell_price': float(product.sell_price),
            'min_sell_price': float(product.min_sell_price),
            'min_threshold': int(product.min_threshold),
            'compatibility_group': product.compatibility_group,
            'compatibility_group_code': product.compatibility_group_code,
        },
        username=user.username,
        ip_address=get_client_ip(request),
    )
    db.commit()

    current_stock = 0
    return _serialize_product_for_user(product, user, current_stock)


@router.get('', response_model=list[ProductOut])
def list_products(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(Product).order_by(Product.id.desc()).all()
    stock_map = _stock_count_map(db, [p.id for p in rows])
    return [_serialize_product_for_user(p, user, int(stock_map.get(p.id, 0))) for p in rows]


@router.get('/categories', response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Category).filter(Category.is_active.is_(True)).order_by(Category.name.asc()).all()


@router.post('/categories', response_model=CategoryOut)
def create_category(
    payload: CategoryCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    name = payload.name.strip()
    exists = db.query(Category).filter(Category.name == name).first()
    if exists:
        if exists.is_active:
            raise HTTPException(status_code=400, detail='Category already exists')
        exists.is_active = True
        exists.unit = payload.unit.strip()
        db.commit()
        db.refresh(exists)
        return exists

    category = Category(name=name, unit=payload.unit.strip())
    db.add(category)
    db.commit()
    db.refresh(category)
    log_action(
        db,
        entity='category',
        entity_id=str(category.id),
        action='create',
        old_value=None,
        new_value={'name': category.name, 'unit': category.unit},
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return category


@router.put('/categories/{category_id}', response_model=CategoryOut)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    category = db.query(Category).filter(Category.id == category_id, Category.is_active.is_(True)).first()
    if not category:
        raise HTTPException(status_code=404, detail='Category not found')

    old_name = category.name
    category.name = payload.name.strip()
    category.unit = payload.unit.strip()

    if old_name != category.name:
        db.query(Product).filter(Product.category == old_name).update({'category': category.name}, synchronize_session=False)

    db.commit()
    db.refresh(category)
    log_action(
        db,
        entity='category',
        entity_id=str(category.id),
        action='update',
        old_value={'name': old_name},
        new_value={'name': category.name, 'unit': category.unit},
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return category


@router.delete('/categories/{category_id}')
def delete_category(
    category_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    category = db.query(Category).filter(Category.id == category_id, Category.is_active.is_(True)).first()
    if not category:
        raise HTTPException(status_code=404, detail='Category not found')

    in_use = db.query(Product).filter(Product.category == category.name).first()
    if in_use:
        raise HTTPException(status_code=400, detail='Category is used by products and cannot be deleted')

    category.is_active = False
    db.commit()
    log_action(
        db,
        entity='category',
        entity_id=str(category.id),
        action='delete',
        old_value={'name': category.name},
        new_value={'is_active': False},
        username=admin.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return {'deleted': True}


@router.post('/import-excel')
def import_excel(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rows = parse_product_import(file.file.read())
    created = 0
    for row in rows:
        if not row['name'] or not row['category'] or not row['factory_barcode']:
            continue
        exists = db.query(Product).filter(Product.factory_barcode == row['factory_barcode']).first()
        if exists:
            continue
        if row.get('store_barcode'):
            store_exists = db.query(Product).filter(Product.store_barcode == row['store_barcode']).first()
            if store_exists:
                continue
        category_name = row['category'].strip()
        category = db.query(Category).filter(Category.name == category_name, Category.is_active.is_(True)).first()
        if not category:
            category = Category(name=category_name, unit='pcs')
            db.add(category)
            db.flush()
        internal_sku = (row.get('internal_sku') or '').strip()
        if internal_sku:
            sku_exists = db.query(Product).filter(Product.internal_sku == internal_sku).first()
            if sku_exists:
                internal_sku = generate_sku(db, category_name)
        else:
            internal_sku = generate_sku(db, category_name)
        product = Product(
            **{k: v for k, v in row.items() if k not in {'category', 'internal_sku'}},
            category=category_name,
            category_id=category.id,
            internal_sku=internal_sku,
        )
        db.add(product)
        created += 1

    db.commit()
    log_action(
        db,
        entity='product',
        entity_id='bulk',
        action='import_excel',
        old_value=None,
        new_value={
            'created': created,
            'uploaded_rows': len(rows),
            'source_file': file.filename,
        },
        username=user.username,
        ip_address=get_client_ip(request),
    )
    db.commit()
    return {'created': created, 'uploaded_rows': len(rows)}


@router.get('/{product_id}/barcode.png')
def barcode_png(product_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Not found')
    png = generate_code128_png(product.internal_sku)
    return Response(content=png, media_type='image/png')


@router.get('/{product_id}/label.pdf')
def label_pdf(product_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail='Not found')
    pdf = generate_label_pdf(product.internal_sku, product.name)
    headers = {'Content-Disposition': f'attachment; filename=label_{product.internal_sku}.pdf'}
    return Response(content=pdf, media_type='application/pdf', headers=headers)
