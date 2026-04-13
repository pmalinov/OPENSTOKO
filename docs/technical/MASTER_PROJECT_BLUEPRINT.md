# OPENSTOKO Master Project Blueprint (Single-Session Rebuild Prompt)

> Documentation Release: **2026-03-15** (Release Docs baseline).

Use this as a **master prompt** to rebuild OPENSTOKO from scratch in one session.
The target is to reproduce the current behavior, architecture, and UX logic.
Project author: **Plamen Malinov**.

---

## MASTER PROMPT (give this to a new AI)

You are building **OPENSTOKO**: a warehouse + POS + traceability system with role-based access, serial-level inventory, warranty labels, refund approval workflow, and EN/BG/IT UI.
Primary technical support contact: `p.m.malinov@gmail.com`.
Professional profile for project collaboration: `www.linkedin.com/in/plamen-malinov-883139105`.

### 1) Tech Stack (exact versions)
- Backend runtime: **Python 3.12** (Docker base: `python:3.12-slim`)
- API framework: **FastAPI 0.116.1**
- ASGI server: **uvicorn[standard] 0.35.0**
- ORM: **SQLAlchemy 2.0.43**
- DB driver: **PyMySQL 1.1.1**
- Auth/JWT: `python-jose[cryptography] 3.4.0`, `passlib[bcrypt] 1.7.4`, `bcrypt 4.0.1`
- File/image/PDF/data: `python-multipart 0.0.20`, `Pillow 11.3.0`, `reportlab 4.4.3`, `pandas 2.3.1`, `openpyxl 3.1.5`, `python-barcode 0.15.1`
- Scheduler: `apscheduler 3.11.0`
- Frontend: **Next.js 14.2.31** + **React 18.3.1** + TypeScript 5.8.3
- DB: **MySQL 8.4**
- Containers: **Docker Compose** (services: db, backend, frontend, phpMyAdmin)

### 2) Final Database Schema (MySQL)
Implement these tables and relationships:

#### `users`
- `id` PK
- `username` unique/index
- `full_name`
- `role` enum(`admin`,`operator`)
- `hashed_password`
- `is_active`
- `created_at`

#### `categories`
- `id` PK
- `name` unique/index
- `unit`
- `is_active`
- `created_at`

#### `products`
- `id` PK
- `name` index
- `category` index (legacy display field)
- `category_id` FK -> `categories.id` (indexed)
- `brand_name` index
- `description` (legacy)
- `product_comment`
- `technical_specs`
- `photo_url`
- `warehouse_location`
- `factory_barcode` unique/index
- `store_barcode` unique/index nullable
- `internal_sku` unique/index
- prices: `purchase_price`, `sell_price`, `min_sell_price`
- `min_threshold` index
- `compatibility_group` index nullable
- `compatibility_group_code` index nullable (legacy mirror)
- `created_at`, `updated_at`

#### `inventory_items` (single physical units / serial tracking)
- `id` PK
- `product_id` FK -> `products.id` (indexed)
- `serial_number` (indexed)
- `in_stock` boolean
- `sold_to`
- `sold_at`
- `warranty_months`
- unique constraint: (`product_id`, `serial_number`)

#### `stock_movements` (ledger)
- `id` PK
- `movement_type` enum(`input`,`output`,`defect`,`adjustment`,`inventory_reconcile`) indexed
- `product_id` FK -> `products.id` indexed
- `serial_number` indexed nullable
- `qty`
- `unit_price`
- `customer_name`
- `comment`
- `created_by_user_id` FK -> `users.id`
- `created_at`

#### `audit_logs` (append-only)
- `id` PK
- `entity`, `entity_id`, `action` indexed
- `old_value`, `new_value`
- `username` indexed
- `ip_address`
- `created_at`
- Add DB triggers blocking UPDATE/DELETE when privileges allow.

#### `product_substitutes`
- `id` PK
- `product_id` FK -> `products.id`
- `substitute_product_id` FK -> `products.id`
- `rank`
- `note`
- `created_by_user_id` FK -> `users.id` nullable
- `created_at`
- unique pair (`product_id`,`substitute_product_id`)

#### `threshold_suggestions`
- `id` PK
- `product_id` FK -> `products.id`
- `current_min_threshold`, `suggested_min_threshold`
- `reason_json`, `model_version`, `confidence`
- `status` enum(`pending`,`approved`,`rejected`) indexed
- `created_at`
- `reviewed_by_user_id` FK -> `users.id` nullable
- `reviewed_at`

#### `notifications`
- `id` PK
- `target_role`
- `type` index
- `severity`
- `title`
- `payload_json`
- `is_read` index
- `created_at` index

#### `refund_requests`
- `id` PK
- `sale_ref` index
- `movement_ids_json`
- `reason`
- `status` enum(`pending`,`approved`,`rejected`) index
- `requested_by_user_id` FK -> `users.id`
- `reviewed_by_user_id` FK -> `users.id` nullable
- `review_note`
- `created_at` index
- `reviewed_at`

#### Support tables
- `app_settings` (`key` unique/index, `value`)
- `daily_snapshots` (`snapshot_date` index, `file_path`)

### 3) Core Logic Requirements

#### A) POS Cart (`cashierCart`) + Checkout (exclusive sales flow)
- Frontend cart holds multi-line items: `product_id`, `qty`, `unit_price`, metadata.
- Pre-checkout validation:
  - qty > 0
  - available serial-level stock is enough
  - `unit_price >= min_sell_price`
  - block checkout if oversell detected
- Backend endpoint: `POST /api/movements/checkout`
- Checkout behavior:
  - Allocate exact in-stock serials per line (FIFO by `inventory_items.id`)
  - Create one `output` movement per sold serial
  - Produce one `sale_ref` for the whole cart transaction
  - Write one `audit_logs` record with entity `sale_transaction`, including totals, movement IDs, sold serials
  - Return `{ sale_ref, movement_ids, serial_numbers }`

#### B) Warranty + Serialization
- Every physical unit is tracked in `inventory_items.serial_number`.
- Input flow can auto-generate serials:
  - Format: `[PREFIX]-[YYYYMMDD]-[HHMMSS]-[AutoIncrementId]`
  - Prefix derived from category/product.
- After successful sale, show sold serial list and allow:
  - Print each warranty label
  - Batch print all warranties for last checkout
- Backend endpoint: `GET /api/movements/warranty-label/{serial_number}`
- Generate PDF with serial barcode (Code128) + product/customer/date info.

#### C) Multi-role access control
- Roles: `admin`, `operator`.
- Operator:
  - Can do stock input/output, search, view stock/price/min_threshold/substitutes
  - Cannot edit purchase price, margin, or threshold
- Admin:
  - Full product edits (`name`, `brand_name`, `compatibility_group`, prices, threshold)
  - User/session/config management
  - Refund approval/rejection
- Mandatory audit:
  - All admin manual edits must be logged with old/new values + actor + timestamp + IP.

#### D) i18n (EN/BG/IT)
- Centralized dictionary in frontend (`frontend/lib/i18n.ts`).
- No hardcoded user-facing strings in components.
- Translate labels, buttons, table headers, tooltips, status texts.
- Keep internal logic values stable (`admin`, `operator`, enum/status codes), translate only display text.

### 4) Feature-Specific Requirements

#### A) Admin Support Banner
- Show a slim, non-intrusive support/info banner only for admins.
- Monthly visibility logic may use localStorage key per user.
- Banner purpose: operational reminders and support channel visibility.
- Actions:
  - `Contact support` -> open contact email in default client
  - `Hide for 1 month` -> store timestamp now and hide immediately

#### B) Contact Button
- Must work as: `mailto:p.m.malinov@gmail.com`.
- Opens default email client.

#### C) Compatibility Grouping (universal substitutes)
- `products.compatibility_group` links equivalents across brands.
- Search flow:
  1. Search by name/keyword -> list brands/results
  2. Select product -> show details
  3. Auto-load alternatives from same compatibility group
- If no explicit links, fallback to same group; if no group, fallback to same category.
- Must support non-automotive domains (example `DDR4_3200MHz_16GB`).

### 5) Required API Surface (minimum)
- Auth:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `GET /api/auth/session-policy`
- Products:
  - `GET /api/products`
  - `POST /api/products`
  - `PUT /api/products/{id}/admin-edit`
  - `GET /api/products/dossier?code=` (search priority: factory barcode -> internal SKU -> name fallback -> store barcode)
  - `GET /api/products/{id}/operator-card`
  - `GET /api/products/inventory-health`
  - universal compatibility search endpoints (`/api/products/search`, `/api/products/{id}/alternatives`, `/api/products/compatibility/{group}`)
- Movements:
  - `POST /api/movements`
  - `POST /api/movements/input-generated`
  - `POST /api/movements/input-bulk`
  - `GET /api/movements/available-serials/{product_id}`
  - `POST /api/movements/checkout`
  - `GET /api/movements/recent-sales`
  - refund request/review endpoints
  - `GET /api/movements/warranty-label/{serial_number}`
- BI/Reports/Admin:
  - warranty check endpoint
  - audit log endpoint
  - user/session policy endpoints

### 6) Frontend UX Structure
- Main dashboard component with tabs and strict role visibility:
  - Operator-focused: cashier flow, scan/search, cart, checkout
  - Admin-focused: products, inventory, analytics, reports, history, refund approvals, admin tools
- Disable buttons while requests are in-flight.
- Keep table layouts readable on narrow screens with horizontal scroll wrappers.

### 7) Repository File Structure (target)
Use this structure:

```text
OPENSTOKO/
  .env
  .env.example
  docker-compose.yml
  docker-compose.dev.yml
  README.md
  README_EN.md
  README_BG.md
  README_IT.md
  README_BG_USER_GUIDE.md
  README_SQL_PHPMYADMIN.md
  TECHNICAL_WORKFLOW.md
  TECHNICAL_FILE_INDEX_BG.md

  backend/
    Dockerfile
    requirements.txt
    app/
      __init__.py
      main.py
      config.py
      database.py
      models.py
      schemas.py
      auth.py
      deps.py
      routers/
        __init__.py
        auth.py
        users.py
        products.py
        movements.py
        reports.py
        bi.py
        admin.py
        health.py
      services/
        audit.py
        backup.py
        barcode.py
        bi.py
        excel.py
        sku.py
        universal_search.py
      scripts/
        __init__.py
        wipe_all_data.py
        seed_simulation.py
      uploads/
        products/

  frontend/
    Dockerfile
    package.json
    package-lock.json
    tsconfig.json
    next.config.js
    next-env.d.ts
    app/
      layout.tsx
      page.tsx
      globals.css
    components/
      Dashboard.tsx
      LoginForm.tsx
    lib/
      api.ts
      i18n.ts
    public/
      LICENSE.txt
```

### 8) Docker + Deployment Logic

#### Compose (current local orchestration)
- `db` MySQL 8.4 with healthcheck and persistent volume `./mysql_data`
- `backend` depends on healthy DB, has restart policy and `/health` check
- `frontend` depends on healthy backend, serves Next app
- optional `phpmyadmin`

#### Backend Dockerfile
- Base `python:3.12-slim`
- Install requirements
- Copy app
- Expose 8000
- Run uvicorn

#### Frontend Dockerfile
- Base `node:20-alpine`
- Install dependencies
- Build Next
- Expose 3000
- `npm run start`

#### Startup resilience requirement
- Backend startup must retry DB connection before `create_all()`.
- Keep `pool_pre_ping=True` in SQLAlchemy engine.
- Compose services use `restart: unless-stopped`.

### 9) Security, Audit, and Data Integrity Rules
- No UI/API delete for audit logs.
- Block audit log UPDATE/DELETE via DB triggers where possible.
- Keep app-level protections even if trigger creation not permitted.
- Role checks on every sensitive endpoint.
- Immutable movement ledger style: add records instead of destructive edits.

### 10) Seed + Reset Workflow
- Provide reset SQL script to drop/recreate schema and seed demo data.
- Seed data must include:
  - Multi-category products
  - Multi-brand compatibility groups (3-5 alternatives per group)
  - Inventory serial records
  - Recent sales with real `sale_ref` examples
- Include admin/operator default accounts for local demo.

### 11) Acceptance Criteria (must pass)
- Login works for admin/operator.
- Operator can sell only through cart checkout flow.
- Checkout returns sale_ref + sold serials and updates stock correctly.
- Warranty PDF generation works for sold serials.
- Admin edit actions are audited.
- Refund request + admin approve/reject flow works end-to-end.
- Support banner appears only for admin and respects 30-day hide logic.
- Contact button opens `mailto:p.m.malinov@gmail.com`.
- EN/BG/IT switching updates all UI text.

### 12) Documentation Deliverables (corporate tone)
- Update all project readmes to match final architecture and Docker flow:
  - `README.md`
  - `README_EN.md`, `README_BG.md`, `README_IT.md`
  - `README_BG_USER_GUIDE.md`
  - `README_SQL_PHPMYADMIN.md`
  - `backend/app/scripts/README.md`
- Remove personal sponsorship phrasing from documentation.
- Add a clear **Support and Consultations** section for non-technical users:
  - email-based installation/server assistance
  - contact escalation path
- Add a **Custom Development** section:
  - tailored features and integrations per business process
  - role-specific workflows and reporting extensions
- Keep email for technical support and LinkedIn for professional collaboration/new projects.

---

## Notes for the implementing AI
- Reproduce behavior first, then optimize.
- Keep backward-compatible fields (`description`, `compatibility_group_code`) because current data/scripts use them.
- Use the existing naming conventions and endpoint paths above for compatibility with current frontend logic.
