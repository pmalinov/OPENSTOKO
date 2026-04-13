import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

import pandas as pd
from sqlalchemy.orm import Session

from ..config import settings
from ..models import DailySnapshot, InventoryItem, Product


SNAPSHOT_DIR = Path('/tmp/openstoko_snapshots')


def build_snapshot(db: Session) -> str:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.utcnow()
    filename = SNAPSHOT_DIR / f'snapshot_{now.strftime("%Y%m%d_%H%M%S")}.xlsx'

    products = db.query(Product).all()
    items = db.query(InventoryItem).all()

    p_df = pd.DataFrame(
        [
            {
                'id': p.id,
                'name': p.name,
                'category': p.category,
                'sku': p.internal_sku,
                'factory_barcode': p.factory_barcode,
                'warehouse_location': p.warehouse_location,
                'purchase_price': p.purchase_price,
                'sell_price': p.sell_price,
                'min_sell_price': p.min_sell_price,
            }
            for p in products
        ]
    )
    i_df = pd.DataFrame(
        [
            {
                'product_id': i.product_id,
                'serial_number': i.serial_number,
                'in_stock': i.in_stock,
                'sold_to': i.sold_to,
                'sold_at': i.sold_at,
            }
            for i in items
        ]
    )

    with pd.ExcelWriter(filename, engine='openpyxl') as writer:
        p_df.to_excel(writer, sheet_name='products', index=False)
        i_df.to_excel(writer, sheet_name='inventory_items', index=False)

    db.add(DailySnapshot(file_path=str(filename)))
    db.commit()
    return str(filename)


def send_snapshot_email(path: str) -> None:
    if not os.path.exists(path):
        return

    message = EmailMessage()
    message['Subject'] = 'OPENSTOKO Daily Snapshot'
    message['From'] = settings.backup_email_from
    message['To'] = settings.backup_email_to
    message.set_content('Attached is your daily OPENSTOKO snapshot.')

    with open(path, 'rb') as f:
        data = f.read()
    message.add_attachment(
        data,
        maintype='application',
        subtype='vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename=os.path.basename(path),
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.send_message(message)
