from io import BytesIO

import barcode
from barcode.writer import ImageWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def generate_code128_png(value: str) -> bytes:
    code = barcode.get('code128', value, writer=ImageWriter())
    output = BytesIO()
    code.write(output)
    return output.getvalue()


def generate_label_pdf(code_value: str, product_name: str) -> bytes:
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(70 * mm, 40 * mm))
    c.setFont('Helvetica-Bold', 10)
    c.drawString(8 * mm, 33 * mm, product_name[:35])
    c.setFont('Helvetica', 8)
    c.drawString(8 * mm, 29 * mm, code_value)

    barcode_png = generate_code128_png(code_value)
    barcode_img = ImageReader(BytesIO(barcode_png))
    c.drawImage(barcode_img, 8 * mm, 10 * mm, width=52 * mm, height=16 * mm)
    c.showPage()
    c.save()
    return stream.getvalue()


def generate_warranty_label_pdf(
    serial_number: str,
    product_name: str,
    customer_name: str | None,
    sold_at_text: str | None,
    sale_ref: str | None,
) -> bytes:
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(90 * mm, 55 * mm))

    c.setFont('Helvetica-Bold', 12)
    c.drawString(7 * mm, 49 * mm, 'Warranty Label')
    c.setFont('Helvetica-Bold', 10)
    c.drawString(7 * mm, 44 * mm, product_name[:42])

    c.setFont('Helvetica', 8)
    c.drawString(7 * mm, 39.5 * mm, f'Serial: {serial_number[:60]}')
    c.drawString(7 * mm, 35.5 * mm, f'Client: {(customer_name or "Walk-in")[:40]}')
    c.drawString(7 * mm, 31.5 * mm, f'Sold at: {(sold_at_text or "-")[:40]}')
    c.drawString(7 * mm, 27.5 * mm, f'Sale ref: {(sale_ref or "-")[:40]}')

    barcode_png = generate_code128_png(serial_number)
    barcode_img = ImageReader(BytesIO(barcode_png))
    c.drawImage(barcode_img, 7 * mm, 8 * mm, width=76 * mm, height=16 * mm)

    c.setStrokeColor(colors.HexColor('#B5C8C2'))
    c.rect(5 * mm, 5 * mm, 80 * mm, 45 * mm, stroke=1, fill=0)

    c.showPage()
    c.save()
    return stream.getvalue()
