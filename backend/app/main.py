from pathlib import Path
import time

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import text
from sqlalchemy.orm import Session

from .auth import get_password_hash
from .config import settings
from .database import Base, SessionLocal, engine
from .models import Category, Product, Role, User
from .routers import admin, auth, bi, health, movements, products, reports, users
from .services.backup import build_snapshot, send_snapshot_email
from .services.business_summary import previous_month_first_day, upsert_monthly_snapshot

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

UPLOADS_DIR = Path(__file__).resolve().parent / 'uploads'
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount('/uploads', StaticFiles(directory=str(UPLOADS_DIR)), name='uploads')


def _wait_for_database():
    max_attempts = max(1, int(settings.db_startup_max_attempts))
    retry_seconds = max(0.5, float(settings.db_startup_retry_seconds))
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text('SELECT 1'))
            if attempt > 1:
                print(f'[startup] database is reachable after {attempt} attempts')
            return
        except SQLAlchemyError as exc:
            last_exc = exc
            print(f'[startup] waiting for database ({attempt}/{max_attempts}): {exc}')
            if attempt < max_attempts:
                time.sleep(retry_seconds)
    raise RuntimeError(f'Database is not reachable after {max_attempts} attempts: {last_exc}')


def _migrate_legacy_comment_specs(db: Session):
    marker = '\n\n[TECH_SPECS]\n'
    rows = db.query(Product).all()
    changed = False
    for row in rows:
        comment = row.product_comment or ''
        specs = row.technical_specs or ''
        if marker in comment and not specs.strip():
            head, tail = comment.split(marker, 1)
            row.product_comment = head.strip()
            row.technical_specs = tail.strip()
            changed = True
    if changed:
        db.commit()


def _ensure_product_columns(db: Session):
    existing = {row[0] for row in db.execute(text('SHOW COLUMNS FROM products')).fetchall()}

    if 'product_comment' not in existing:
        db.execute(text('ALTER TABLE products ADD COLUMN product_comment TEXT NULL'))
    if 'technical_specs' not in existing:
        db.execute(text('ALTER TABLE products ADD COLUMN technical_specs TEXT NULL'))
    if 'store_barcode' not in existing:
        db.execute(text('ALTER TABLE products ADD COLUMN store_barcode VARCHAR(40) NULL'))
    if 'min_threshold' not in existing:
        db.execute(text('ALTER TABLE products ADD COLUMN min_threshold INT NOT NULL DEFAULT 0'))
    if 'category_id' not in existing:
        db.execute(text('ALTER TABLE products ADD COLUMN category_id INT NULL'))
    if 'brand_name' not in existing:
        db.execute(text("ALTER TABLE products ADD COLUMN brand_name VARCHAR(120) NOT NULL DEFAULT 'Generic'"))
    if 'supplier_name' not in existing:
        db.execute(text('ALTER TABLE products ADD COLUMN supplier_name VARCHAR(150) NULL'))
    if 'compatibility_group' not in existing:
        db.execute(text('ALTER TABLE products ADD COLUMN compatibility_group VARCHAR(120) NULL'))
    if 'compatibility_group_code' not in existing:
        db.execute(text('ALTER TABLE products ADD COLUMN compatibility_group_code VARCHAR(100) NULL'))

    # Backfill old description into new comment field when empty.
    db.execute(
        text(
            "UPDATE products SET product_comment = description "
            "WHERE (product_comment IS NULL OR product_comment = '') "
            "AND description IS NOT NULL AND description <> ''"
        )
    )
    db.execute(text("UPDATE products SET product_comment = '' WHERE product_comment IS NULL"))
    db.execute(text("UPDATE products SET technical_specs = '' WHERE technical_specs IS NULL"))
    db.execute(text('UPDATE products SET min_threshold = 0 WHERE min_threshold IS NULL OR min_threshold < 0'))
    db.execute(text("UPDATE products SET brand_name = 'Generic' WHERE brand_name IS NULL OR brand_name = ''"))
    db.execute(
        text(
            "UPDATE products SET compatibility_group = compatibility_group_code "
            "WHERE (compatibility_group IS NULL OR compatibility_group = '') "
            "AND compatibility_group_code IS NOT NULL AND compatibility_group_code <> ''"
        )
    )
    db.execute(
        text(
            "UPDATE products SET compatibility_group_code = compatibility_group "
            "WHERE (compatibility_group_code IS NULL OR compatibility_group_code = '') "
            "AND compatibility_group IS NOT NULL AND compatibility_group <> ''"
        )
    )
    db.execute(
        text(
            "UPDATE products p "
            "JOIN categories c ON c.name = p.category "
            "SET p.category_id = c.id "
            "WHERE p.category_id IS NULL"
        )
    )

    existing_indexes = {str(row[2]) for row in db.execute(text('SHOW INDEX FROM products')).fetchall()}

    # Legacy startup code created idx_* variants for columns that are now also indexed
    # by SQLAlchemy with ix_* names. Keep only one index per column to avoid duplicate maintenance cost.
    duplicate_pairs = (
        ('ix_products_category_id', 'idx_products_category_id'),
        ('ix_products_brand_name', 'idx_products_brand_name'),
        ('ix_products_min_threshold', 'idx_products_min_threshold'),
        ('ix_products_compatibility_group', 'idx_products_compatibility_group'),
        ('ix_products_store_barcode', 'idx_products_store_barcode'),
        ('ix_products_compatibility_group_code', 'idx_products_compat_group'),
    )
    for canonical, legacy in duplicate_pairs:
        if canonical in existing_indexes and legacy in existing_indexes:
            db.execute(text(f'DROP INDEX `{legacy}` ON products'))
            existing_indexes.discard(legacy)

    def _ensure_index(index_name: str, create_sql: str, aliases: tuple[str, ...] = ()) -> None:
        names = (index_name, *aliases)
        if any(name in existing_indexes for name in names):
            return
        db.execute(text(create_sql))
        existing_indexes.add(index_name)

    _ensure_index('ix_products_category_id', 'CREATE INDEX ix_products_category_id ON products (category_id)', aliases=('idx_products_category_id',))
    _ensure_index('ix_products_brand_name', 'CREATE INDEX ix_products_brand_name ON products (brand_name)', aliases=('idx_products_brand_name',))
    _ensure_index('ix_products_supplier_name', 'CREATE INDEX ix_products_supplier_name ON products (supplier_name)', aliases=('idx_products_supplier_name',))
    _ensure_index('ix_products_min_threshold', 'CREATE INDEX ix_products_min_threshold ON products (min_threshold)', aliases=('idx_products_min_threshold',))
    _ensure_index(
        'ix_products_compatibility_group',
        'CREATE INDEX ix_products_compatibility_group ON products (compatibility_group)',
        aliases=('idx_products_compatibility_group',),
    )
    _ensure_index(
        'ix_products_compatibility_group_code',
        'CREATE INDEX ix_products_compatibility_group_code ON products (compatibility_group_code)',
        aliases=('idx_products_compat_group',),
    )
    _ensure_index(
        'ix_products_store_barcode',
        'CREATE UNIQUE INDEX ix_products_store_barcode ON products (store_barcode)',
        aliases=('idx_products_store_barcode',),
    )

    db.commit()


def _ensure_audit_immutability(db: Session):
    trigger_rows = db.execute(
        text(
            "SELECT trigger_name FROM information_schema.triggers "
            "WHERE trigger_schema = DATABASE()"
        )
    ).fetchall()
    existing = {str(row[0]) for row in trigger_rows}

    try:
        if 'trg_audit_logs_block_update' not in existing:
            db.execute(
                text(
                    "CREATE TRIGGER trg_audit_logs_block_update "
                    "BEFORE UPDATE ON audit_logs FOR EACH ROW "
                    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs are immutable'"
                )
            )
        if 'trg_audit_logs_block_delete' not in existing:
            db.execute(
                text(
                    "CREATE TRIGGER trg_audit_logs_block_delete "
                    "BEFORE DELETE ON audit_logs FOR EACH ROW "
                    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs are immutable'"
                )
            )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        # Some MySQL setups require SUPER/log_bin_trust_function_creators for trigger create.
        # Keep app startup alive and rely on app-level protections in this environment.
        print(f'[startup] audit immutability triggers skipped: {exc}')


@app.on_event('startup')
def startup_event():
    _wait_for_database()
    Base.metadata.create_all(bind=engine)

    db: Session = SessionLocal()
    try:
        _ensure_product_columns(db)
        _ensure_audit_immutability(db)
        _migrate_legacy_comment_specs(db)

        admin_exists = db.query(User).filter(User.role == Role.admin).first()
        if not admin_exists:
            db.add(
                User(
                    username=settings.bootstrap_admin_username,
                    full_name=settings.bootstrap_admin_full_name,
                    role=Role.admin,
                    hashed_password=get_password_hash(settings.bootstrap_admin_password),
                )
            )
            db.commit()
        elif settings.reset_admin_password_on_start:
            admin_exists.hashed_password = get_password_hash(settings.bootstrap_admin_password)
            admin_exists.is_active = True
            db.commit()

        existing_names = {c.name for c in db.query(Category).filter(Category.is_active.is_(True)).all()}
        product_names = {p.category for p in db.query(Product.category).distinct().all() if p.category}
        for name in sorted(product_names):
            if name not in existing_names:
                db.add(Category(name=name.strip(), unit='pcs'))
        db.commit()

        # Monthly archive snapshot: catch up previous month at startup (safe no-op if already present).
        try:
            upsert_monthly_snapshot(db, snapshot_month=previous_month_first_day(), overwrite=False)
        except Exception as exc:
            print(f'[startup] monthly snapshot catch-up skipped: {exc}')
    finally:
        db.close()

    scheduler = BackgroundScheduler(timezone='UTC')

    def run_monthly_snapshot_job():
        db_job: Session = SessionLocal()
        try:
            upsert_monthly_snapshot(db_job, snapshot_month=previous_month_first_day(), overwrite=False)
        except Exception as exc:
            print(f'[scheduler] monthly snapshot job failed: {exc}')
        finally:
            db_job.close()

    # First day of each month: archive full previous month.
    scheduler.add_job(run_monthly_snapshot_job, 'cron', day=1, hour=settings.backup_hour_utc, minute=10)

    if settings.backup_enabled:

        def run_backup_job():
            db_job: Session = SessionLocal()
            try:
                path = build_snapshot(db_job)
                try:
                    send_snapshot_email(path)
                except Exception:
                    pass
            finally:
                db_job.close()

        scheduler.add_job(run_backup_job, 'cron', hour=settings.backup_hour_utc, minute=0)

    scheduler.start()
    app.state.scheduler = scheduler


@app.on_event('shutdown')
def shutdown_event():
    scheduler = getattr(app.state, 'scheduler', None)
    if scheduler:
        scheduler.shutdown(wait=False)


app.include_router(health.router)
app.include_router(auth.router, prefix='/api')
app.include_router(users.router, prefix='/api')
app.include_router(products.router, prefix='/api')
app.include_router(movements.router, prefix='/api')
app.include_router(reports.router, prefix='/api')
app.include_router(bi.router, prefix='/api')
app.include_router(admin.router, prefix='/api')
