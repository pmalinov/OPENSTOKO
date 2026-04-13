# OPENSTOKO: Technical Workflow & File Map

> Documentation Release: **2026-03-15** (Release Docs baseline).

This document explains the full technical workflow of the project: architecture, file ownership, request flows, calculations, and runtime behavior.

Related docs:

1. `README.md`
2. `README_BG_USER_GUIDE.md`
3. `TECHNICAL_FILE_INDEX_BG.md`
4. `README_SQL_PHPMYADMIN.md`
5. `README_EN.md`
6. `README_BG.md`
7. `README_IT.md`

## 0. Quick Local URLs

- Main app: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- API ReDoc: `http://localhost:8000/redoc`
- API health: `http://localhost:8000/health`
- Public license page: `http://localhost:3000/LICENSE.txt`
- phpMyAdmin (optional, if started with `--profile dev-tools`): `http://localhost:8081`

## 1. System Architecture

The application is a 3-container Docker stack (+ optional dev tool):

1. `frontend` (Next.js): UI, role-based navigation, operator/admin workflows.
2. `backend` (FastAPI): auth, business rules, movements, BI, exports, audit.
3. `db` (MySQL 8.4): persistent relational storage.
4. `phpmyadmin` (optional, profile `dev-tools`): manual SQL/admin UI for MySQL.

Main runtime entry:

- Docker: `docker-compose.yml`
- Backend app bootstrap: `backend/app/main.py`
- Frontend app bootstrap: `frontend/app/page.tsx`

## 2. Runtime Boot Sequence

When `docker compose up --build` runs:

1. MySQL starts and becomes healthy via `mysqladmin ping`.
2. FastAPI starts (`uvicorn app.main:app`).
3. On backend startup (`startup_event` in `backend/app/main.py`):
   - SQLAlchemy creates tables (`Base.metadata.create_all`).
   - Default admin user is created if missing.
   - Existing product categories are synced into `categories` table.
   - Daily snapshot scheduler is configured (`APScheduler`) if enabled.
4. Frontend starts (`next start`) and calls backend APIs.

## 3. Security, Auth, Roles

Key files:

- JWT + password hashing: `backend/app/auth.py`
- Token dependency + role guards: `backend/app/deps.py`
- Auth endpoints: `backend/app/routers/auth.py`

Flow:

1. User logs in at `POST /api/auth/login`.
2. Backend returns JWT token.
3. Frontend stores token in `localStorage` (`openstoko_token`).
4. Protected endpoints require `Authorization: Bearer <token>`.
5. Role checks:
   - `require_admin`: admin-only endpoints.
   - `require_operator_or_admin`: operator + admin endpoints.

## 4. Data Model Ownership (Backend)

All models are in `backend/app/models.py`.

Core tables:

1. `users`: system users, roles, hashed passwords.
2. `products`: master product data, pricing, barcodes, SKU.
3. `categories`: admin-managed category dictionary + unit.
4. `inventory_items`: per-serial item state (`in_stock`, `sold_to`, `sold_at`).
5. `stock_movements`: immutable movement history.
6. `audit_logs`: deep audit trace for actions.
7. `daily_snapshots`: backup history metadata.

## 5. Backend File Responsibilities

`backend/app/main.py`
- App init, CORS, router mounting, startup/shutdown hooks, scheduler.

`backend/app/config.py`
- Environment settings (DB URL, JWT config, backup SMTP config).

`backend/app/database.py`
- SQLAlchemy engine/session/base model configuration.

`backend/app/schemas.py`
- Request/response DTOs for FastAPI.

Routers:

1. `routers/auth.py`
   - Login, current user (`/auth/me`).
2. `routers/users.py`
   - User create/list + admin password reset (`PUT /users/{id}/password`).
3. `routers/products.py`
   - Product CRUD-lite operations, category management, Excel import, barcode/label generation.
4. `routers/movements.py`
   - Input/output/adjustment/defect/reconcile, quick output by qty, generated serial input.
5. `routers/reports.py`
   - XLSX exports (products, movements, audit).
6. `routers/bi.py`
   - Time Machine, Velocity, ABC, Warranty endpoints.
7. `routers/admin.py`
   - Audit log retrieval for admins.
8. `routers/health.py`
   - Health endpoint.

Services:

1. `services/audit.py`: centralized audit row writer.
2. `services/sku.py`: internal SKU generator.
3. `services/barcode.py`: Code128 PNG + label PDF generation.
4. `services/excel.py`: import parsing and export writing helpers.
5. `services/backup.py`: snapshot generation + SMTP email sending.
6. `services/bi.py`: analytics calculations.

## 6. Frontend File Responsibilities

`frontend/app/page.tsx`
- Top-level app state (`lang`, `token`) and login/dashboard switching.

`frontend/components/LoginForm.tsx`
- Login form and token retrieval.

`frontend/components/Dashboard.tsx`
- Main application UI:
  - sidebar navigation
  - role-aware tabs
  - forms + actions for all modules
  - history modal
  - help center

`frontend/lib/api.ts`
- Generic API helper with auth token support.

`frontend/lib/i18n.ts`
- Centralized text map (`bg`, `en`, `it`) for UI labels/messages/tooltips.
- Includes reusable help sections (`helpSectionsByLang`) to avoid hardcoded manual blocks in components.

`frontend/app/globals.css`
- Layout, spacing, modal styles, form labels/tooltips, responsive behavior.

## 7. End-to-End Workflow Details

### 7.1 Product Creation

Endpoint: `POST /api/products`

Checks:

1. Factory barcode must be unique.
2. Category must exist (operator cannot create categories implicitly).
3. If `internal_sku` is empty, SKU is auto-generated (`PREFIX-YEAR-ID`).
4. If `internal_sku` is provided manually, it must be unique.

Writes:

1. New `products` row.
2. Audit log with full product snapshot.

### 7.2 Category Management

Endpoints:

1. `GET /api/products/categories`
2. `POST /api/products/categories` (admin)
3. `PUT /api/products/categories/{id}` (admin)
4. `DELETE /api/products/categories/{id}` (admin, blocked if category is in use)

### 7.3 Stock Input

Modes:

1. Manual single movement (`POST /api/movements`, type=`input`)
2. Bulk serial list (`POST /api/movements/input-bulk`)
3. Auto-generated serials by qty (`POST /api/movements/input-generate`)

Auto SN generation logic (`input-generate`):

1. Prefix = custom prefix OR category-based prefix (fallback `PRD`).
2. Date part = UTC `YYYYMMDD`.
3. Time part = UTC `HHMMSS`.
4. Suffix = zero-padded auto item id.
5. Final format: `PREFIX-YYYYMMDD-HHMMSS-XXXXXX`.
6. Candidate SN is checked for uniqueness per product.
7. Loops until requested quantity is created.

### 7.4 Stock Output (Sale)

Modes:

1. Manual output with explicit serial (`POST /api/movements`, type=`output`)
2. Quick output by quantity (`POST /api/movements/output-quick`)

Quick output behavior:

1. Selects first `N` available serials for the product.
2. Creates one output movement per serial.
3. Enforces minimum sell price (`min_sell_price`).
4. Marks inventory items out of stock and stores customer/sold timestamp.
5. Sold SN can be printed as warranty label: `GET /api/movements/warranty-label/{serial_number}`.
6. Frontend shows a dedicated warranty print panel for sold serials in current session.

### 7.7 Search Priority (single search bar)

Used in product dossier open flow:

1. First exact match by factory barcode.
2. Then exact match by internal SKU.
3. Then product name match.
4. Fallback exact store barcode match.

### 7.8 i18n Runtime Behavior

1. Language is selected in `frontend/app/page.tsx`.
2. Selected `lang` is passed to `LoginForm` and `Dashboard`.
3. `texts[lang]`, `dashboardTexts[lang]`, and `helpSectionsByLang[lang]` provide localized strings.
4. Business status codes and role values remain stable (`admin`, `operator`, `pending`, etc.) while displayed labels are translated.

### 7.5 Defect Flow

1. Create defect movement (movement type `defect`).
2. Target serial is removed from stock.
3. Export defect report: `GET /api/movements/defects-report.xlsx`.

### 7.6 Inventory Reconcile

Endpoint: `POST /api/movements/inventory-reconcile`

Compares:

1. Software stock SN set.
2. Physical scan SN set.

Actions:

1. Missing serials -> auto `inventory_reconcile` with qty `-1`.
2. Unexpected serials -> auto `inventory_reconcile` with qty `+1`.
3. Always requires comment and writes audit events.

## 8. Audit Logging (Deep History)

Audit fields (`audit_logs`):

1. `entity`, `entity_id`, `action`
2. `old_value`, `new_value` (JSON strings)
3. `username`, `ip_address`, `created_at`

History UI:

1. Filter by `entity` / `username`.
2. `Info` modal shows:
   - full metadata
   - localized summary
   - old/new JSON payloads

Audit immutability:

1. The app has no endpoint for deleting `audit_logs`.
2. MySQL triggers are created to block `UPDATE`/`DELETE` on `audit_logs` when DB privileges allow it.
3. If trigger creation is not permitted in the environment, startup continues with app-level protections and audit logging.
4. Only direct privileged DB/server access can bypass these controls (outside app scope).

## 9. Professional Contact Integration

Current behavior:
1. `About OPENSTOKO` contains a working contact action (`mailto:`).
2. Contact button location: `frontend/components/Dashboard.tsx`.
3. Email value should be kept consistent with project documentation.

## 10. BI Calculation Details

Implemented in `backend/app/services/bi.py`.

### 10.1 Time Machine

- Groups output movements by year for selected month.
- Returns output quantity per year.

### 10.2 Velocity

- Uses current month output pace.
- Calculates estimated days left per product based on in/out movement counts.

### 10.3 ABC

- Revenue per product = sum(`qty * unit_price`) for output movements.
- Sort descending by revenue.
- Cumulative classification:
  - `A`: up to 80%
  - `B`: 80%-95%
  - `C`: above 95%

### 10.4 Warranty

- Finds last output movement by serial.
- Warranty end = sold date + 2 years.

## 11. Reports & Export

Endpoints:

1. `GET /api/reports/products.xlsx`
2. `GET /api/reports/movements.xlsx`
3. `GET /api/reports/audit.xlsx`

Excel helpers:

- Input parsing: `services/excel.py::parse_product_import`
- Output writing: `services/excel.py::dataframe_to_xlsx_bytes`

## 12. Backup Scheduler

Configured in `backend/app/main.py`, implemented in `services/backup.py`.

Behavior:

1. Runs daily at configured UTC hour.
2. Creates snapshot XLSX (products + inventory items).
3. Stores snapshot metadata in DB.
4. Attempts SMTP send with attachment (if SMTP server available).

## 13. Practical Ops: Run, Validate, Troubleshoot

Start:

```bash
docker compose up --build
```

Health:

```bash
curl http://localhost:8000/health
```

Inspect logs:

```bash
docker compose logs --tail=200 backend
docker compose logs --tail=200 frontend
```

OpenAPI:

```bash
http://localhost:8000/docs
```

Reset all data (schema preserved):

```bash
docker compose exec backend python -m app.scripts.wipe_all_data
```

Seed realistic historical dataset (default 365 days, auto-wipe before seed):

```bash
docker compose exec backend python -m app.scripts.seed_simulation
```

Seed custom window/seed value:

```bash
docker compose exec backend python -m app.scripts.seed_simulation --days 540 --seed 20270101
```

## 13. Current Best-Practice Decisions

1. Immutable movement ledger (no direct delete of stock history).
2. Category governance by admin only.
3. Operator-friendly quick workflows (search + qty sale + auto serial input).
4. Role-based UI and API restrictions.
5. Full audit traceability (user/time/IP/payloads).
