#!/usr/bin/env python3

from __future__ import annotations

import argparse
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import Base, SessionLocal, engine
from app.models import User


@dataclass(frozen=True)
class TableSpec:
    name: str
    truncate: bool = True


WIPE_ORDER: tuple[TableSpec, ...] = (
    TableSpec('stock_movements'),
    TableSpec('inventory_items'),
    TableSpec('product_substitutes'),
    TableSpec('threshold_suggestions'),
    TableSpec('notifications'),
    TableSpec('refund_requests'),
    TableSpec('audit_logs'),
    TableSpec('daily_snapshots'),
    TableSpec('monthly_business_snapshots'),
    TableSpec('app_settings'),
    TableSpec('products'),
    TableSpec('categories'),
)


def _existing_tables(db: Session) -> set[str]:
    rows = db.execute(text('SHOW TABLES')).fetchall()
    return {str(row[0]) for row in rows}


def _table_count(db: Session, table_name: str) -> int:
    return int(db.execute(text(f'SELECT COUNT(*) FROM `{table_name}`')).scalar() or 0)


def wipe_all_data(db: Session, *, dry_run: bool) -> dict[str, int]:
    Base.metadata.create_all(bind=engine)
    existing = _existing_tables(db)

    affected: dict[str, int] = {}
    for spec in WIPE_ORDER:
        if spec.name not in existing:
            continue
        affected[spec.name] = _table_count(db, spec.name)

    if dry_run:
        return affected

    db.execute(text('SET FOREIGN_KEY_CHECKS = 0'))
    try:
        for spec in WIPE_ORDER:
            if spec.name not in existing or not spec.truncate:
                continue
            db.execute(text(f'TRUNCATE TABLE `{spec.name}`'))
    finally:
        db.execute(text('SET FOREIGN_KEY_CHECKS = 1'))

    # Hard safety guard: users table is untouched by this script.
    admin_exists = db.query(User).filter(User.username == 'admin').first()
    if not admin_exists:
        raise RuntimeError('Admin user not found after wipe. Aborting to avoid lockout.')

    db.commit()
    return affected


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Wipe all OPENSTOKO business data from MySQL (schema is preserved).'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Only show what would be deleted.',
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = wipe_all_data(db, dry_run=args.dry_run)
        total_rows = sum(result.values())
        mode = 'DRY-RUN' if args.dry_run else 'EXECUTED'
        print(f'[{mode}] wiped tables: {len(result)}')
        for table_name, rows in result.items():
            print(f'  - {table_name}: {rows} rows')
        print(f'Total rows affected: {total_rows}')
        if not args.dry_run:
            print('Users table preserved. Admin account/password unchanged.')
    finally:
        db.close()


if __name__ == '__main__':
    main()
