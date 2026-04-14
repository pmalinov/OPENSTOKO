# OPENSTOKO: Технически Индекс На Файловете (Български)



Този документ е „карта на проекта“ за разработчици и администратори.
Цел: бързо да се ориентираш кой файл къде е, за какво служи и какво управлява.

## 1. Корен на проекта

`/home/pmalinov/repositories/OPENSTOKO`

Основни файлове:

1. `docker-compose.yml`
- Главен runtime за всички услуги (`db`, `backend`, `frontend`, `phpmyadmin`).
- Дефинира портове, env променливи и mount-ове.

2. `docker-compose.dev.yml`
- Dev override (основно за frontend hot reload).

3. `.env.example`
- Примерни конфигурации за локална среда.

4. `.env`
- Реални настройки за текущата инсталация (не качвай в публично repo).

5. `README.md`
- Основен проектен README (start, архитектура, линкове).

6. `README_BG_USER_GUIDE.md`
- Нетехническо ръководство за оператор/админ.

7. `README_EN.md`
- Кратко потребителско ръководство на английски.

8. `README_BG.md`
- Кратко потребителско ръководство на български.

9. `README_IT.md`
- Кратко потребителско ръководство на италиански.

10. `README_SQL_PHPMYADMIN.md`
- SQL playbook за проверка и диагностика на данни.

11. `TECHNICAL_WORKFLOW.md`
- Технически workflow на процесите.

12. `TECHNICAL_FILE_INDEX_BG.md`
- Този файл: детайлна карта на файловете.

13. `README_DEV_GUIDE_BG.md`
- Ръководство за разработчици за UI модификации (бутони, функционалност, позициониране).

## 2. Backend

Път: `backend/`

### 2.1 Системни файлове

1. `backend/Dockerfile`
- Контейнер за FastAPI (Python 3.12 slim).

2. `backend/requirements.txt`
- Python зависимости (FastAPI, SQLAlchemy, MySQL driver, reportlab, barcode и др.).

### 2.2 Приложение

Път: `backend/app/`

1. `main.py`
- Bootstrap на приложението.
- CORS, router include, uploads static mount.
- Startup задачи:
  - `Base.metadata.create_all`
  - schema migrations за legacy колони/индекси
  - audit immutability trigger-и
  - bootstrap admin логика
  - синхронизация категории
  - backup scheduler

2. `config.py`
- Pydantic settings от `.env`.
- JWT, DB URL, backup SMTP, bootstrap admin.

3. `database.py`
- SQLAlchemy engine/session/base.

4. `models.py`
- ORM модели и релации:
  - `users`
  - `products`
  - `categories`
  - `inventory_items`
  - `stock_movements`
  - `audit_logs`
  - `daily_snapshots`
  - `product_substitutes`
  - `threshold_suggestions`
  - `notifications`

5. `schemas.py`
- DTO/Pydantic модели за request/response.

6. `auth.py`
- Password hashing и JWT helpers.

7. `deps.py`
- FastAPI dependencies и role guard-ове (`admin`, `operator`).

### 2.3 API Routers

Път: `backend/app/routers/`

1. `health.py`
- `GET /health`.

2. `auth.py`
- Login/logout/me endpoint-и.

3. `users.py`
- Потребители, роли, reset password (admin).

4. `products.py`
- CRUD/листинг на продукти.
- Категории.
- Operator search.
- Dossier.
- Substitutes/compatibility group.
- Barcode/label endpoint-и за продукт.

5. `movements.py`
- Core складова логика:
  - input/output/defect/adjustment/reconcile
  - quick output
  - checkout
  - refund
  - serial generation
  - warranty label by serial (`/movements/warranty-label/{serial_number}`)

6. `reports.py`
- XLSX експорти.

7. `bi.py`
- BI endpoint-и: time machine, velocity, ABC, warranty lookup.

8. `admin.py`
- Одит логове, сесийни настройки, admin-only помощни endpoint-и.

9. `__init__.py`
- Router registry export.

### 2.4 Services

Път: `backend/app/services/`

1. `audit.py`
- Централизиран запис в `audit_logs`.

2. `barcode.py`
- Code128 PNG генерация.
- Продуктов label PDF.
- Гаранционен label PDF по SN.

3. `excel.py`
- Парсване на Excel import.
- Генерация на Excel export.

4. `sku.py`
- Вътрешни SKU generator helper-и.

5. `bi.py`
- Бизнес аналитика и изчисления.

6. `backup.py`
- Daily snapshot файл и изпращане по SMTP.

7. `universal_search.py`
- Универсална търсачка с cross-reference логика.

### 2.5 Скриптове

Път: `backend/app/scripts/`

1. `seed_simulation.py`
- Генерира реалистичен dataset за 1 година назад.
- По подразбиране прави wipe на данните и после:
  - създава категории/продукти
  - генерира SN за всяка физическа бройка
  - симулира вход/изход/дефекти/инвентарни корекции
  - симулира сторно заявки (`pending/approved/rejected`)
  - създава threshold suggestions + notifications

2. `wipe_all_data.py`
- Пълен data wipe на всички бизнес таблици (схемата остава).
- Има `--dry-run`.
- Никога не пипа таблица `users` и не променя паролата на `admin`.

## 3. Frontend

Път: `frontend/`

### 3.1 Системни файлове

1. `frontend/Dockerfile`
- Контейнер за Next.js.

2. `frontend/package.json`
- npm scripts и зависимости.

3. `frontend/next.config.js`
- Next.js конфигурация.

4. `frontend/tsconfig.json`
- TypeScript конфигурация.

### 3.2 App и компоненти

1. `frontend/app/layout.tsx`
- Root layout.

2. `frontend/app/page.tsx`
- Entry point за UI.
- Проверка за token и превключване Login/Dashboard.

3. `frontend/components/LoginForm.tsx`
- Login UI и submit към backend.

4. `frontend/components/Dashboard.tsx`
- Основна бизнес логика на интерфейса:
  - role-based tabs
  - operator режими (input/output)
  - search flows (barcode/code/name/category)
  - inventory health и threshold UX
  - substitutes UI
  - recent sales
  - warranty print buttons по SN
  - admin панели

5. `frontend/lib/api.ts`
- HTTP helper към backend (`NEXT_PUBLIC_API_URL`).

6. `frontend/lib/i18n.ts`
- Централизиран речник за текстове и локализация (`bg`, `en`, `it`).
- Включва и `helpSectionsByLang` за структурирания Help екран без hardcoded блокове в компонента.

7. `frontend/app/globals.css`
- Глобални стилове и UI компоненти.

## 4. База Данни И Данни

1. `mysql_data/`
- Persistent volume за MySQL data files.
- Не се редактира ръчно.

2. MySQL schema
- Създава се автоматично от ORM + startup migration логика.
- За reset/seed се ползват само `wipe_all_data.py` и `seed_simulation.py`.

## 5. Къде да променяш какво (бърз cheat-sheet)

1. Искаш нов API endpoint:
- Добави го в съответния router в `backend/app/routers/`.
- Добави schema в `backend/app/schemas.py` при нужда.

2. Искаш нова бизнес валидация:
- Най-често в `routers/movements.py` или `routers/products.py`.
- Ако е повторно използваема, премести в `services/`.

3. Искаш нови текстове в UI:
- Добави в `frontend/lib/i18n.ts`.

4. Искаш да смениш контактния имейл в интерфейса:
- Файл: `frontend/components/Dashboard.tsx`
- Търси `mailto:` в секцията `about`.

5. Искаш нов екран/бутон:
- Обичайно в `frontend/components/Dashboard.tsx`.

6. Искаш нова таблица/колона:
- Добави в `backend/app/models.py`.
- Добави startup migration guard в `backend/app/main.py` за legacy инсталации.

7. Искаш нов отчет:
- Backend export логика в `routers/reports.py`/`services/excel.py`.
- Frontend бутон в `Dashboard.tsx`.

## 6. Рискови точки и best-practice бележки

1. `Dashboard.tsx` е голям файл.
- Препоръка: постепенно разделяне на под-компоненти:
  - `OperatorPanel`
  - `ProductManagementPanel`
  - `ReportsPanel`
  - `AdminPanel`

2. Startup migrations в `main.py`.
- Удобно е за малък проект, но при растеж е добре да се мигрира към Alembic.

3. Одит защита.
- Има app-level и db-level защита.
- Root достъп до сървъра/DB остава извън приложението.

4. Role enforcement.
- Всички чувствителни endpoint-и трябва да минават през dependency guard.

## 7. Бърз onboarding на нов разработчик

1. Чети поред:
1. `README.md`
2. `README_BG_USER_GUIDE.md`
3. `TECHNICAL_WORKFLOW.md`
4. `TECHNICAL_FILE_INDEX_BG.md`

2. Стартирай локално:
```bash
cp .env.example .env
docker compose up --build -d
```

3. Провери:
- App: `http://localhost:3000`
- Swagger: `http://localhost:8000/docs`

4. Влез с:
- `admin/admin123`
- `operator1` се създава от admin при нужда
