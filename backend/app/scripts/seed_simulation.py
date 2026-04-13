#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import random
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.database import Base, SessionLocal, engine
from app.models import (
    AppSetting,
    Category,
    DailySnapshot,
    InventoryItem,
    MovementType,
    Notification,
    Product,
    ProductSubstitute,
    RefundRequest,
    RefundRequestStatus,
    Role,
    StockMovement,
    ThresholdSuggestion,
    ThresholdSuggestionStatus,
    User,
)
from app.scripts.wipe_all_data import wipe_all_data
from app.services.audit import log_action

DEFAULT_RANDOM_SEED = 20260314
DEFAULT_HISTORY_DAYS = 365
SEED_IP = 'seed-script'


@dataclass(frozen=True)
class CategoryDef:
    name: str
    unit: str
    prefix: str


@dataclass(frozen=True)
class GroupDef:
    category: str
    name: str
    group_code: str
    sku_code: str
    location_zone: str
    base_purchase: float
    base_sell: float
    min_threshold: int
    brands: tuple[str, ...]
    description: str
    specs: str


@dataclass
class SeedState:
    serial_counter: int
    serial_registry: set[str]
    available_by_product: dict[int, list[str]]
    item_by_key: dict[tuple[int, str], InventoryItem]
    sale_batches: list[dict]
    sale_counter_by_day: dict[str, int]
    output_by_id: dict[int, StockMovement]


CATEGORY_DEFS: tuple[CategoryDef, ...] = (
    CategoryDef('Braking System', 'pcs', 'BRK'),
    CategoryDef('Filters', 'pcs', 'FIL'),
    CategoryDef('Suspension', 'pcs', 'SUP'),
    CategoryDef('Memory Modules', 'pcs', 'RAM'),
    CategoryDef('Storage', 'pcs', 'SSD'),
    CategoryDef('Power Supplies', 'pcs', 'PSU'),
)

CATEGORY_PREFIX = {c.name: c.prefix for c in CATEGORY_DEFS}

GROUP_DEFS: tuple[GroupDef, ...] = (
    GroupDef(
        category='Braking System',
        name='Brake Pads Front BMW E46',
        group_code='BMW_E46_FRONT_BRAKES',
        sku_code='E46-FP',
        location_zone='A1',
        base_purchase=33.0,
        base_sell=52.0,
        min_threshold=8,
        brands=('Brembo', 'TRW', 'Ferodo', 'Bosch', 'Delphi'),
        description='Front brake pad set',
        specs='BMW E46 316i-330i / front axle',
    ),
    GroupDef(
        category='Braking System',
        name='Brake Disc Rear VW Golf V',
        group_code='VW_GOLF5_REAR_DISCS',
        sku_code='G5-RD',
        location_zone='A2',
        base_purchase=26.5,
        base_sell=42.0,
        min_threshold=6,
        brands=('Brembo', 'TRW', 'Ferodo', 'Bosch', 'Delphi'),
        description='Rear brake disc',
        specs='VW Golf V / rear axle',
    ),
    GroupDef(
        category='Braking System',
        name='Brake Disc Front Audi A4 B8',
        group_code='AUDI_A4_B8_FRONT_DISCS',
        sku_code='A4B8-FD',
        location_zone='A3',
        base_purchase=34.0,
        base_sell=56.0,
        min_threshold=6,
        brands=('Brembo', 'ATE', 'TRW', 'Bosch', 'Delphi'),
        description='Front brake disc',
        specs='Audi A4 B8 2008-2016 / front axle',
    ),
    GroupDef(
        category='Filters',
        name='Oil Filter VW 1.9 TDI',
        group_code='VW_19TDI_OIL_FILTER',
        sku_code='19TDI-OF',
        location_zone='B1',
        base_purchase=4.8,
        base_sell=10.7,
        min_threshold=15,
        brands=('MANN', 'Bosch', 'Mahle', 'Purflux', 'Hengst'),
        description='Spin-on oil filter',
        specs='VW/Audi 1.9 TDI',
    ),
    GroupDef(
        category='Filters',
        name='Air Filter BMW E90',
        group_code='BMW_E90_AIR_FILTER',
        sku_code='E90-AF',
        location_zone='B2',
        base_purchase=8.1,
        base_sell=15.6,
        min_threshold=10,
        brands=('MANN', 'Bosch', 'Mahle', 'Purflux', 'Hengst'),
        description='Panel air filter',
        specs='BMW E90 318i-330i',
    ),
    GroupDef(
        category='Filters',
        name='Cabin Filter Toyota Corolla E150',
        group_code='COROLLA_E150_CABIN_FILTER',
        sku_code='E150-CF',
        location_zone='B3',
        base_purchase=7.2,
        base_sell=14.2,
        min_threshold=9,
        brands=('Denso', 'MANN', 'Mahle', 'Bosch', 'Purflux'),
        description='Cabin pollen filter',
        specs='Toyota Corolla E150',
    ),
    GroupDef(
        category='Suspension',
        name='Shock Absorber Front VW Passat B6',
        group_code='VW_B6_FRONT_SHOCK',
        sku_code='B6-FS',
        location_zone='C1',
        base_purchase=34.0,
        base_sell=61.0,
        min_threshold=5,
        brands=('Sachs', 'KYB', 'Bilstein', 'Monroe', 'Delphi'),
        description='Gas shock absorber',
        specs='VW Passat B6 / front',
    ),
    GroupDef(
        category='Suspension',
        name='Control Arm Front BMW E60',
        group_code='BMW_E60_FRONT_CONTROL_ARM',
        sku_code='E60-CA',
        location_zone='C2',
        base_purchase=28.0,
        base_sell=52.5,
        min_threshold=6,
        brands=('Lemforder', 'TRW', 'Meyle', 'Febi', 'Delphi'),
        description='Front control arm',
        specs='BMW E60 / front axle',
    ),
    GroupDef(
        category='Suspension',
        name='Shock Absorber Rear Audi A6 C7',
        group_code='AUDI_A6_C7_REAR_SHOCK',
        sku_code='A6C7-RS',
        location_zone='C3',
        base_purchase=36.0,
        base_sell=64.0,
        min_threshold=5,
        brands=('Sachs', 'Bilstein', 'KYB', 'Monroe', 'Delphi'),
        description='Rear shock absorber',
        specs='Audi A6 C7 / rear axle',
    ),
    GroupDef(
        category='Memory Modules',
        name='DDR4 RAM 16GB 3200MHz',
        group_code='DDR4_3200MHZ_16GB',
        sku_code='D4-16-3200',
        location_zone='D1',
        base_purchase=28.0,
        base_sell=45.0,
        min_threshold=10,
        brands=('Kingston', 'Corsair', 'G.Skill', 'Crucial', 'Patriot'),
        description='Desktop memory module',
        specs='DDR4 3200MHz 16GB',
    ),
    GroupDef(
        category='Memory Modules',
        name='DDR5 RAM 32GB 5600MHz',
        group_code='DDR5_5600MHZ_32GB',
        sku_code='D5-32-5600',
        location_zone='D2',
        base_purchase=62.0,
        base_sell=95.0,
        min_threshold=8,
        brands=('Kingston', 'Corsair', 'G.Skill', 'Crucial', 'TeamGroup'),
        description='Desktop memory module',
        specs='DDR5 5600MHz 32GB',
    ),
    GroupDef(
        category='Storage',
        name='NVMe SSD 1TB PCIe 4.0',
        group_code='NVME_PCIE4_1TB',
        sku_code='NVME-1TB',
        location_zone='E1',
        base_purchase=54.0,
        base_sell=82.0,
        min_threshold=7,
        brands=('Samsung', 'WD', 'Kingston', 'Crucial', 'ADATA'),
        description='NVMe solid-state drive',
        specs='M.2 2280 PCIe Gen4 1TB',
    ),
    GroupDef(
        category='Power Supplies',
        name='ATX PSU 650W 80+ Gold',
        group_code='ATX_650W_GOLD',
        sku_code='PSU-650G',
        location_zone='F1',
        base_purchase=49.0,
        base_sell=78.0,
        min_threshold=6,
        brands=('Corsair', 'Seasonic', 'be quiet!', 'Cooler Master', 'Thermaltake'),
        description='ATX power supply',
        specs='650W, 80+ Gold, modular',
    ),
)

CATEGORY_DEMAND_WEIGHT = {
    'Braking System': 1.35,
    'Filters': 1.60,
    'Suspension': 1.05,
    'Memory Modules': 1.15,
    'Storage': 1.20,
    'Power Supplies': 0.95,
}

CUSTOMERS = [
    'Walk-in',
    'Auto Service Mladost',
    'Sofia Parts Trade',
    'Tech House',
    'Fleet Service BG',
    'Retail Counter',
    'Speed Garage',
    'PC Clinic',
    'Gaming Arena',
    'IT Depot',
]


def _brand_code(brand: str) -> str:
    cleaned = re.sub(r'[^A-Za-z0-9]+', '', brand.upper())
    return (cleaned[:3] or 'GEN')


def _utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _random_time(rng: random.Random, day: date, start_hour: int, end_hour: int) -> datetime:
    hour = rng.randint(start_hour, end_hour)
    minute = rng.randint(0, 59)
    second = rng.randint(0, 59)
    return datetime.combine(day, time(hour=hour, minute=minute, second=second))


def _ensure_users(db: Session) -> tuple[User, User]:
    admin = db.query(User).filter(User.username == 'admin').first()
    if not admin:
        admin = User(
            username='admin',
            full_name='System Administrator',
            role=Role.admin,
            hashed_password=get_password_hash('admin123'),
            is_active=True,
        )
        db.add(admin)

    db.flush()
    # Keep dataset single-user by default: all seeded operations are authored by admin.
    return admin, admin


def _ensure_categories(db: Session) -> dict[str, Category]:
    existing = {row.name: row for row in db.query(Category).all()}
    for c in CATEGORY_DEFS:
        if c.name not in existing:
            row = Category(name=c.name, unit=c.unit, is_active=True)
            db.add(row)
            db.flush()
            existing[c.name] = row
    return existing


def _create_products(db: Session, categories: dict[str, Category], rng: random.Random) -> tuple[list[Product], dict[str, list[Product]]]:
    products: list[Product] = []
    by_group: dict[str, list[Product]] = defaultdict(list)
    barcode_seq = 1
    has_legacy_sku = bool(db.execute(text("SHOW COLUMNS FROM products LIKE 'sku'")).fetchone())
    existing_skus = {row[0] for row in db.query(Product.internal_sku).all()}
    existing_factory_barcodes = {row[0] for row in db.query(Product.factory_barcode).all()}
    existing_store_barcodes = {row[0] for row in db.query(Product.store_barcode).filter(Product.store_barcode.isnot(None)).all()}

    for group in GROUP_DEFS:
        category = categories[group.category]
        for idx, brand in enumerate(group.brands):
            variance = 0.92 + (idx * 0.03) + rng.uniform(-0.02, 0.04)
            purchase_price = round(group.base_purchase * variance, 2)
            sell_price = round(group.base_sell * variance + rng.uniform(-1.2, 1.5), 2)
            min_sell_price = round(max(purchase_price * 1.05, sell_price * 0.90), 2)

            base_sku = f"{CATEGORY_PREFIX[group.category]}-{_brand_code(brand)}-{group.sku_code}"[:50]
            sku = base_sku
            sku_suffix = 2
            while sku in existing_skus:
                suffix_text = f"-{sku_suffix}"
                sku = f"{base_sku[: max(1, 50 - len(suffix_text))]}{suffix_text}"
                sku_suffix += 1
            existing_skus.add(sku)

            factory_barcode = f"3802{barcode_seq:09d}"
            while factory_barcode in existing_factory_barcodes:
                barcode_seq += 1
                factory_barcode = f"3802{barcode_seq:09d}"
            existing_factory_barcodes.add(factory_barcode)

            store_barcode = f"9702{barcode_seq:09d}" if rng.random() < 0.72 else None
            if store_barcode:
                while store_barcode in existing_store_barcodes:
                    barcode_seq += 1
                    store_barcode = f"9702{barcode_seq:09d}"
                existing_store_barcodes.add(store_barcode)
            barcode_seq += 1

            min_threshold = max(3, group.min_threshold + rng.randint(-2, 3))
            location = f"{group.location_zone}-{idx + 1:02d}"

            if has_legacy_sku:
                db.execute(
                    text(
                        "INSERT INTO products ("
                        "sku, internal_sku, name, brand_name, category_id, category, "
                        "description, product_comment, technical_specs, factory_barcode, store_barcode, "
                        "warehouse_location, purchase_price, sell_price, min_sell_price, min_threshold, "
                        "compatibility_group, compatibility_group_code, created_at, updated_at"
                        ") VALUES ("
                        ":sku, :internal_sku, :name, :brand_name, :category_id, :category, "
                        ":description, :product_comment, :technical_specs, :factory_barcode, :store_barcode, "
                        ":warehouse_location, :purchase_price, :sell_price, :min_sell_price, :min_threshold, "
                        ":compatibility_group, :compatibility_group_code, :created_at, :updated_at"
                        ")"
                    ),
                    {
                        'sku': sku,
                        'internal_sku': sku,
                        'name': group.name,
                        'brand_name': brand,
                        'category_id': category.id,
                        'category': group.category,
                        'description': group.description,
                        'product_comment': 'Seeded realistic dataset',
                        'technical_specs': group.specs,
                        'factory_barcode': factory_barcode,
                        'store_barcode': store_barcode,
                        'warehouse_location': location,
                        'purchase_price': purchase_price,
                        'sell_price': sell_price,
                        'min_sell_price': min_sell_price,
                        'min_threshold': min_threshold,
                        'compatibility_group': group.group_code,
                        'compatibility_group_code': group.group_code,
                        'created_at': _utcnow_naive(),
                        'updated_at': _utcnow_naive(),
                    },
                )
                db.flush()
                product = db.query(Product).filter(Product.internal_sku == sku).first()
                if not product:
                    raise RuntimeError(f'Failed to load newly inserted product {sku}')
            else:
                product = Product(
                    name=group.name,
                    brand_name=brand,
                    category=group.category,
                    category_id=category.id,
                    description=group.description,
                    product_comment='Seeded realistic dataset',
                    technical_specs=group.specs,
                    factory_barcode=factory_barcode,
                    store_barcode=store_barcode,
                    internal_sku=sku,
                    warehouse_location=location,
                    purchase_price=purchase_price,
                    sell_price=sell_price,
                    min_sell_price=min_sell_price,
                    min_threshold=min_threshold,
                    compatibility_group=group.group_code,
                    compatibility_group_code=group.group_code,
                )
                db.add(product)
                db.flush()

            products.append(product)
            by_group[group.group_code].append(product)

    for group_products in by_group.values():
        for i, primary in enumerate(group_products):
            for j, alt in enumerate(group_products):
                if primary.id == alt.id:
                    continue
                db.add(
                    ProductSubstitute(
                        product_id=primary.id,
                        substitute_product_id=alt.id,
                        rank=10 + abs(i - j) * 10,
                        note='Same compatibility group',
                        created_by_user_id=None,
                    )
                )

    db.flush()
    return products, by_group


def _init_state(db: Session) -> SeedState:
    max_item_id = int(db.query(func.max(InventoryItem.id)).scalar() or 0)
    serials = {row[0] for row in db.query(InventoryItem.serial_number).all()}
    return SeedState(
        serial_counter=max_item_id + 1,
        serial_registry=serials,
        available_by_product=defaultdict(list),
        item_by_key={},
        sale_batches=[],
        sale_counter_by_day=defaultdict(int),
        output_by_id={},
    )


def _next_serial(state: SeedState, product: Product, at: datetime) -> str:
    prefix = CATEGORY_PREFIX.get(product.category, 'PRD')
    while True:
        sn = f"{prefix}-{at.strftime('%Y%m%d')}-{at.strftime('%H%M%S')}-{state.serial_counter:06d}"
        state.serial_counter += 1
        if sn not in state.serial_registry:
            state.serial_registry.add(sn)
            return sn


def _add_input_unit(
    db: Session,
    state: SeedState,
    product: Product,
    at: datetime,
    user: User,
    comment: str,
) -> str:
    sn = _next_serial(state, product, at)
    item = InventoryItem(
        product_id=product.id,
        serial_number=sn,
        in_stock=True,
    )
    db.add(item)
    movement = StockMovement(
        movement_type=MovementType.input,
        product_id=product.id,
        serial_number=sn,
        qty=1,
        unit_price=float(product.purchase_price or 0),
        customer_name=None,
        comment=comment,
        created_by_user_id=user.id,
        created_at=at,
    )
    db.add(movement)

    state.available_by_product[product.id].append(sn)
    state.item_by_key[(product.id, sn)] = item
    return sn


def _restock(
    db: Session,
    state: SeedState,
    rng: random.Random,
    product: Product,
    qty: int,
    at: datetime,
    admin: User,
    operator: User,
    reason: str,
) -> None:
    owner = operator if rng.random() < 0.75 else admin
    for i in range(qty):
        _add_input_unit(
            db,
            state,
            product,
            at + timedelta(seconds=i),
            owner,
            reason,
        )


def _sell_order(
    db: Session,
    state: SeedState,
    rng: random.Random,
    products: list[Product],
    weights: list[float],
    day: date,
    admin: User,
    operator: User,
) -> None:
    seller = operator if rng.random() < 0.78 else admin
    sale_time = _random_time(rng, day, 9, 18)
    day_key = day.isoformat()
    state.sale_counter_by_day[day_key] += 1
    sale_ref = f"SIM-{day.strftime('%Y%m%d')}-{state.sale_counter_by_day[day_key]:04d}"
    customer = rng.choice(CUSTOMERS)
    line_count = 1 if rng.random() < 0.60 else (2 if rng.random() < 0.88 else 3)

    chosen_products: list[Product] = []
    attempts = 0
    while len(chosen_products) < line_count and attempts < 15:
        candidate = rng.choices(products, weights=weights, k=1)[0]
        if candidate.id not in {p.id for p in chosen_products}:
            chosen_products.append(candidate)
        attempts += 1

    movement_ids: list[int] = []

    for product in chosen_products:
        qty = 1
        if product.category in {'Filters', 'Braking System'} and rng.random() < 0.35:
            qty = 2
        if product.category == 'Filters' and rng.random() < 0.10:
            qty = 3

        available = state.available_by_product[product.id]
        if len(available) < qty:
            refill_qty = max(product.min_threshold * 2, qty + rng.randint(2, 7))
            _restock(
                db,
                state,
                rng,
                product,
                refill_qty,
                sale_time - timedelta(hours=1, minutes=rng.randint(0, 30)),
                admin,
                operator,
                'Auto restock before sale',
            )

        unit_price = round(float(product.sell_price) * rng.uniform(0.98, 1.03), 2)

        for _ in range(qty):
            serial = state.available_by_product[product.id].pop(0)
            item = state.item_by_key[(product.id, serial)]
            item.in_stock = False
            item.sold_to = customer
            item.sold_at = sale_time

            movement = StockMovement(
                movement_type=MovementType.output,
                product_id=product.id,
                serial_number=serial,
                qty=1,
                unit_price=unit_price,
                customer_name=customer,
                comment=f"[sale:{sale_ref}] POS sale",
                created_by_user_id=seller.id,
                created_at=sale_time,
            )
            db.add(movement)
            db.flush()
            movement_ids.append(int(movement.id))
            state.output_by_id[int(movement.id)] = movement

    if movement_ids:
        state.sale_batches.append(
            {
                'sale_ref': sale_ref,
                'movement_ids': movement_ids,
                'created_at': sale_time,
                'requested_by': seller.username,
            }
        )


def _mark_defect(
    db: Session,
    state: SeedState,
    rng: random.Random,
    products: list[Product],
    day: date,
    admin: User,
    operator: User,
) -> None:
    product = rng.choice(products)
    available = state.available_by_product[product.id]
    if not available:
        return

    serial_index = rng.randint(0, len(available) - 1)
    serial = available.pop(serial_index)
    item = state.item_by_key[(product.id, serial)]
    item.in_stock = False

    defect_time = _random_time(rng, day, 10, 17)
    user = operator if rng.random() < 0.85 else admin
    movement = StockMovement(
        movement_type=MovementType.defect,
        product_id=product.id,
        serial_number=serial,
        qty=1,
        unit_price=0,
        customer_name=None,
        comment='Defect found during handling',
        created_by_user_id=user.id,
        created_at=defect_time,
    )
    db.add(movement)


def _inventory_reconcile(
    db: Session,
    state: SeedState,
    rng: random.Random,
    products: list[Product],
    day: date,
    operator: User,
) -> None:
    product = rng.choice(products)
    at = _random_time(rng, day, 18, 19)

    if state.available_by_product[product.id] and rng.random() < 0.55:
        # Missing serial found during cycle count.
        serial = state.available_by_product[product.id].pop(0)
        item = state.item_by_key[(product.id, serial)]
        item.in_stock = False
        movement = StockMovement(
            movement_type=MovementType.inventory_reconcile,
            product_id=product.id,
            serial_number=serial,
            qty=-1,
            unit_price=0,
            customer_name=None,
            comment='Cycle count adjustment: missing SN',
            created_by_user_id=operator.id,
            created_at=at,
        )
        db.add(movement)
        return

    # Unexpected serial discovered physically.
    sn = _next_serial(state, product, at)
    item = InventoryItem(product_id=product.id, serial_number=sn, in_stock=True)
    db.add(item)
    state.item_by_key[(product.id, sn)] = item
    state.available_by_product[product.id].append(sn)

    movement = StockMovement(
        movement_type=MovementType.inventory_reconcile,
        product_id=product.id,
        serial_number=sn,
        qty=1,
        unit_price=0,
        customer_name=None,
        comment='Cycle count adjustment: unexpected SN',
        created_by_user_id=operator.id,
        created_at=at,
    )
    db.add(movement)


def _apply_admin_edits(
    db: Session,
    rng: random.Random,
    products: list[Product],
    start_day: date,
    days: int,
    admin: User,
) -> int:
    edits = 0
    months: list[date] = []
    current = date(start_day.year, start_day.month, 1)
    end_day = start_day + timedelta(days=days)
    while current <= end_day:
        months.append(current)
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)

    for month_start in months:
        for _ in range(2):
            product = rng.choice(products)
            old = {
                'sell_price': float(product.sell_price),
                'min_sell_price': float(product.min_sell_price),
                'min_threshold': int(product.min_threshold),
            }

            factor = rng.uniform(0.97, 1.04)
            product.sell_price = round(float(product.sell_price) * factor, 2)
            product.min_sell_price = round(max(float(product.purchase_price) * 1.05, float(product.sell_price) * 0.90), 2)
            product.min_threshold = max(3, int(product.min_threshold) + rng.choice([-2, -1, 1, 2]))
            product.updated_at = _random_time(rng, month_start, 8, 17)

            new = {
                'sell_price': float(product.sell_price),
                'min_sell_price': float(product.min_sell_price),
                'min_threshold': int(product.min_threshold),
            }

            log_action(
                db,
                entity='product',
                entity_id=str(product.id),
                action='admin_edit_seed',
                old_value=old,
                new_value=new,
                username=admin.username,
                ip_address=SEED_IP,
            )
            edits += 1

    return edits


def _create_refund_requests(
    db: Session,
    state: SeedState,
    rng: random.Random,
    admin: User,
    operator: User,
    now: datetime,
) -> dict[str, int]:
    eligible = [s for s in state.sale_batches if s['created_at'] <= now - timedelta(days=14)]
    rng.shuffle(eligible)
    selected = eligible[:18]

    counts = {'pending': 0, 'approved': 0, 'rejected': 0}

    for idx, sale in enumerate(selected):
        if idx < 8:
            final_status = RefundRequestStatus.pending
        elif idx < 13:
            final_status = RefundRequestStatus.rejected
        else:
            final_status = RefundRequestStatus.approved

        requestor = operator if rng.random() < 0.80 else admin
        created_at = sale['created_at'] + timedelta(days=rng.randint(1, 9), hours=rng.randint(1, 6))
        if created_at > now - timedelta(hours=3):
            created_at = now - timedelta(hours=rng.randint(6, 30))

        row = RefundRequest(
            sale_ref=sale['sale_ref'],
            movement_ids_json=json.dumps(sale['movement_ids']),
            reason='Customer return request (seeded)',
            status=RefundRequestStatus.pending,
            requested_by_user_id=requestor.id,
            review_note='',
            created_at=created_at,
        )
        db.add(row)
        db.flush()

        log_action(
            db,
            entity='refund_request',
            entity_id=str(row.id),
            action='create',
            old_value={},
            new_value={'sale_ref': row.sale_ref, 'movement_ids': sale['movement_ids'], 'status': 'pending'},
            username=requestor.username,
            ip_address=SEED_IP,
        )

        if final_status == RefundRequestStatus.pending:
            counts['pending'] += 1
            continue

        review_at = created_at + timedelta(hours=rng.randint(2, 48))
        row.reviewed_by_user_id = admin.id
        row.reviewed_at = review_at

        if final_status == RefundRequestStatus.rejected:
            row.status = RefundRequestStatus.rejected
            row.review_note = 'Rejected after review of item condition (seeded)'
            counts['rejected'] += 1
            log_action(
                db,
                entity='refund_request',
                entity_id=str(row.id),
                action='reject',
                old_value={'status': 'pending'},
                new_value={'status': 'rejected', 'sale_ref': row.sale_ref},
                username=admin.username,
                ip_address=SEED_IP,
            )
            continue

        row.status = RefundRequestStatus.approved
        row.review_note = 'Approved and returned to stock (seeded)'
        counts['approved'] += 1

        # Execute refund by re-input of sold serials.
        for offset, movement_id in enumerate(sale['movement_ids']):
            output_move = state.output_by_id.get(int(movement_id))
            if not output_move or not output_move.serial_number:
                continue

            key = (int(output_move.product_id), output_move.serial_number)
            item = state.item_by_key.get(key)
            if not item or item.in_stock:
                continue

            item.in_stock = True
            item.sold_to = None
            item.sold_at = None
            state.available_by_product[int(output_move.product_id)].append(output_move.serial_number)

            db.add(
                StockMovement(
                    movement_type=MovementType.input,
                    product_id=int(output_move.product_id),
                    serial_number=output_move.serial_number,
                    qty=1,
                    unit_price=0,
                    customer_name=None,
                    comment=f"[refund_request:{row.id}] Approved refund return",
                    created_by_user_id=admin.id,
                    created_at=review_at + timedelta(minutes=offset),
                )
            )

        log_action(
            db,
            entity='refund_request',
            entity_id=str(row.id),
            action='approve',
            old_value={'status': 'pending'},
            new_value={'status': 'approved', 'sale_ref': row.sale_ref},
            username=admin.username,
            ip_address=SEED_IP,
        )

    return counts


def _create_threshold_suggestions(
    db: Session,
    rng: random.Random,
    products: list[Product],
    state: SeedState,
    admin: User,
    now: datetime,
) -> tuple[int, int]:
    by_pressure = sorted(
        products,
        key=lambda p: (len(state.available_by_product[p.id]) - int(p.min_threshold or 0)),
    )

    total = 0
    pending = 0
    for idx, product in enumerate(by_pressure[:24]):
        current_stock = len(state.available_by_product[product.id])
        current_threshold = int(product.min_threshold or 0)
        suggested = max(current_threshold + 2, int(round(current_threshold * rng.uniform(1.15, 1.55))))
        status = (
            ThresholdSuggestionStatus.pending
            if idx < 14
            else (ThresholdSuggestionStatus.approved if idx % 2 == 0 else ThresholdSuggestionStatus.rejected)
        )
        created_at = now - timedelta(days=rng.randint(0, 60), hours=rng.randint(0, 23))

        row = ThresholdSuggestion(
            product_id=product.id,
            current_min_threshold=current_threshold,
            suggested_min_threshold=suggested,
            reason_json=json.dumps(
                {
                    'signal': 'stock_pressure',
                    'current_stock': current_stock,
                    'threshold': current_threshold,
                    'note': 'Generated by yearly seed simulation',
                }
            ),
            model_version='seed-sim-v2',
            confidence=round(rng.uniform(0.62, 0.95), 2),
            status=status,
            created_at=created_at,
        )

        if status != ThresholdSuggestionStatus.pending:
            row.reviewed_by_user_id = admin.id
            row.reviewed_at = created_at + timedelta(days=rng.randint(1, 5))

        db.add(row)
        total += 1

        if status == ThresholdSuggestionStatus.pending:
            pending += 1
            db.add(
                Notification(
                    target_role='admin',
                    type='threshold_suggestion',
                    severity='warning',
                    title=f'Pending threshold suggestion for {product.internal_sku}',
                    payload_json=json.dumps({'product_id': product.id, 'suggested_threshold': suggested}),
                    is_read=False,
                    created_at=created_at,
                )
            )

    return total, pending


def seed_simulation(
    db: Session,
    *,
    days: int,
    random_seed: int,
    wipe_before_seed: bool,
) -> None:
    rng = random.Random(random_seed)

    Base.metadata.create_all(bind=engine)

    if wipe_before_seed:
        wipe_all_data(db, dry_run=False)

    admin, operator = _ensure_users(db)
    categories = _ensure_categories(db)
    products, _by_group = _create_products(db, categories, rng)

    state = _init_state(db)

    now = _utcnow_naive().replace(microsecond=0)
    start_day = (now - timedelta(days=max(30, days))).date()

    # Initial baseline stock in first 20 days.
    for product in products:
        threshold = int(product.min_threshold or 0)
        initial_qty = rng.randint(max(8, threshold * 2), max(14, threshold * 5))
        batches = rng.randint(2, 5)
        batch_sizes = [1] * batches
        for _ in range(initial_qty - batches):
            batch_sizes[rng.randint(0, batches - 1)] += 1

        for b_idx, batch_size in enumerate(batch_sizes):
            day_offset = rng.randint(0, 20)
            base_day = start_day + timedelta(days=day_offset)
            at = _random_time(rng, base_day, 8, 11) + timedelta(minutes=b_idx * 5)
            _restock(
                db,
                state,
                rng,
                product,
                batch_size,
                at,
                admin,
                operator,
                'Opening stock input (seed)',
            )

    demand_weights = [CATEGORY_DEMAND_WEIGHT.get(p.category, 1.0) * rng.uniform(0.9, 1.2) for p in products]

    # Daily simulation for historical range.
    for day_index in range(days):
        current_day = start_day + timedelta(days=day_index)
        is_weekend = current_day.weekday() >= 5

        # Proactive low-stock restocks.
        low_stock_products = [
            p for p in products if len(state.available_by_product[p.id]) <= max(2, int(p.min_threshold * 1.2))
        ]
        rng.shuffle(low_stock_products)
        for product in low_stock_products[: rng.randint(2, 6)]:
            restock_qty = max(int(product.min_threshold * 2), rng.randint(4, 18))
            _restock(
                db,
                state,
                rng,
                product,
                restock_qty,
                _random_time(rng, current_day, 7, 9),
                admin,
                operator,
                'Scheduled restock (seed)',
            )

        sales_count = rng.randint(4, 11) if is_weekend else rng.randint(9, 24)
        for _ in range(sales_count):
            _sell_order(db, state, rng, products, demand_weights, current_day, admin, operator)

        defect_events = rng.randint(0, 1 if is_weekend else 2)
        for _ in range(defect_events):
            _mark_defect(db, state, rng, products, current_day, admin, operator)

        if current_day.weekday() in {1, 4} and rng.random() < 0.55:
            _inventory_reconcile(db, state, rng, products, current_day, operator)

        if day_index % 45 == 0:
            db.flush()

    admin_edits = _apply_admin_edits(db, rng, products, start_day, days, admin)
    refund_counts = _create_refund_requests(db, state, rng, admin, operator, now)
    suggestion_total, suggestion_pending = _create_threshold_suggestions(db, rng, products, state, admin, now)

    # Monthly snapshot metadata.
    for m in range(12):
        snapshot_at = now - timedelta(days=30 * m)
        db.add(
            DailySnapshot(
                snapshot_date=snapshot_at,
                file_path=f"/snapshots/openstoko_snapshot_{snapshot_at.strftime('%Y_%m_%d')}.sql.gz",
            )
        )

    # Default app setting after seed (upsert-like behavior).
    timeout_setting = db.query(AppSetting).filter(AppSetting.key == 'session_timeout_minutes').first()
    if timeout_setting:
        timeout_setting.value = '120'
    else:
        db.add(AppSetting(key='session_timeout_minutes', value='120'))

    db.commit()

    product_ids = [p.id for p in products]
    total_items = db.query(InventoryItem).filter(InventoryItem.product_id.in_(product_ids)).count()
    in_stock_items = (
        db.query(InventoryItem)
        .filter(InventoryItem.product_id.in_(product_ids), InventoryItem.in_stock.is_(True))
        .count()
    )

    movement_counts = {
        row[0].value if hasattr(row[0], 'value') else str(row[0]): int(row[1])
        for row in (
            db.query(StockMovement.movement_type, func.count(StockMovement.id))
            .join(Product, Product.id == StockMovement.product_id)
            .filter(Product.id.in_(product_ids))
            .group_by(StockMovement.movement_type)
            .all()
        )
    }

    print('Realistic yearly simulation seed completed')
    print(f'Random seed: {random_seed}')
    print(f'Date range: {start_day.isoformat()} -> {now.date().isoformat()} ({days} days)')
    print(f'Users: admin={admin.username}, operator={operator.username}')
    print(f'Categories created: {len(categories)}')
    print(f'Products created: {len(products)}')
    print(f'Inventory items: total={total_items}, in_stock={in_stock_items}, sold_or_removed={total_items - in_stock_items}')
    print(
        'Movements: '
        f"input={movement_counts.get('input', 0)}, "
        f"output={movement_counts.get('output', 0)}, "
        f"defect={movement_counts.get('defect', 0)}, "
        f"inventory_reconcile={movement_counts.get('inventory_reconcile', 0)}"
    )
    print(
        'Refund requests: '
        f"pending={refund_counts['pending']}, approved={refund_counts['approved']}, rejected={refund_counts['rejected']}"
    )
    print(
        'Threshold suggestions: '
        f'total={suggestion_total}, pending={suggestion_pending}'
    )
    print(f'Admin price/threshold edits logged: {admin_edits}')


def main() -> None:
    parser = argparse.ArgumentParser(description='Seed OPENSTOKO with a realistic 1-year historical dataset.')
    parser.add_argument('--days', type=int, default=DEFAULT_HISTORY_DAYS, help='How many days back to simulate (default: 365).')
    parser.add_argument('--seed', type=int, default=DEFAULT_RANDOM_SEED, help='Random seed (default: 20260314).')
    parser.add_argument(
        '--no-wipe',
        action='store_true',
        help='Do not wipe existing data before seeding (not recommended).',
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        seed_simulation(
            db,
            days=max(30, args.days),
            random_seed=args.seed,
            wipe_before_seed=not args.no_wipe,
        )
    finally:
        db.close()


if __name__ == '__main__':
    main()
