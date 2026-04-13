from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import InventoryItem, Product


def resolve_compatibility_group(product: Product) -> str | None:
    return (product.compatibility_group or '').strip() or (product.compatibility_group_code or '').strip() or None


def stock_count_map(db: Session, product_ids: list[int]) -> dict[int, int]:
    if not product_ids:
        return {}
    rows = (
        db.query(InventoryItem.product_id, func.count(InventoryItem.id))
        .filter(InventoryItem.product_id.in_(product_ids), InventoryItem.in_stock.is_(True))
        .group_by(InventoryItem.product_id)
        .all()
    )
    return {int(product_id): int(cnt) for product_id, cnt in rows}


def search_brands_for_query(db: Session, query: str) -> list[dict]:
    q = query.strip().lower()
    if not q:
        return []

    matched = (
        db.query(Product)
        .filter(
            (func.lower(Product.name).like(f'%{q}%'))
            | (func.lower(Product.internal_sku).like(f'%{q}%'))
            | (func.lower(Product.factory_barcode).like(f'%{q}%'))
            | (func.lower(func.coalesce(Product.store_barcode, '')).like(f'%{q}%'))
        )
        .order_by(Product.name.asc(), Product.id.asc())
        .limit(200)
        .all()
    )
    if not matched:
        return []

    buckets: dict[str, dict] = {}
    for row in matched:
        brand = (row.brand_name or 'Generic').strip() or 'Generic'
        compatibility_group = resolve_compatibility_group(row)
        data = buckets.setdefault(
            brand,
            {'brand_name': brand, 'products_count': 0, 'compatibility_groups': set(), 'sample_product_ids': []},
        )
        data['products_count'] += 1
        if compatibility_group:
            data['compatibility_groups'].add(compatibility_group)
        if len(data['sample_product_ids']) < 5:
            data['sample_product_ids'].append(row.id)

    output = []
    for item in buckets.values():
        output.append(
            {
                'brand_name': item['brand_name'],
                'products_count': item['products_count'],
                'compatibility_groups': sorted(item['compatibility_groups']),
                'sample_product_ids': item['sample_product_ids'],
            }
        )
    output.sort(key=lambda r: (-r['products_count'], r['brand_name']))
    return output


def select_product_with_alternatives(db: Session, query: str, brand_name: str) -> dict:
    q = query.strip().lower()
    brand = brand_name.strip().lower()
    if not q or not brand:
        return {}

    selected = (
        db.query(Product)
        .filter(
            (
                (func.lower(Product.name).like(f'%{q}%'))
                | (func.lower(Product.internal_sku).like(f'%{q}%'))
                | (func.lower(Product.factory_barcode).like(f'%{q}%'))
                | (func.lower(func.coalesce(Product.store_barcode, '')).like(f'%{q}%'))
            ),
            func.lower(Product.brand_name) == brand,
        )
        .order_by(Product.id.asc())
        .first()
    )
    if not selected:
        return {}

    stock_map = stock_count_map(db, [selected.id])
    selected_group = resolve_compatibility_group(selected)
    alternatives = []

    if selected_group:
        alt_rows = (
            db.query(Product)
            .filter(
                Product.id != selected.id,
                func.lower(func.coalesce(Product.compatibility_group, Product.compatibility_group_code)) == selected_group.lower(),
            )
            .order_by(Product.brand_name.asc(), Product.sell_price.asc(), Product.id.asc())
            .limit(50)
            .all()
        )
        alt_stock_map = stock_count_map(db, [r.id for r in alt_rows])
        alternatives = [
            {
                'product_id': row.id,
                'sku': row.internal_sku,
                'name': row.name,
                'brand_name': row.brand_name,
                'category': row.category,
                'compatibility_group': resolve_compatibility_group(row),
                'sell_price': float(row.sell_price),
                'current_stock': int(alt_stock_map.get(row.id, 0)),
            }
            for row in alt_rows
        ]

    return {
        'product': {
            'product_id': selected.id,
            'sku': selected.internal_sku,
            'name': selected.name,
            'brand_name': selected.brand_name,
            'category': selected.category,
            'category_id': selected.category_id,
            'compatibility_group': selected_group,
            'factory_barcode': selected.factory_barcode,
            'store_barcode': selected.store_barcode,
            'sell_price': float(selected.sell_price),
            'current_stock': int(stock_map.get(selected.id, 0)),
            'min_threshold': int(selected.min_threshold or 0),
        },
        'alternatives': alternatives,
    }
