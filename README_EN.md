# OPENSTOKO User Guide (English)



OPENSTOKO is a warehouse and sales operations system with role-based access.

## Important Notice (Legal Disclaimer)
- This is an open-source project intended for internal inventory and warehouse operations.
- The software is **not certified fiscal software**, **not connected to NRA/NAP**, and **not compliant with Bulgarian Ordinance N-18 (SUPTO)** by default.
- Do not use it as a standalone fiscal/POS compliance system without additional certified integration.
- The author is not liable for fines, penalties, or financial losses caused by fiscal misuse.

## 1. Access
- App: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- phpMyAdmin (optional): `http://localhost:8081`

Default users on clean install:
- `admin` / `admin123` (guaranteed)
- `operator1` can be created from Admin panel

## 2. Roles
- `operator`: daily stock intake and stock output (checkout).
- `admin`: product setup, inventory control, analytics, audit, users, Data Management (import/export), refund approvals.

## 3. Language support
- English (`en`)
- Bulgarian (`bg`)
- Italian (`it`)

Language is changed from top-right dropdown.

## 4. Operator flow
1. Open `Operator`.
2. Choose mode: `Intake` or `Output`.
3. Output search priority:
- Factory barcode
- Internal SKU/code
- Product name
- Category
4. Add items to sale draft (cart).
5. Review line subtotal and grand total.
6. Confirm sale (`Checkout`).
7. Print warranty labels for sold serials.

## 5. Admin flow
In `Product Setup`, admin can edit product parameters and save them with audit trail.
Serial numbers are unique physical-unit IDs and are not edited from product setup.

For a full button-by-button menu map (what each button does after click), see:
- `docs/technical/README_BG_USER_GUIDE.md` -> section `4.6`.

## 6. Inventory Health
- `Critical`: stock <= threshold
- `Warning`: stock <= threshold * 1.2
- `Healthy`: above warning zone

## 7. Refund approvals
- Operator submits refund request from recent sales.
- Admin approves/rejects in `Refund Approvals`.
- Approved refund returns serial to stock and keeps history.

## 8. Audit and immutability
- Important actions are logged in `audit_logs`.
- Admin product edits store old/new values.
- No audit delete endpoint.
- DB-level trigger protection can block update/delete on `audit_logs`.

## 9. Support
If you are not technical and need help with installation/server setup, contact:
- GitHub: `pmalinov`
- Email: `p.m.malinov@gmail.com`

Professional profile:
- LinkedIn: `www.linkedin.com/in/plamen-malinov-883139105`

## 10. Custom Development
If your business needs additional workflows, custom development is available.
Examples: custom reports, ERP integrations, workflow automation, role-specific screens.

## 11. Related docs
- Main readme: `README.md`
- Client guides: `README_EN.md`, `README_BG.md`, `README_IT.md`
- Technical docs (admin/dev): `docs/technical/`
