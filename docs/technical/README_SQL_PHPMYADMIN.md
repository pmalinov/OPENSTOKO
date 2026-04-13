# OPENSTOKO SQL Toolkit (MySQL 8.4 / phpMyAdmin)

> Documentation Release: **2026-03-15** (Release Docs baseline).

Практически SQL справочник за текущата OPENSTOKO база (MySQL 8.4).

## 1) Достъп
Стартирай phpMyAdmin (по избор):
```bash
docker compose --profile dev-tools up -d phpmyadmin
```
Отвори: `http://localhost:8081`

Вход:
- Host: `db`
- User/Password: от `.env` (`MYSQL_USER`, `MYSQL_PASSWORD`) или root

## 2) Бърз reset + seed
```bash
docker compose exec backend python -m app.scripts.wipe_all_data
docker compose exec backend python -m app.scripts.seed_simulation
```

## 3) Схема (реално използвани таблици)
- `users`
- `categories`
- `products`
- `inventory_items`
- `stock_movements`
- `refund_requests`
- `audit_logs`
- `notifications`
- `threshold_suggestions`
- `app_settings`
- `daily_snapshots`
- `monthly_business_snapshots`

## 4) Essential SQL Queries (EN/BG/IT)

### A) Critical Stock Check
- EN: Products where in-stock units are at or below minimum threshold.
- BG: Продукти, при които наличните бройки са на/под минималния праг.
- IT: Prodotti con disponibilita uguale/inferiore alla soglia minima.

```sql
SELECT
  p.id,
  p.name,
  p.category,
  p.internal_sku,
  COUNT(i.id) AS in_stock_qty,
  p.min_threshold
FROM products p
LEFT JOIN inventory_items i
  ON i.product_id = p.id
 AND i.in_stock = 1
GROUP BY p.id, p.name, p.category, p.internal_sku, p.min_threshold
HAVING COUNT(i.id) <= p.min_threshold
ORDER BY in_stock_qty ASC, p.name ASC;
```

### B) Sales Velocity (Top 5 This Month)
- EN: Top 5 products by sold quantity in the current month.
- BG: Топ 5 продукта по продадено количество за текущия месец.
- IT: Top 5 prodotti per quantita venduta nel mese corrente.

```sql
SELECT
  p.id,
  p.name,
  p.internal_sku,
  SUM(m.qty) AS sold_qty_month
FROM stock_movements m
JOIN products p ON p.id = m.product_id
WHERE m.movement_type = 'output'
  AND DATE_FORMAT(m.created_at, '%Y-%m') = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')
GROUP BY p.id, p.name, p.internal_sku
ORDER BY sold_qty_month DESC
LIMIT 5;
```

### C) Warranty Lookup by Serial Number
- EN: Sale trace for a specific serial number.
- BG: Пълна проследимост на конкретен сериен номер.
- IT: Tracciamento completo per numero seriale specifico.

```sql
-- Replace :serial_number with a real SN
SELECT
  i.serial_number,
  p.name AS product_name,
  p.internal_sku,
  p.factory_barcode,
  i.in_stock,
  i.sold_to,
  i.sold_at,
  m.unit_price,
  m.customer_name,
  u.username AS sold_by
FROM inventory_items i
JOIN products p ON p.id = i.product_id
LEFT JOIN stock_movements m
  ON m.product_id = i.product_id
 AND m.serial_number = i.serial_number
 AND m.movement_type = 'output'
LEFT JOIN users u ON u.id = m.created_by_user_id
WHERE i.serial_number = :serial_number
ORDER BY m.created_at DESC;
```

### D) Audit Trail: Last 10 Manual Admin Edits
- EN: Last admin product edits with old/new values.
- BG: Последни 10 админ редакции на продукти със стари/нови стойности.
- IT: Ultime 10 modifiche admin su prodotti con valori old/new.

```sql
SELECT
  a.id,
  a.created_at,
  a.username,
  a.entity,
  a.action,
  a.entity_id,
  a.old_value,
  a.new_value
FROM audit_logs a
JOIN users u ON u.username = a.username
WHERE u.role = 'admin'
  AND a.entity = 'product'
  AND a.action IN ('admin_edit', 'min_threshold_update', 'pricing_update')
ORDER BY a.created_at DESC
LIMIT 10;
```

### E) Financial Health (Current Inventory Value)
- EN: Inventory valuation by purchase/sell prices.
- BG: Стойност на текущата наличност по покупни/продажни цени.
- IT: Valore inventario corrente per prezzo acquisto/vendita.

```sql
SELECT
  ROUND(SUM(COALESCE(s.in_stock_qty, 0) * p.purchase_price), 2) AS stock_value_purchase,
  ROUND(SUM(COALESCE(s.in_stock_qty, 0) * p.sell_price), 2) AS stock_value_sell,
  SUM(COALESCE(s.in_stock_qty, 0)) AS total_units
FROM products p
LEFT JOIN (
  SELECT product_id, COUNT(*) AS in_stock_qty
  FROM inventory_items
  WHERE in_stock = 1
  GROUP BY product_id
) s ON s.product_id = p.id;
```

## 5) Additional Business Analytics

### Daily Revenue (Last 30 Days)
```sql
SELECT
  DATE(m.created_at) AS day,
  ROUND(SUM(m.qty * m.unit_price), 2) AS revenue,
  SUM(m.qty) AS units_sold
FROM stock_movements m
WHERE m.movement_type = 'output'
  AND m.created_at >= (CURRENT_DATE - INTERVAL 30 DAY)
GROUP BY DATE(m.created_at)
ORDER BY day DESC;
```

### Sales by Date Range
```sql
-- Replace :date_from and :date_to (YYYY-MM-DD)
SELECT
  p.id,
  p.name,
  p.internal_sku,
  SUM(m.qty) AS sold_qty,
  ROUND(SUM(m.qty * m.unit_price), 2) AS revenue
FROM stock_movements m
JOIN products p ON p.id = m.product_id
WHERE m.movement_type = 'output'
  AND m.created_at >= :date_from
  AND m.created_at < DATE_ADD(:date_to, INTERVAL 1 DAY)
GROUP BY p.id, p.name, p.internal_sku
ORDER BY revenue DESC;
```

### Products Without Sales in Last 90 Days
```sql
SELECT
  p.id,
  p.name,
  p.internal_sku,
  MAX(m.created_at) AS last_sale_at
FROM products p
LEFT JOIN stock_movements m
  ON m.product_id = p.id
 AND m.movement_type = 'output'
GROUP BY p.id, p.name, p.internal_sku
HAVING last_sale_at IS NULL OR last_sale_at < (NOW() - INTERVAL 90 DAY)
ORDER BY last_sale_at ASC;
```

### Refund Requests Pending Approval
```sql
SELECT
  r.id,
  r.sale_ref,
  r.status,
  r.reason,
  r.created_at,
  u.username AS requested_by
FROM refund_requests r
JOIN users u ON u.id = r.requested_by_user_id
WHERE r.status = 'pending'
ORDER BY r.created_at DESC;
```

### Product Change History (Single Product)
```sql
-- Replace :product_id
SELECT
  a.id,
  a.created_at,
  a.username,
  a.action,
  a.old_value,
  a.new_value
FROM audit_logs a
WHERE a.entity = 'product'
  AND a.entity_id = :product_id
ORDER BY a.created_at DESC
LIMIT 100;
```

## 6) Health Checks

### Duplicate Unique Keys (must return 0 rows)
```sql
SELECT factory_barcode, COUNT(*) c
FROM products
GROUP BY factory_barcode
HAVING c > 1;

SELECT internal_sku, COUNT(*) c
FROM products
GROUP BY internal_sku
HAVING c > 1;

SELECT store_barcode, COUNT(*) c
FROM products
WHERE store_barcode IS NOT NULL AND store_barcode <> ''
GROUP BY store_barcode
HAVING c > 1;
```

### Invalid Prices
```sql
SELECT id, name, internal_sku, purchase_price, sell_price, min_sell_price
FROM products
WHERE purchase_price < 0
   OR sell_price < 0
   OR min_sell_price < 0
   OR min_sell_price > sell_price;
```

### Serial Consistency: sold but still in stock
```sql
SELECT id, product_id, serial_number, in_stock, sold_at
FROM inventory_items
WHERE sold_at IS NOT NULL AND in_stock = 1
LIMIT 200;
```

## 7) Support and Consultations
Техническа поддръжка (инсталация, конфигурация, SQL диагностика):
- Email: `p.m.malinov@gmail.com`

Професионален контакт и нови проекти:
- LinkedIn: `www.linkedin.com/in/plamen-malinov-883139105`
