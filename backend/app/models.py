from datetime import date, datetime
from enum import Enum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Role(str, Enum):
    admin = 'admin'
    operator = 'operator'


class MovementType(str, Enum):
    input = 'input'
    output = 'output'
    defect = 'defect'
    adjustment = 'adjustment'
    inventory_reconcile = 'inventory_reconcile'


class ABCClass(str, Enum):
    a = 'A'
    b = 'B'
    c = 'C'


class ThresholdSuggestionStatus(str, Enum):
    pending = 'pending'
    approved = 'approved'
    rejected = 'rejected'


class RefundRequestStatus(str, Enum):
    pending = 'pending'
    approved = 'approved'
    rejected = 'rejected'


class User(Base):
    __tablename__ = 'users'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[Role] = mapped_column(SAEnum(Role), default=Role.operator)
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Product(Base):
    __tablename__ = 'products'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    category: Mapped[str] = mapped_column(String(100), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey('categories.id'), nullable=True, index=True)
    brand_name: Mapped[str] = mapped_column(String(120), default='Generic', index=True)
    supplier_name: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)

    # Legacy field kept for backward compatibility with older imports/scripts.
    description: Mapped[str] = mapped_column(Text, default='')
    product_comment: Mapped[str] = mapped_column(Text, default='')
    technical_specs: Mapped[str] = mapped_column(Text, default='')
    photo_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    warehouse_location: Mapped[str] = mapped_column(String(100), default='N/A')

    factory_barcode: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    store_barcode: Mapped[str | None] = mapped_column(String(40), nullable=True, unique=True, index=True)
    internal_sku: Mapped[str] = mapped_column(String(50), unique=True, index=True)

    purchase_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    sell_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    min_sell_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    min_threshold: Mapped[int] = mapped_column(Integer, default=0, index=True)
    compatibility_group: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    compatibility_group_code: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    serials = relationship('InventoryItem', back_populates='product')


class Category(Base):
    __tablename__ = 'categories'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    unit: Mapped[str] = mapped_column(String(20), default='pcs')
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class InventoryItem(Base):
    __tablename__ = 'inventory_items'
    __table_args__ = (UniqueConstraint('product_id', 'serial_number', name='uq_product_sn'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey('products.id'), index=True)
    serial_number: Mapped[str] = mapped_column(String(100), index=True)
    in_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    sold_to: Mapped[str | None] = mapped_column(String(150), nullable=True)
    sold_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    warranty_months: Mapped[int] = mapped_column(Integer, default=24)

    product = relationship('Product', back_populates='serials')


class StockMovement(Base):
    __tablename__ = 'stock_movements'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    movement_type: Mapped[MovementType] = mapped_column(SAEnum(MovementType), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey('products.id'), index=True)
    serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    qty: Mapped[int] = mapped_column(Integer, default=1)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    customer_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    comment: Mapped[str] = mapped_column(Text, default='')
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = 'audit_logs'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity: Mapped[str] = mapped_column(String(60), index=True)
    entity_id: Mapped[str] = mapped_column(String(60), index=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    old_value: Mapped[str] = mapped_column(Text, default='')
    new_value: Mapped[str] = mapped_column(Text, default='')
    username: Mapped[str] = mapped_column(String(50), index=True)
    ip_address: Mapped[str] = mapped_column(String(45), default='unknown')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AppSetting(Base):
    __tablename__ = 'app_settings'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    value: Mapped[str] = mapped_column(String(255), default='')
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DailySnapshot(Base):
    __tablename__ = 'daily_snapshots'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    snapshot_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    file_path: Mapped[str] = mapped_column(String(255))


class MonthlyBusinessSnapshot(Base):
    __tablename__ = 'monthly_business_snapshots'
    __table_args__ = (
        UniqueConstraint('snapshot_month', name='uq_monthly_business_snapshot_month'),
        Index('idx_monthly_business_snapshot_month', 'snapshot_month'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    snapshot_month: Mapped[date] = mapped_column(Date, nullable=False)
    period_label: Mapped[str] = mapped_column(String(40), default='monthly')
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    purchased_qty: Mapped[int] = mapped_column(Integer, default=0)
    purchased_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    sold_qty: Mapped[int] = mapped_column(Integer, default=0)
    sold_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    flow_balance: Mapped[float] = mapped_column(Numeric(14, 2), default=0)

    inventory_units: Mapped[int] = mapped_column(Integer, default=0)
    inventory_value_purchase: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    total_products: Mapped[int] = mapped_column(Integer, default=0)
    total_categories: Mapped[int] = mapped_column(Integer, default=0)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ProductSubstitute(Base):
    __tablename__ = 'product_substitutes'
    __table_args__ = (
        UniqueConstraint('product_id', 'substitute_product_id', name='uq_product_substitute_pair'),
        Index('idx_product_substitutes_product', 'product_id'),
        Index('idx_product_substitutes_substitute', 'substitute_product_id'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey('products.id'), index=True)
    substitute_product_id: Mapped[int] = mapped_column(ForeignKey('products.id'), index=True)
    rank: Mapped[int] = mapped_column(Integer, default=100)
    note: Mapped[str] = mapped_column(String(255), default='')
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ThresholdSuggestion(Base):
    __tablename__ = 'threshold_suggestions'
    __table_args__ = (
        Index('idx_threshold_suggestions_product_status', 'product_id', 'status'),
        Index('idx_threshold_suggestions_status_created', 'status', 'created_at'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey('products.id'), index=True)
    current_min_threshold: Mapped[int] = mapped_column(Integer, default=0)
    suggested_min_threshold: Mapped[int] = mapped_column(Integer, default=0)
    reason_json: Mapped[str] = mapped_column(Text, default='{}')
    model_version: Mapped[str] = mapped_column(String(100), default='heuristic-v1')
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[ThresholdSuggestionStatus] = mapped_column(
        SAEnum(ThresholdSuggestionStatus),
        default=ThresholdSuggestionStatus.pending,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Notification(Base):
    __tablename__ = 'notifications'
    __table_args__ = (
        Index('idx_notifications_role_read_created', 'target_role', 'is_read', 'created_at'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_role: Mapped[str] = mapped_column(String(30), default='admin')
    type: Mapped[str] = mapped_column(String(60), index=True)
    severity: Mapped[str] = mapped_column(String(20), default='info')
    title: Mapped[str] = mapped_column(String(255), default='')
    payload_json: Mapped[str] = mapped_column(Text, default='{}')
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class RefundRequest(Base):
    __tablename__ = 'refund_requests'
    __table_args__ = (
        Index('idx_refund_requests_status_created', 'status', 'created_at'),
        Index('idx_refund_requests_sale_ref', 'sale_ref'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sale_ref: Mapped[str] = mapped_column(String(120), index=True)
    movement_ids_json: Mapped[str] = mapped_column(Text, default='[]')
    reason: Mapped[str] = mapped_column(Text, default='')
    status: Mapped[RefundRequestStatus] = mapped_column(
        SAEnum(RefundRequestStatus),
        default=RefundRequestStatus.pending,
        index=True,
    )
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    review_note: Mapped[str] = mapped_column(Text, default='')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
