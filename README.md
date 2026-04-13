# OPENSTOKO: Open-Source Warehouse Management Application

> Documentation Release: **2026-03-15** (Release Docs baseline).

OPENSTOKO is a warehouse and sales operations platform built for small and medium businesses.
It provides stock control, operator checkout, serial-number traceability, warranty tracking, and audit-safe admin management.

OPENSTOKO is a 100% free, open-source application for warehouse management. Professional warehouse management for everyone. No subscriptions or hidden fees.

## Important Disclaimer
- OPENSTOKO is intended for internal inventory operations.
- It is **not SUPTO-certified**, **not connected to NRA/NAP**, and **not Ordinance N-18 compliant** out of the box.
- Do not treat it as certified fiscal software without additional compliant integrations.

## 1. Tech Stack
- Frontend: Next.js (React)
- Backend: FastAPI (Python)
- Database: MySQL 8.4
- Orchestration: Docker Compose
- Optional DB UI: phpMyAdmin (dev profile)

## 2. Prerequisites
- Docker + Docker Compose installed
- Git installed
- Access to this repository

## 3. Installation (Docker)
1. Clone repository:
```bash
cd /dockerfs/projects
git clone https://pmalinov:${TOKEN}@github.com/pmalinov/OPENSTOKO.git 
# HTTPS:  https://github.com/pmalinov/OPENSTOKO.git
# SSH:    git@github.com:pmalinov/OPENSTOKO.git
cd OPENSTOKO && mkdir -p mysql_data
```

2. Create environment file:
```bash
cp .env.example .env
```
Edit `.env` with real credentials/secrets.

3. Start services:
```bash
docker compose up --build -d
```

4. Open application:
- App: `http://localhost:3000`
- API docs (Swagger): `http://localhost:8000/docs`
- Health endpoint: `http://localhost:8000/health`

## 4. Runtime Services (`docker-compose.yml`)
- `db`: MySQL 8.4, persistent volume at `./mysql_data`
- `backend`: FastAPI, DB retry logic on startup
- `frontend`: Next.js (dev command in container)
- `phpmyadmin`: optional profile `dev-tools`

Start phpMyAdmin only when needed:
```bash
docker compose --profile dev-tools up -d phpmyadmin
```

## 5. Screenshots (Client View)
For client-facing presentation, keep screenshots in:
- `docs/screenshots/`

Recommended files:
- `01-login-or-dashboard.png`
- `02-product-setup.png`
- `03-inventory-health.png`
- `04-history-warranty-search.png`
- `05-refund-approvals.png`

Note:
- These files are not required for runtime.
- They are used only for documentation/demo.

## 6. API Routing (Portable Configuration)
For server/domain portability, keep:
- `NEXT_PUBLIC_API_URL=/api`
- `OPENSTOKO_BACKEND_ORIGIN=http://backend:8000`

This avoids hardcoding a public IP into the frontend bundle.

## 7. Default Login
- `admin / admin123` (guaranteed on clean install)
- `operator1` is optional and can be created from Admin panel

If login fails after deployment, see section 10 (Login Recovery).

## 8. Core Functional Modules
- Role-based access (`admin`, `operator`)
- Product and category management
- Operator mode: intake/output + cart checkout
- Inventory health: Critical / Warning / Healthy
- Serial-number inventory (`inventory_items`) with warranty traceability
- Refund approval workflow (`refund_requests`)
- Audit logging (`audit_logs`) with old/new values and IP
- Excel import/export
- Barcode PNG + Label PDF generation
- EN/BG/IT localization

## 9. Data Reset and Realistic Seeding
Wipe business data (schema remains, `users` untouched):
```bash
docker compose exec backend python -m app.scripts.wipe_all_data
```

Seed realistic simulation data:
```bash
docker compose exec backend python -m app.scripts.seed_simulation
```

Custom seed options:
```bash
docker compose exec backend python -m app.scripts.seed_simulation --days 540 --seed 20270101
docker compose exec backend python -m app.scripts.seed_simulation --no-wipe
```

## 10. Uploaded Product Images
Product images are stored in runtime filesystem under:
- `backend/app/uploads/`

This folder is runtime data and is excluded from Git.

## 11. Login Recovery (Admin)
If admin password was changed/lost:
1. In `.env` set:
```bash
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_FULL_NAME=System Administrator
BOOTSTRAP_ADMIN_PASSWORD=admin123
RESET_ADMIN_PASSWORD_ON_START=true
```
2. Restart backend:
```bash
docker compose up -d --build backend
```
3. Login with `admin/admin123`.
4. Set `RESET_ADMIN_PASSWORD_ON_START=false` after recovery.

## 12. Documentation Index
- User manuals:
  - `README_EN.md`
  - `README_BG.md`
  - `README_IT.md`
- Scripts documentation: `backend/app/scripts/README.md`
- Technical docs folder: `docs/technical/`
  - `docs/technical/TECHNICAL_WORKFLOW.md`
  - `docs/technical/TECHNICAL_FILE_INDEX_BG.md`
  - `docs/technical/README_SQL_PHPMYADMIN.md`
  - `docs/technical/README_BG_USER_GUIDE.md`
  - `docs/technical/MASTER_PROJECT_BLUEPRINT.md`

## 13. Support
If you are not technical and need help with installation, deployment, or server setup, contact the author:
- GitHub: `pmalinov`
- Email: `p.m.malinov@gmail.com`
- LinkedIn: `www.linkedin.com/in/plamen-malinov-883139105`

## 14. Custom Development
If your business needs are not fully covered by the standard OPENSTOKO workflow, custom feature development is available.
Examples:
- custom dashboards/reports
- integrations with existing ERP/POS tools
- role-specific UI workflows
- data import/export automation

Contact `pmalinov` to discuss requirements and implementation scope.

## 15. License
MIT License (`LICENSE`).
