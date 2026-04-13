from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Product


def generate_sku(db: Session, category: str) -> str:
    prefix = ''.join([c for c in category.upper() if c.isalpha()])[:3] or 'GEN'
    year = datetime.utcnow().year
    next_id = int((db.query(func.max(Product.id)).scalar() or 0)) + 1
    return f'{prefix}-{year}-{next_id:05d}'
