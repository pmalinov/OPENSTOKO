# OPENSTOKO Warehouse Requirements & Implementation Status (2026)

> Documentation Release: **2026-03-15** (Release Docs baseline).

Този файл е актуализирана версия на продуктовите изисквания и реалния статус на имплементация.

## 1. Техническа инфраструктура

Текущ стек:

1. Backend: Python + FastAPI
2. Frontend: Next.js (React + TypeScript)
3. Database: MySQL 8.4
4. Orchestration: Docker Compose (`frontend`, `backend`, `db`, optional `phpmyadmin`)

Статус: изпълнено.

## 2. Потребители, сигурност, роли

Роли:

1. `admin`: пълен достъп до настройки, цени, прагове, одит, потребители.
2. `operator`: оперативни действия (вход/изход/търсене), без admin редакции.

Контроли:

1. JWT authentication.
2. Role-based endpoint guards.
3. Одит запис за критични действия.
4. За correction/reconcile има задължителен коментар.

Статус: изпълнено.

## 3. Идентификация на продукт и бройка

Налични идентификатори:

1. Фабричен баркод (`factory_barcode`)
2. Вътрешен баркод (`store_barcode`)
3. Вътрешен код (`internal_sku`)
4. Сериен номер на единична бройка (`inventory_items.serial_number`)

Сериализация:

1. Всеки физически артикул се следи като отделна единица.
2. Auto SN генерация: `PREFIX-YYYYMMDD-HHMMSS-XXXXXX`.

Статус: изпълнено.

## 4. Вход/изход и складови движения

Поддържани движения:

1. `input`
2. `output`
3. `defect`
4. `adjustment`
5. `inventory_reconcile`

Ограничения:

1. `output` изисква валиден SN в наличност.
2. Price guard: блокира продажба под `min_sell_price`.

Статус: изпълнено.

## 5. Универсална съвместимост и заместители

Подход:

1. `compatibility_group` за групиране на взаимозаменяеми продукти.
2. `product_substitutes` за explicit substitutes.
3. Operator и dossier UI показват алтернативи автоматично.

Статус: изпълнено.

## 6. Гаранционен поток

Функции:

1. Warranty lookup по SN.
2. След продажба UI показва продадените SN.
3. За всеки SN има `Принт гаранция` бутон.
4. API за гаранционен етикет: `GET /api/movements/warranty-label/{serial_number}`.

Статус: изпълнено.

## 7. BI и отчети

BI:

1. Time Machine
2. Velocity
3. ABC
4. Warranty check

Export:

1. Products XLSX
2. Movements XLSX
3. Audit XLSX
4. Defects XLSX

Статус: изпълнено.

## 8. Многоезичност

Поддържани езици:

1. Български (default)
2. Английски
3. Италиански

Статус: изпълнено.

## 9. Какво НЕ е включено (към момента)

1. Фискален модул и официални данъчни фактури.
2. Директна интеграция с куриери.
3. Банкови разплащания в приложението.

## 10. Свързани документи

1. `README.md` (основен старт)
2. `README_BG_USER_GUIDE.md` (нетехническа работа)
3. `TECHNICAL_WORKFLOW.md` (енд-то-енд логика)
4. `TECHNICAL_FILE_INDEX_BG.md` (файл по файл)
5. `README_SQL_PHPMYADMIN.md` (SQL диагностика)

## 11. Поддръжка и консултации

За помощ при инсталация, конфигурация на сървър и технически въпроси:
1. Email: `p.m.malinov@gmail.com`
2. LinkedIn: `www.linkedin.com/in/plamen-malinov-883139105`

За персонализирани доработки по бизнес изисквания:
1. custom workflow и роли
2. интеграции с външни системи
3. разширена отчетност и автоматизации
