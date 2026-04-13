# OPENSTOKO Scripts (Operational)

> Documentation Release: **2026-03-15** (Release Docs baseline).

This folder contains operational scripts for reset/seeding in existing OPENSTOKO deployments.

## 1) `wipe_all_data.py`
Purpose:
- Wipe business data while preserving schema and system access.

Safety rules:
- `users` table is never touched.
- Admin credentials remain available.

Run:
```bash
docker compose exec backend python -m app.scripts.wipe_all_data --dry-run
docker compose exec backend python -m app.scripts.wipe_all_data
```

## 2) `seed_simulation.py`
Purpose:
- Generate realistic historical data (products, inventory items, movements, refunds, audit).

Default behavior:
- Executes wipe first, then seeds dataset.

Run:
```bash
docker compose exec backend python -m app.scripts.seed_simulation
docker compose exec backend python -m app.scripts.seed_simulation --days 540 --seed 20270101
docker compose exec backend python -m app.scripts.seed_simulation --no-wipe
```

## 3) Operational Notes
- Use scripts only against the active OPENSTOKO database from `.env`.
- Prefer running from project root directory.
- Verify DB container health before execution.

## 4) Support and Consultations
If you need help with installation, server setup, or data migration:
- Technical support email: `p.m.malinov@gmail.com`
- LinkedIn: `www.linkedin.com/in/plamen-malinov-883139105`
