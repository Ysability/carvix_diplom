<div align="center">
  <img src="images/logo.png" alt="Carvix" width="240" />
  <h1>Carvix</h1>
  <p><b>Веб-система управления автопарком, ТО и ремонтами.</b></p>
  <p>
    <img alt="Node" src="https://img.shields.io/badge/Node.js-18%2B-43853D?logo=node.js&logoColor=white" />
    <img alt="Express" src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" />
    <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-14%2B-4169E1?logo=postgresql&logoColor=white" />
    <img alt="JWT" src="https://img.shields.io/badge/Auth-JWT-000000?logo=jsonwebtokens" />
    <img alt="Tests" src="https://img.shields.io/badge/Tests-Jest%20%E2%9C%94-99425b?logo=jest&logoColor=white" />
    <img alt="Coverage" src="https://img.shields.io/badge/Coverage-83%25-brightgreen" />
    <img alt="Tests count" src="https://img.shields.io/badge/Tests-201-blue?logo=jest" />
    <img alt="CI" src="https://github.com/boevxd/Carvix/actions/workflows/ci.yml/badge.svg" />
    <img alt="Render" src="https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=white" />
    <img alt="License" src="https://img.shields.io/badge/license-MIT-1c1b17" />
  </p>
</div>

---

## О проекте

**Carvix** — учебно-демонстрационный full-stack проект: бэкенд + фронтенд для управления автопарком предприятия.
Учёт техники, заявки на ТО и ремонт, аналитика для руководства, контроль запчастей и поставок.

На текущий момент готов первый блок — **система авторизации и регистрации сотрудников** с ролями и подразделениями,
JWT-сессией и личным кабинетом.

| Часть | Стек |
|-------|------|
| **Backend** | Node.js, Express 4, `pg` (node-postgres), bcryptjs, jsonwebtoken, dotenv, cors |
| **Frontend** | Vanilla JS + HTML5 + CSS3 (без сборщика) — Manrope + Cormorant Garamond, glass-morphism, анимации |
| **БД** | PostgreSQL (DDL — `schema.sql`, демо-данные — `seed_data.sql`) |
| **Хостинг** | Render: free Web Service + free PostgreSQL (одной командой через `render.yaml`) |
| **Безопасность** | bcrypt-хэши паролей, JWT в `Authorization: Bearer …` |

## Структура проекта

```
.
├── server.js              # Express-сервер (статика + /api/auth + /images)
├── db.js                  # PG-пул с mysql2-совместимым адаптером ("?" → "$N")
├── schema.sql             # PG DDL (14 таблиц, IF NOT EXISTS)
├── seed.js                # авто-применяется при старте: создаёт таблицы + базовые роли/подразделения
├── seed-demo.js           # `npm run seed:demo` — заливает полный набор демо-данных
├── seed_data.sql          # SQL-скрипт демо-данных (PostgreSQL)
├── render.yaml            # Конфиг Render: Web + Postgres в один клик
├── routes/auth.js         # /api/auth/{roles, podrazdeleniya, register, login, me}
├── middleware/auth.js     # JWT middleware
├── public/
│   ├── index.html         # страница Login / Register
│   ├── dashboard.html     # личный кабинет после входа
│   ├── styles.css
│   └── script.js
├── images/logo.png
├── script_bd.txt          # ИСТОРИЧЕСКИЙ MySQL DDL (для архивных целей)
├── .env.example
└── package.json
```

## Локальный запуск

> Требуется **Node.js ≥ 18** и **PostgreSQL ≥ 14**.

```bash
git clone https://github.com/boevxd/Carvix.git
cd Carvix
cp .env.example .env
# отредактируйте .env (DB_USER, DB_PASSWORD …)

npm install

# Создаём БД (в psql или GUI)
createdb carvix

npm start
```

При первом старте `seed.js` сам:

1. Применит `schema.sql` (создаст 14 таблиц).
2. Добавит **6 ролей** (`Аналитик / Диспетчер / Механик / Главный механик / Директор / Пользователь`).
3. Добавит **4 подразделения** (`Главное управление / Автопарк №1 / Автопарк №2 / Ремонтный цех`).

После старта откройте http://localhost:3000.

### Залить демо-данные

```bash
npm run seed:demo
```

Скрипт **полностью очистит** таблицы и зальёт 12 сотрудников, 12 машин, 14 заявок, 8 ремонтов и т. д.

## Деплой на Render

Проект полностью готов к **бесплатному** хостингу на Render: один Web Service + один free Postgres.

### Вариант 1 — через `render.yaml` (рекомендуется)

1. Залогиньтесь на https://render.com (через GitHub).
2. **New +** → **Blueprint** → выберите репозиторий `boevxd/Carvix`.
3. Render прочитает `render.yaml` и сам предложит создать:
   - **PostgreSQL** `carvix-db` (free)
   - **Web Service** `carvix` (free) с уже подключённым `DATABASE_URL`
4. Нажмите **Apply** — через 2–3 минуты сайт поднимется на `https://carvix.onrender.com`.

### Вариант 2 — вручную

1. **New +** → **PostgreSQL** → план **Free** → создать `carvix-db`.
2. **New +** → **Web Service** → подключить репозиторий.
3. Настройки:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment Variables**:
     - `DATABASE_URL` → копируем из `Internal Database URL` Postgres-сервиса
     - `JWT_SECRET` → длинная случайная строка
     - `JWT_EXPIRES_IN` = `7d`
     - `NODE_ENV` = `production`
4. **Create Web Service** — после деплоя `seed.js` автоматически создаст таблицы и базовые роли/подразделения.

### Залить демо-данные на Render

В дашборде Web Service → **Shell** → выполнить:

```bash
node seed-demo.js
```

## Тестовые учётные записи

После `npm run seed:demo` (или `node seed-demo.js` на Render) появятся 12 сотрудников.
**Пароль у всех — `password`**.

| Логин | ФИО | Роль |
|-------|-----|------|
| `ivanov` | Иванов И. И. | Директор |
| `petrov` | Петров П. П. | Главный механик |
| `sidorov` | Сидоров А. О. | Механик |
| `kuznetsov` | Кузнецов Д. С. | Механик |
| `morozova` | Морозова А. В. | Диспетчер |
| `volkova` | Волкова Е. И. | Аналитик |
| `sokolov` | Соколов М. А. | Пользователь |
| `lebedev` | Лебедев А. В. | Пользователь |
| `novikov` | Новиков Ю. П. | Механик |
| `orlova` | Орлова С. Н. | Диспетчер |

## API

| Метод | Путь | Описание |
|-------|------|----------|
| `GET`  | `/api/auth/roles`          | Список ролей |
| `GET`  | `/api/auth/podrazdeleniya` | Список подразделений |
| `POST` | `/api/auth/register`       | Регистрация (`fio`, `login`, `password`). Роль и подразделение проставляются по умолчанию: `Пользователь` / `Главное управление` |
| `POST` | `/api/auth/login`          | Вход (`login`, `password`). Возвращает `{ token, user }` |
| `GET`  | `/api/auth/me`             | Текущий пользователь (требует `Authorization: Bearer <token>`) |

### Пример

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"ivanov","password":"password"}'
```

```json
{
  "token": "eyJhbGciOi…",
  "user": {
    "id": 1,
    "fio": "Иванов Иван Иванович",
    "login": "ivanov",
    "rol_nazvanie": "Директор",
    "podrazdelenie_nazvanie": "Главное управление"
  }
}
```

## Тесты и контроль качества

Проект покрыт автоматическими тестами на **Jest + supertest** — **201 тест**, **83 % покрытия** строк бэкенда.

### Запуск

```bash
npm test                  # все тесты
npm run test:coverage     # с HTML-отчётом покрытия (coverage/lcov-report/index.html)
npm run test:unit         # только unit (middleware)
npm run test:integration  # интеграционные (HTTP + БД-моки)
npm run test:business     # бизнес-логика (план/факт, CSV, JWT)
npm run test:ci           # как на CI: --runInBand --ci + coverage
```

### Что покрыто

| Каталог | Файлов | Тестов | Что проверяется |
|---|---:|---:|---|
| `__tests__/unit/` | 2 | 18 | JWT-middleware (5 веток), RBAC (Директор/Аналитик/Гл. механик/Пользователь × read/write) |
| `__tests__/integration/auth` | 1 | 14 | login/register/me/roles/podrazdeleniya — все 400/401/409/200-сценарии |
| `__tests__/integration/expenses` | 1 | 22 | CRUD расходов + RBAC + CSV-импорт + audit-log |
| `__tests__/integration/budgets` | 1 | 20 | CRUD бюджетов + bulk + copy-from-prev-year + плана/факт + RBAC |
| `__tests__/integration/parts-receipts` | 1 | 15 | накладные на запчасти, склад в транзакции, реверс при удалении |
| `__tests__/integration/reports` | 1 | 17 | TCO-список, TCO-детальный, дашборд (KPI), прогноз Holt-Winters |
| `__tests__/integration/audit` | 1 | 5 | журнал операций, фильтры, RBAC, пагинация |
| `__tests__/integration/zayavki` | 1 | 37 | заявки + RBAC + ручное назначение + **автонаводка** (local/global/409) |
| `__tests__/integration/remonty` | 1 | 20 | ремонты: start/finish, владелец-ров, стоимости, audit |
| `__tests__/business-logic/` | 4 | 33 | план/факт, CSV-парсер, JWT-tampering, **Holt-Winters** (16 тестов) |
| **Итого** | **14** | **201** | — |

### Архитектура тестов

* **`__tests__/helpers/mockDb.js`** — заглушка модуля `db.js`. Записывает все вызовы `pool.execute / pool.pool.query / transaction`, отдаёт настроенные ответы по regex-паттернам SQL-запроса. Это даёт настоящие интеграционные тесты эндпоинтов **без поднятия PostgreSQL**.
* **`__tests__/helpers/auth.js`** — генератор JWT-токенов для четырёх ролей и негативных кейсов (просроченный, чужой секрет, tampered).
* **`__tests__/helpers/makeApp.js`** — фабрика мини-Express-приложения (без `seed()`, без `listen()`).
* **`__tests__/setup-env.js`** — изолирует тесты от боевого `.env` (отключает `dotenv.config()`, фиксирует `JWT_SECRET=carvix-test-secret-key`).

### Пороги покрытия (ниже — CI падает)

```js
// jest.config.js
coverageThreshold: {
  global: { branches: 60, functions: 70, lines: 70, statements: 70 }
}
```

Текущие значения: **statements 80 %, branches 80 %, functions 84 %, lines 83 %**. `middleware/auth.js` и `middleware/rbac.js` покрыты на **100 %**.

### CI/CD

`.github/workflows/ci.yml` запускает все тесты на двух версиях Node (18 и 20) при каждом push/PR и публикует HTML-отчёт о покрытии как артефакт. После успешного прохождения CI Render автоматически деплоит изменения с `main`.

## Почему PostgreSQL, а не MySQL?

Изначально проект писался под MySQL (`script_bd.txt` остался в репозитории как референс).
При деплое на бесплатный план Render-а доступен только **PostgreSQL**, поэтому проект мигрирован:

- `mysql2` → `pg`.
- `db.js` сохраняет mysql2-совместимый интерфейс (`pool.execute`, `[rows]` деструктуризация, `?` плейсхолдеры) — роуты не пришлось переписывать.
- `AUTO_INCREMENT` → `SERIAL`, `DATETIME` → `TIMESTAMP`, `INSERT … RETURNING id` вместо `result.insertId`.

## Дизайн и анимации

- Палитра **белый / бежевый / серый**, шрифты `Manrope` + `Cormorant Garamond`.
- Glass-morphism карточка с тонкой светящейся гранью сверху.
- Скользящий индикатор табов `Вход ↔ Регистрация` (CSS Grid + transform).
- Floating-labels, иконки слева, eye-toggle паролей.
- Плывущие беж-блобы фоном + точечная сетка с радиальной маской.
- Декоративные пунктирные кольца `spin-slow` и shimmer на бренд-панели.
- Чек-иконки в beige-плитках вместо обычных bullet-точек.
- Микро-анимации: `logo-glide` у логотипа, `shake` при ошибке формы, `feat-in` появление пунктов.

## Ролевая модель и рабочие места

Система поддерживает **6 ролей**, каждая с уникальным интерфейсом:

| Роль | Разделы | Ключевые возможности |
|---|---|---|
| **Пользователь** | Мои заявки | Создают заявки **только на ТС своего подразделения**, видят свои заявки и их статусы |
| **Механик** | Мои ремонты | Стартует и закрывает ремонт с фиксацией стоимости работ и запчастей — видит только **свои** назначения |
| **Диспетчер** | Распределение, Заявки | **Автонаводка** на свободных механиков (с учётом подразделения ТС и загрузки за 30 дней), ручное назначение, смена статусов |
| **Главный механик** | все разделы | Кроме журнала — полный доступ к финансам, бюджетам, TCO, назначениям |
| **Директор** | все разделы | Полный доступ, включая журнал аудита и редактирование любых ремонтов |
| **Аналитик** | финансы + журнал | Read-only доступ к отчётам, бюджетам, TCO и аудиту |

### Алгоритм «Автонаводки»

`POST /api/zayavki/:id/auto-assign` — выбирает оптимального механика:

1. **Local-pool**: механики, закреплённые за тем же подразделением, что и ТС из заявки.
2. **Global fallback**: если в своём подразделении механиков нет — расширяемся на все подразделения.
3. **Сортировка** внутри пула: `активные_ремонты ASC → ремонтов_за_30дн ASC → ФИО ASC`.
4. **Результат**: создаётся запись в `remont`, статус заявки → «В работе», пишется аудит с меткой `auto-assign`.

Кнопка «**Автонаводка всех**» в разделе П«Распределение» вызывает этот эндпоинт для каждой новой заявки в очереди.

## Дальнейшее развитие

- [x] Заявки на ремонт + роли Пользователь/Диспетчер/Механик + автонаводка
- [x] Прогнозирование расходов (Holt-Winters)
- [ ] Канбан для механиков (drag‑and‑drop между статусами)
- [ ] Прикрепление фотографий к заявкам (S3 / Cloudinary)
- [ ] OCR для бумажных накладных (Tesseract.js)
- [ ] Управление складом
- [ ] Роли и права на эндпоинтах (RBAC middleware)

## Лицензия

MIT © 2026 Carvix
