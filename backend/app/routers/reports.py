from __future__ import annotations

from datetime import datetime
from io import BytesIO

import pandas as pd
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import (
    AppSetting,
    AuditLog,
    Category,
    DailySnapshot,
    InventoryItem,
    MonthlyBusinessSnapshot,
    Notification,
    Product,
    RefundRequest,
    StockMovement,
    ThresholdSuggestion,
    User,
)
from ..services.business_summary import get_business_summary
from ..services.excel import dataframe_to_xlsx_bytes

router = APIRouter(prefix='/reports', tags=['reports'])


def _xlsx_response(content: bytes, file_name: str) -> Response:
    headers = {'Content-Disposition': f'attachment; filename={file_name}'}
    return Response(
        content=content,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers=headers,
    )


def _multi_sheet_xlsx(sheet_map: dict[str, pd.DataFrame]) -> bytes:
    out = BytesIO()
    with pd.ExcelWriter(out, engine='openpyxl') as writer:
        for sheet_name, df in sheet_map.items():
            safe_sheet = sheet_name[:31] if sheet_name else 'sheet'
            df.to_excel(writer, sheet_name=safe_sheet, index=False)
    return out.getvalue()


@router.get('/products.xlsx')
def export_products(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    rows = db.query(Product).all()
    df = pd.DataFrame(
        [
            {
                'id': p.id,
                'name': p.name,
                'brand_name': p.brand_name,
                'supplier_name': p.supplier_name,
                'category': p.category,
                'sku': p.internal_sku,
                'factory_barcode': p.factory_barcode,
                'store_barcode': p.store_barcode,
                'purchase_price': float(p.purchase_price),
                'sell_price': float(p.sell_price),
                'min_sell_price': float(p.min_sell_price),
                'min_threshold': int(p.min_threshold or 0),
                'compatibility_group': p.compatibility_group,
                'location': p.warehouse_location,
                'product_comment': p.product_comment,
                'technical_specs': p.technical_specs,
            }
            for p in rows
        ]
    )
    return _xlsx_response(dataframe_to_xlsx_bytes(df), 'products.xlsx')


@router.get('/movements.xlsx')
def export_movements(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    rows = db.query(StockMovement).all()
    df = pd.DataFrame(
        [
            {
                'id': r.id,
                'type': r.movement_type.value,
                'product_id': r.product_id,
                'serial_number': r.serial_number,
                'qty': r.qty,
                'unit_price': float(r.unit_price),
                'customer_name': r.customer_name,
                'comment': r.comment,
                'created_by_user_id': r.created_by_user_id,
                'created_at': r.created_at,
            }
            for r in rows
        ]
    )
    return _xlsx_response(dataframe_to_xlsx_bytes(df), 'movements.xlsx')


@router.get('/audit.xlsx')
def export_audit(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    rows = db.query(AuditLog).all()
    df = pd.DataFrame(
        [
            {
                'id': r.id,
                'entity': r.entity,
                'entity_id': r.entity_id,
                'action': r.action,
                'old_value': r.old_value,
                'new_value': r.new_value,
                'username': r.username,
                'ip_address': r.ip_address,
                'created_at': r.created_at,
            }
            for r in rows
        ]
    )
    return _xlsx_response(dataframe_to_xlsx_bytes(df), 'audit.xlsx')


@router.get('/business-summary.xlsx')
def export_business_summary(
    period: str = Query(default='current_month'),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    summary = get_business_summary(db, period=period, start_date=start_date, end_date=end_date)
    summary_df = pd.DataFrame([summary])
    monthly_rows = (
        db.query(MonthlyBusinessSnapshot)
        .order_by(MonthlyBusinessSnapshot.snapshot_month.desc())
        .limit(24)
        .all()
    )
    monthly_df = pd.DataFrame(
        [
            {
                'snapshot_month': r.snapshot_month,
                'start_date': r.start_date,
                'end_date': r.end_date,
                'purchased_qty': r.purchased_qty,
                'purchased_amount': float(r.purchased_amount),
                'sold_qty': r.sold_qty,
                'sold_amount': float(r.sold_amount),
                'flow_balance': float(r.flow_balance),
                'inventory_units': r.inventory_units,
                'inventory_value_purchase': float(r.inventory_value_purchase),
                'total_products': r.total_products,
                'total_categories': r.total_categories,
                'generated_at': r.generated_at,
            }
            for r in monthly_rows
        ]
    )
    content = _multi_sheet_xlsx({'period_summary': summary_df, 'monthly_archive': monthly_df})
    stamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    return _xlsx_response(content, f'business_summary_{stamp}.xlsx')


@router.get('/full-backup.xlsx')
def export_full_backup(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    sheets: dict[str, pd.DataFrame] = {
        'products': pd.DataFrame(
            [
                {
                    'id': p.id,
                    'name': p.name,
                    'category': p.category,
                    'brand_name': p.brand_name,
                    'supplier_name': p.supplier_name,
                    'internal_sku': p.internal_sku,
                    'factory_barcode': p.factory_barcode,
                    'store_barcode': p.store_barcode,
                    'purchase_price': float(p.purchase_price),
                    'sell_price': float(p.sell_price),
                    'min_sell_price': float(p.min_sell_price),
                    'min_threshold': int(p.min_threshold or 0),
                    'warehouse_location': p.warehouse_location,
                    'compatibility_group': p.compatibility_group,
                    'created_at': p.created_at,
                    'updated_at': p.updated_at,
                }
                for p in db.query(Product).all()
            ]
        ),
        'inventory_items': pd.DataFrame(
            [
                {
                    'id': i.id,
                    'product_id': i.product_id,
                    'serial_number': i.serial_number,
                    'in_stock': i.in_stock,
                    'sold_to': i.sold_to,
                    'sold_at': i.sold_at,
                    'warranty_months': i.warranty_months,
                }
                for i in db.query(InventoryItem).all()
            ]
        ),
        'stock_movements': pd.DataFrame(
            [
                {
                    'id': m.id,
                    'movement_type': m.movement_type.value,
                    'product_id': m.product_id,
                    'serial_number': m.serial_number,
                    'qty': m.qty,
                    'unit_price': float(m.unit_price),
                    'customer_name': m.customer_name,
                    'comment': m.comment,
                    'created_by_user_id': m.created_by_user_id,
                    'created_at': m.created_at,
                }
                for m in db.query(StockMovement).all()
            ]
        ),
        'categories': pd.DataFrame(
            [
                {'id': c.id, 'name': c.name, 'unit': c.unit, 'is_active': c.is_active, 'created_at': c.created_at}
                for c in db.query(Category).all()
            ]
        ),
        'users': pd.DataFrame(
            [
                {
                    'id': u.id,
                    'username': u.username,
                    'full_name': u.full_name,
                    'role': u.role.value if hasattr(u.role, 'value') else str(u.role),
                    'is_active': u.is_active,
                    'created_at': u.created_at,
                }
                for u in db.query(User).all()
            ]
        ),
        'audit_logs': pd.DataFrame(
            [
                {
                    'id': a.id,
                    'entity': a.entity,
                    'entity_id': a.entity_id,
                    'action': a.action,
                    'username': a.username,
                    'ip_address': a.ip_address,
                    'created_at': a.created_at,
                }
                for a in db.query(AuditLog).all()
            ]
        ),
        'refund_requests': pd.DataFrame(
            [
                {
                    'id': r.id,
                    'sale_ref': r.sale_ref,
                    'movement_ids_json': r.movement_ids_json,
                    'reason': r.reason,
                    'status': r.status.value if hasattr(r.status, 'value') else str(r.status),
                    'requested_by_user_id': r.requested_by_user_id,
                    'reviewed_by_user_id': r.reviewed_by_user_id,
                    'review_note': r.review_note,
                    'created_at': r.created_at,
                    'reviewed_at': r.reviewed_at,
                }
                for r in db.query(RefundRequest).all()
            ]
        ),
        'threshold_suggestions': pd.DataFrame(
            [
                {
                    'id': s.id,
                    'product_id': s.product_id,
                    'current_min_threshold': s.current_min_threshold,
                    'suggested_min_threshold': s.suggested_min_threshold,
                    'confidence': s.confidence,
                    'status': s.status.value if hasattr(s.status, 'value') else str(s.status),
                    'model_version': s.model_version,
                    'created_at': s.created_at,
                    'reviewed_at': s.reviewed_at,
                }
                for s in db.query(ThresholdSuggestion).all()
            ]
        ),
        'notifications': pd.DataFrame(
            [
                {
                    'id': n.id,
                    'target_role': n.target_role,
                    'type': n.type,
                    'severity': n.severity,
                    'title': n.title,
                    'is_read': n.is_read,
                    'created_at': n.created_at,
                }
                for n in db.query(Notification).all()
            ]
        ),
        'app_settings': pd.DataFrame([{'id': s.id, 'key': s.key, 'value': s.value, 'updated_at': s.updated_at} for s in db.query(AppSetting).all()]),
        'daily_snapshots': pd.DataFrame(
            [{'id': s.id, 'snapshot_date': s.snapshot_date, 'file_path': s.file_path} for s in db.query(DailySnapshot).all()]
        ),
        'monthly_business_snapshots': pd.DataFrame(
            [
                {
                    'id': s.id,
                    'snapshot_month': s.snapshot_month,
                    'start_date': s.start_date,
                    'end_date': s.end_date,
                    'purchased_qty': s.purchased_qty,
                    'purchased_amount': float(s.purchased_amount),
                    'sold_qty': s.sold_qty,
                    'sold_amount': float(s.sold_amount),
                    'flow_balance': float(s.flow_balance),
                    'inventory_units': s.inventory_units,
                    'inventory_value_purchase': float(s.inventory_value_purchase),
                    'total_products': s.total_products,
                    'total_categories': s.total_categories,
                    'generated_at': s.generated_at,
                }
                for s in db.query(MonthlyBusinessSnapshot).all()
            ]
        ),
    }
    content = _multi_sheet_xlsx(sheets)
    stamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    return _xlsx_response(content, f'openstoko_full_backup_{stamp}.xlsx')


@router.get('/import-template.xlsx')
def export_import_template(user: User = Depends(require_admin)):
    template_df = pd.DataFrame(
        [
            {
                'name': 'Brake Pads Front BMW E46',
                'category': 'Braking System',
                'factory_barcode': '3801000000101',
                'brand_name': 'Brembo',
                'supplier_name': 'ACME Parts Ltd.',
                'store_barcode': '9702000000101',
                'internal_sku': 'BRK-BRE-E46-FP',
                'warehouse_location': 'A1-01',
                'purchase_price': 45.00,
                'sell_price': 59.00,
                'min_sell_price': 54.00,
                'min_threshold': 8,
                'compatibility_group': 'BMW_E46_FRONT_BRAKES',
                'product_comment': 'Front axle set',
                'technical_specs': 'for BMW E46 316i-330i',
                'photo_url': '',
            }
        ]
    )
    notes_df = pd.DataFrame(
        [
            {'column': 'name', 'required': 'yes', 'notes': 'Product name'},
            {'column': 'category', 'required': 'yes', 'notes': 'Category name (existing or new)'},
            {'column': 'factory_barcode', 'required': 'yes', 'notes': 'EAN/UPC, unique'},
            {'column': 'purchase_price', 'required': 'optional', 'notes': 'Decimal number'},
            {'column': 'sell_price', 'required': 'optional', 'notes': 'Decimal number'},
            {'column': 'min_sell_price', 'required': 'optional', 'notes': 'Decimal number'},
            {'column': 'min_threshold', 'required': 'optional', 'notes': 'Integer'},
            {'column': 'compatibility_group', 'required': 'optional', 'notes': 'For alternatives cross-reference'},
        ]
    )
    content = _multi_sheet_xlsx({'template': template_df, 'notes': notes_df})
    return _xlsx_response(content, 'openstoko_import_template.xlsx')
