# OPENSTOKO: Ръководство за Разработчици (UI Модификации)



Този документ е предназначен за разработчици. Той обяснява как да се модифицира потребителският интерфейс (UI) на OPENSTOKO, по-конкретно как да се променя функционалността и позицията на бутоните.

Основните файлове, които ще разгледаме, са:
-   `frontend/components/Dashboard.tsx`: Съдържа почти цялата UI логика и JSX структурата. Това е "мозъкът" на интерфейса.
-   `frontend/lib/i18n.ts`: Съдържа всички текстови етикети (labels) за различните езици.

## 1. Общи принципи

### 1.1 Промяна на функционалност

Логиката зад всеки бутон се дефинира в неговия `onClick` атрибут в JSX кода. Този атрибут обикновено извиква TypeScript функция.

-   **Къде се намират функциите?** Почти всички функции за бизнес логика са дефинирани вътре в компонента `Dashboard` във файла `frontend/components/Dashboard.tsx`.
-   **Как да променя нещо?** За да промените какво прави един бутон, първо намерете неговия `<button>` таг в JSX кода. Вижте коя функция се извиква в `onClick`. След това намерете дефиницията на тази функция в същия файл и я модифицирайте.

### 1.2 Промяна на позиция (местоположение)

Позицията на бутона на екрана се определя от неговото място в JSX структурата. Интерфейсът е изграден със стандартни тагове (`<div>`, `<button>`, `<section>`). Преместването на `<button>` тага на друго място в кода ще го премести и визуално.

**Пример: Преместване на бутона "Обнови"**

Да предположим, че искате да преместите главния бутон "Обнови" от горния десен ъгъл в страничната лента (sidebar), точно над списъка с менюта.

1.  **Намерете кода на бутона:** Отворете `frontend/components/Dashboard.tsx` и потърсете текста `t.refresh`. Ще го намерите в `<div className="topbar">`.

    ```jsx
    // Текущо местоположение в topbar
    <div className="topbar">
      <h2>{tabLabel(activeTab)}</h2>
      <div className="inline-actions">
        {/* ... други бутони ... */}
        <button onClick={() => setActiveTab('help')}>{t.help}</button>
        <button onClick={() => refreshMainData().catch(handleError)}>{t.refresh}</button>
        <button className="danger-btn inline-danger" onClick={onLogout}>{t.logout}</button>
      </div>
    </div>
    ```

2.  **Изрежете кода на бутона:** Изрежете целия ред: `<button onClick={() => refreshMainData().catch(handleError)}>{t.refresh}</button>`.

3.  **Намерете новото място:** Потърсете страничната лента (`<aside className="sidebar card">`) и навигационното меню в нея (`<nav className="menu">`).

4.  **Поставете кода:** Поставете изрязания код точно преди `<nav>`.

    ```jsx
    // Ново местоположение в sidebar
    <aside className="sidebar card">
      <div>
        <h3>{t.title}</h3>
        <div className="muted">{me ? `${me.full_name} (${me.role === 'admin' ? td.k034 : td.k035})` : '...'}</div>
      </div>
      {/* Ето го преместеният бутон */}
      <button onClick={() => refreshMainData().catch(handleError)}>{t.refresh}</button>
      <nav className="menu">
        {visibleTabs.map((tab) => {
          // ...
        })}
      </nav>
      <button className="danger-btn" onClick={onLogout}>{t.logout}</button>
    </aside>
    ```

5.  Запазете файла. Ако `docker compose` работи в `dev` режим, промяната ще се отрази веднага в браузъра.

### 1.3 Промяна на текст/етикет

Текстовете на всички бутони се управляват централизирано от `frontend/lib/i18n.ts`. За да смените текста на бутон "Обнови":

1.  Отворете `frontend/lib/i18n.ts`.
2.  Намерете обекта `texts`.
3.  Намерете ключа `refresh` за съответния език (напр. `bg`).
4.  Променете стойността:
    ```typescript
    // frontend/lib/i18n.ts
    export const texts: Record<Lang, Record<string, string>> = {
      bg: {
        // ...
        refresh: 'Презареди данни', // Променено от "Обнови"
        // ...
      },
      en: {
        // ...
        refresh: 'Reload Data', // Променено от "Refresh"
        // ...
      }
    };
    ```

## 2. Карта на основните бутони

Тук са описани ключови бутони, техните функции и местоположение в `frontend/components/Dashboard.tsx`.

### 2.1 Основна навигация и Top Bar

-   **Бутони за табове (Оператор, Продукти, ...)**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Логика: `onClick={() => setActiveTab(tab)}`
        -   Описание: Променя `activeTab` state променливата, което води до рендиране на различен UI. Списъкът с табове се генерира от масива `visibleTabs`.
    -   **Позициониране:**
        -   Намират се в `<aside className="sidebar card">` -> `<nav className="menu">`. Редът им се контролира от масива `tabOrder` в началото на файла. Промяната на реда в `tabOrder` ще пренареди бутоните в менюто.

-   **Бутон "Обнови" (в Top Bar)**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `refreshMainData`
        -   Описание: Извиква няколко API endpoint-а (`/products`, `/movements`, `/auth/me`, `/products/categories`) за презареждане на основните данни на приложението и обновява съответните state променливи (`products`, `movements`, `me`, `categories`).
    -   **Позициониране:**
        -   Намира се в `<div className="topbar">` -> `<div className="inline-actions">`.

### 2.2 Екран "Добавяне на продукти" (`activeTab === 'products'`)

-   **Бутон "Нов продукт"**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `createProduct` (обвита във `withLoading` за индикация при зареждане)
        -   Описание: Събира данните от state променливите на формата (`name`, `category`, `barcode` и т.н.), извършва валидации и изпраща `POST` заявка към `/api/products`. При успех, изчиства формата и презарежда данните.
    -   **Позициониране:**
        -   Намира се в `<div className="card">` под формата за създаване на продукт.

-   **Бутон "Редакция" (в таблицата с продукти)**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `startAdminEdit`
        -   Описание: Приема обект `product` като аргумент. Попълва state променливите за админ редакцията (`adminEditName`, `adminEditCategory` и т.н.) с данните от продукта и показва панела за редакция.
    -   **Позициониране:**
        -   Генерира се за всеки ред в таблицата с продукти (`filteredProducts.map(...)`). Намира се в последната `<td>` колона.

-   **Бутон "Запази редакцията" (в админ панела за редакция)**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `saveAdminEdit`
        -   Описание: Събира данните от state променливите на админ формата (`adminEdit...`), валидира ги и изпраща `PUT` заявка към `/api/products/${editingProductId}/admin-edit`.
    -   **Позициониране:**
        -   Намира се в `<div ref={adminEditRef} className="card admin-edit-panel">`. Показва се само когато `editingProductId` има стойност.

### 2.3 Екран "Оператор" (`activeTab === 'cashier'`)

-   **Бутони "Приемане в склада" / "Изписване от склада"**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Логика: `onClick={() => setOperatorAction('input' / 'output')}`
        -   Описание: Променя `operatorAction` state променливата, което условно показва/скрива различни части от UI на операторския екран.
    -   **Позициониране:**
        -   Намират се в `<div className="operator-mode-chooser">`. Показват се само когато `!operatorAction`.

-   **Бутон "✅ Потвърди вход"**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `executeOperatorAction`
        -   Описание: Когато `operatorAction` е 'input', тази функция изпраща `POST` заявка към `/api/movements/input-generate` за създаване на нови наличности (и серийни номера).
    -   **Позициониране:**
        -   Намира се в `<div className="inline-actions">` в операторския екран. Показва се само когато `operatorAction === 'input'`.

-   **Бутон "🛒 Потвърди продажбата"**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `checkoutCart`
        -   Описание: Изпраща `POST` заявка към `/api/movements/checkout` с данните от `cashierCart`. При успех изчиства количката и показва панела за печат на гаранции.
    -   **Позициониране:**
        -   Намира се в `<div className="inline-actions">` в операторския екран. Показва се само когато `operatorAction === 'output'`.

-   **Бутон "Принт гаранция"**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `printWarrantyLabel`
        -   Описание: Използва `download` хелпъра, за да изтегли PDF от `GET /api/movements/warranty-label/{serial_number}`.
    -   **Позициониране:**
        -   Показва се в панела след успешна продажба. Генерира се за всеки продаден сериен номер от `lastSoldSerials` масива.

### 2.4 Екран "Админ" (`activeTab === 'admin'`)

-   **Бутон "Нов потребител"**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `createUser`
        -   Описание: Изпраща `POST` заявка към `/api/users` с данните от формата за нов потребител.
    -   **Позициониране:**
        -   Намира се в първия `<div className="card">` в админ таба.

-   **Бутон "Смени парола"**
    -   **Функционалност:**
        -   Файл: `frontend/components/Dashboard.tsx`
        -   Функция: `resetUserPassword`
        -   Описание: Изпраща `PUT` заявка към `/api/users/${userId}/password` с новата парола.
    -   **Позициониране:**
        -   Генерира се за всеки ред в таблицата с потребители.

---

Този списък не е изчерпателен, но покрива основните бутони и дава ясна представа за структурата на кода. За всеки друг бутон, процесът е същият: намерете го в JSX, вижте `onClick` функцията и я анализирайте.