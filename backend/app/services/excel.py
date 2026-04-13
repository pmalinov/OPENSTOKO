from io import BytesIO

import pandas as pd


def detect_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    normalized = {c.strip().lower(): c for c in df.columns}
    for candidate in candidates:
        if candidate.lower() in normalized:
            return normalized[candidate.lower()]
    return None


def parse_product_import(file_bytes: bytes) -> list[dict]:
    df = pd.read_excel(BytesIO(file_bytes))
    name_col = detect_column(df, ['name', 'product', 'product_name'])
    category_col = detect_column(df, ['category'])
    barcode_col = detect_column(df, ['factory_barcode', 'ean', 'upc', 'barcode'])
    store_barcode_col = detect_column(df, ['store_barcode', 'internal_barcode', 'warehouse_barcode'])
    sku_col = detect_column(df, ['internal_sku', 'sku'])
    brand_col = detect_column(df, ['brand_name', 'brand'])
    supplier_col = detect_column(df, ['supplier_name', 'supplier'])
    location_col = detect_column(df, ['warehouse_location', 'location'])
    min_threshold_col = detect_column(df, ['min_threshold', 'minimum_stock_threshold'])
    compatibility_col = detect_column(df, ['compatibility_group', 'compatibility_group_code', 'compatibility'])

    if not all([name_col, category_col, barcode_col]):
        raise ValueError('Required columns missing: name/category/factory_barcode')

    def _to_float(value, default: float = 0.0) -> float:
        if value is None:
            return default
        if isinstance(value, str) and not value.strip():
            return default
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _to_int(value, default: int = 0) -> int:
        if value is None:
            return default
        if isinstance(value, str) and not value.strip():
            return default
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default

    def _clean_str(value) -> str:
        if value is None:
            return ''
        text = str(value).strip()
        if text.lower() in {'nan', 'none', 'null'}:
            return ''
        return text

    rows = []
    for _, row in df.iterrows():
        description = _clean_str(row.get('description', ''))
        product_comment = _clean_str(row.get('product_comment', ''))
        technical_specs = _clean_str(row.get('technical_specs', ''))
        raw_store_barcode = _clean_str(row[store_barcode_col]) if store_barcode_col else ''
        raw_internal_sku = _clean_str(row[sku_col]) if sku_col else ''
        raw_brand = _clean_str(row[brand_col]) if brand_col else ''
        raw_supplier = _clean_str(row[supplier_col]) if supplier_col else ''
        raw_location = _clean_str(row[location_col]) if location_col else ''
        raw_compatibility = _clean_str(row[compatibility_col]) if compatibility_col else ''
        rows.append(
            {
                'name': _clean_str(row[name_col]),
                'category': _clean_str(row[category_col]),
                'factory_barcode': _clean_str(row[barcode_col]),
                'store_barcode': raw_store_barcode or None,
                'internal_sku': raw_internal_sku or None,
                'brand_name': raw_brand or 'Generic',
                'supplier_name': raw_supplier or None,
                'description': description,
                'product_comment': product_comment or description,
                'technical_specs': technical_specs,
                'photo_url': _clean_str(row.get('photo_url', '')) or None,
                'warehouse_location': raw_location or _clean_str(row.get('warehouse_location', 'N/A')) or 'N/A',
                'purchase_price': _to_float(row.get('purchase_price', 0), 0.0),
                'sell_price': _to_float(row.get('sell_price', 0), 0.0),
                'min_sell_price': _to_float(row.get('min_sell_price', 0), 0.0),
                'min_threshold': _to_int(row[min_threshold_col], 0) if min_threshold_col else 0,
                'compatibility_group': raw_compatibility or None,
                'compatibility_group_code': raw_compatibility or None,
            }
        )
    return rows


def dataframe_to_xlsx_bytes(df: pd.DataFrame) -> bytes:
    out = BytesIO()
    with pd.ExcelWriter(out, engine='openpyxl') as writer:
        df.to_excel(writer, index=False)
    return out.getvalue()
