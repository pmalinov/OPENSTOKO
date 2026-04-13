from datetime import datetime

from pydantic import BaseModel, Field

from .models import MovementType, Role


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'


class UserCreate(BaseModel):
    username: str
    full_name: str
    role: Role
    password: str = Field(min_length=6)


class UserPasswordUpdate(BaseModel):
    password: str = Field(min_length=6)


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role: Role
    is_active: bool

    class Config:
        from_attributes = True


class ProductCreate(BaseModel):
    name: str
    category: str
    brand_name: str = 'Generic'
    supplier_name: str | None = None
    description: str = ''
    product_comment: str = ''
    technical_specs: str = ''
    photo_url: str | None = None
    warehouse_location: str
    factory_barcode: str
    store_barcode: str | None = None
    internal_sku: str | None = None
    purchase_price: float
    sell_price: float
    min_sell_price: float
    min_threshold: int = Field(ge=0)
    compatibility_group: str | None = None
    compatibility_group_code: str | None = None


class ProductOut(BaseModel):
    id: int
    name: str
    category: str
    category_id: int | None = None
    brand_name: str = 'Generic'
    supplier_name: str | None = None
    description: str
    product_comment: str
    technical_specs: str
    photo_url: str | None
    warehouse_location: str
    factory_barcode: str
    store_barcode: str | None
    internal_sku: str
    purchase_price: float
    sell_price: float
    min_sell_price: float
    min_threshold: int = 0
    compatibility_group: str | None = None
    compatibility_group_code: str | None = None
    current_stock: int = 0
    inventory_health: str = 'healthy'

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    unit: str = Field(default='pcs', min_length=1, max_length=20)


class CategoryUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    unit: str = Field(default='pcs', min_length=1, max_length=20)


class CategoryOut(BaseModel):
    id: int
    name: str
    unit: str
    is_active: bool

    class Config:
        from_attributes = True


class MovementCreate(BaseModel):
    movement_type: MovementType
    product_id: int
    serial_number: str | None = None
    qty: int = 1
    unit_price: float = 0
    customer_name: str | None = None
    comment: str = ''


class MovementOut(BaseModel):
    id: int
    movement_type: MovementType
    product_id: int
    created_by_user_id: int
    serial_number: str | None
    qty: int
    unit_price: float
    customer_name: str | None
    comment: str
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogOut(BaseModel):
    id: int
    entity: str
    entity_id: str
    action: str
    old_value: str
    new_value: str
    username: str
    ip_address: str
    created_at: datetime

    class Config:
        from_attributes = True
