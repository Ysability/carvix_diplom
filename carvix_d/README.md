<div align="center">
  <img src="images/logo.png" alt="Carvix" width="200" />
  <h1>Carvix</h1>
  <p><b>Автоматизированная система управления автопарком, ТО и ремонтами</b></p>
  <p>
    <img alt="Node" src="https://img.shields.io/badge/Node.js-18%2B-43853D?logo=node.js&logoColor=white" />
    <img alt="Express" src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" />
    <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-14%2B-4169E1?logo=postgresql&logoColor=white" />
    <img alt="JWT" src="https://img.shields.io/badge/Auth-JWT-000000?logo=jsonwebtokens" />
    <img alt="Tests" src="https://img.shields.io/badge/Tests-Jest%20%E2%9C%94-99425b?logo=jest&logoColor=white" />
    <img alt="Coverage" src="https://img.shields.io/badge/Coverage-83%25-brightgreen" />
    <img alt="Tests count" src="https://img.shields.io/badge/Tests-201-blue?logo=jest" />
    <img alt="License" src="https://img.shields.io/badge/license-MIT-1c1b17" />
  </p>
</div>

---

## О проекте

**Carvix** — full-stack веб-приложение для управления автопарком предприятия, автоматизации процессов технического обслуживания (ТО), ремонта транспортных средств (ТС) и финансового учета затрат.

Система обеспечивает полный цикл работы с заявками на ремонт: от создания заявки пользователем и автоматического распределения работ между механиками до фиксации стоимости, аналитики затрат (TCO) и прогнозирования расходов.

### Ключевые возможности

- **Управление транспортными средствами** — учет ТС по подразделениям, маркам, моделям; маски ввода гос. и инвентарного номера
- **Заявки на ремонт** — создание, назначение, изменение статусов, таймлайн истории статусов, встроенный чат
- **Распределение работ** — ручное и автоматическое назначение механиков с учетом подразделения и загрузки
- **Управление ремонтами** — старт, завершение, фиксация стоимости работ и запчастей, гарантийный срок
- **Финансовый модуль** — бюджеты, расходы, TCO, план/факт, прогнозирование (Holt-Winters), импорт CSV
- **Учет запчастей** — склад остатков, приходные накладные, поставщики
- **Аудит** — журнал всех финансовых операций и изменений статусов
- **Мультиязычность** — русский, английский, таджикский
- **Ролевая модель** — 6 ролей с разграничением прав доступа
- **Swagger API** — интерактивная документация REST API

### Стек технологий

| Уровень | Технология |
|---------|-----------|
| Backend | Node.js 18+, Express 4.x |
| База данных | PostgreSQL 14+ (pg driver) |
| Аутентификация | JWT (jsonwebtoken), bcryptjs |
| Валидация | express-validator |
| Frontend | Vanilla JavaScript + HTML5 + CSS3 (без сборщика) |
| Тестирование | Jest + Supertest, покрытие 83% (201 тест) |
| API-документация | Swagger UI + swagger-jsdoc |
| Локализация | Кастомный i18n (ru / en / tg) |

---

## Структура проекта

```
carvix_d/
├── server.js                  # Express-сервер, инициализация, маршруты
├── db.js                      # PG-пул с mysql2-совместимым адаптером
├── schema.sql                 # DDL: 22 таблицы, VIEW, индексы
├── seed.js                    # Идемпотентная инициализация БД при старте
├── seed-demo.js               # Демо-данные: сотрудники, ТС, заявки, ремонты
├── seed_data.sql              # SQL-скрипт демо-данных
├── swagger.js                 # Спецификация OpenAPI
├── .env                       # Переменные окружения
├── .env.example               # Шаблон .env
├── jest.config.js             # Конфигурация тестов
├── package.json
│
├── middleware/
│   ├── auth.js                # JWT-verification middleware
│   ├── rbac.js                # Role-Based Access Control
│   └── rate-limit.js          # Rate limiting (login + API)
│
├── routes/
│   ├── auth.js                # Авторизация, регистрация, роли, подразделения
│   ├── zayavki.js             # CRUD заявок, назначение, автонаводка, статусы
│   ├── remonty.js             # Ремонты: старт, завершение, стоимость
│   ├── transport.js           # Транспорт, марки, модели
│   ├── chat.js                # Чат заявки
│   └── finance/
│       ├── budgets.js         # Бюджеты подразделений
│       ├── expenses.js        # Расходы, импорт CSV
│       ├── reports.js         # TCO, дашборд, прогнозы
│       ├── exports.js         # Экспорт Excel / PDF
│       └── audit.js           # Журнал аудита
│
├── public/
│   ├── index.html             # Страница входа / регистрации
│   ├── dashboard.html         # Личный кабинет (ролевой интерфейс)
│   ├── styles.css             # Общие стили
│   ├── script.js              # Логика авторизации
│   ├── app-roles.js           # Ролевой frontend: заявки, ремонты, чат
│   ├── app-transport.js       # Frontend: транспорт, марки, модели
│   ├── app-finance.js         # Frontend: финансы, отчеты
│   └── i18n.js                # Локализация (ru/en/tg)
│
├── __tests__/                 # Автоматические тесты
│   ├── helpers/
│   │   ├── mockDb.js          # Мок БД для интеграционных тестов
│   │   ├── auth.js            # Генератор JWT-токенов для тестов
│   │   └── makeApp.js         # Фабрика Express-приложения
│   ├── unit/                  # Unit-тесты middleware
│   ├── integration/           # Интеграционные тесты эндпоинтов
│   └── business-logic/        # Тесты бизнес-логики (Holt-Winters, CSV)
│
└── images/
    └── logo.png
```

---

## Локальный запуск

### Требования

- **Node.js** >= 18
- **PostgreSQL** >= 14

### Установка

```bash
# 1. Клонирование репозитория
git clone https://github.com/Ysability/carvix_diplom.git
cd carvix_d

# 2. Переменные окружения
cp .env.example .env
# Отредактируйте .env: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET

# 3. Установка зависимостей
npm install

# 4. Создание базы данных (в psql)
createdb carvix

# 5. Запуск
npm start
```

При первом старте `seed.js` автоматически:
1. Применит `schema.sql` (22 таблицы, VIEW, индексы)
2. Создаст 6 ролей: Аналитик, Диспетчер, Механик, Главный механик, Директор, Пользователь
3. Создаст 4 подразделения: Главное управление, Автопарк №1, Автопарк №2, Ремонтный цех

Приложение будет доступно по адресу: http://localhost:3000

### Заливка демо-данных

```bash
npm run seed:demo
```

Скрипт полностью очистит таблицы и создаст: 12 сотрудников, 12 ТС, 14 заявок, 8 ремонтов, 3 поставщика, 8 запчастей, бюджеты, расходы.

---

## Ролевая модель

Система реализует **6 ролей** с разграничением прав доступа (RBAC):

| Роль | Доступные разделы | Ключевые возможности |
|------|-------------------|----------------------|
| **Пользователь** | Мои заявки, Транспорт | Создание заявок только на ТС своего подразделения; просмотр своих заявок, статусов, чата |
| **Механик** | Мои ремонты | Старт и завершение ремонта (стоимость работ, запчастей, гарантийный срок, комментарий); чат с пользователем |
| **Диспетчер** | Распределение, Заявки, Транспорт | Автонаводка и ручное назначение механиков; изменение статусов заявок; склад запчастей |
| **Главный механик** | Все разделы (кроме Журнала) | Полный доступ к ремонтам, финансам, бюджетам, TCO, назначениям; редактирование любых ремонтов |
| **Директор** | Все разделы | Полный доступ, включая журнал аудита и редактирование любых данных |
| **Аналитик** | Финансы, Журнал | Read-only доступ к отчетам, бюджетам, TCO, аудиту; экспорт Excel/PDF |

### Алгоритм «Автонаводки»

`POST /api/zayavki/:id/auto-assign` — автоматическое назначение оптимального механика:

1. **Local-pool**: поиск механиков того же подразделения, что и ТС из заявки
2. **Global fallback**: если в своем подразделении нет — расширение на все подразделения
3. **Сортировка**: `активные ремонты ASC` -> `ремонтов за 30 дн ASC` -> `ФИО ASC`
4. **Результат**: создание записи в `remont`, статус заявки -> «В работе», запись в аудит с меткой `auto-assign`

---

## API

### Основные эндпоинты

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| `GET`  | `/api/auth/roles` | Список ролей | — |
| `GET`  | `/api/auth/podrazdeleniya` | Список подразделений | — |
| `POST` | `/api/auth/register` | Регистрация | — |
| `POST` | `/api/auth/login` | Вход (rate limit: 5/15min) | — |
| `GET`  | `/api/auth/me` | Текущий пользователь | JWT |
| `GET`  | `/api/transport` | Список ТС | JWT + RBAC |
| `POST` | `/api/transport` | Создание ТС | JWT + RBAC |
| `PATCH`| `/api/transport/:id` | Редактирование ТС | JWT + RBAC |
| `DELETE`| `/api/transport/:id` | Удаление ТС | JWT + RBAC |
| `GET`  | `/api/zayavki` | Список заявок | JWT + RBAC |
| `POST` | `/api/zayavki` | Создание заявки | JWT + RBAC |
| `PATCH`| `/api/zayavki/:id` | Редактирование заявки | JWT + RBAC |
| `POST` | `/api/zayavki/:id/auto-assign` | Автонаводка | JWT + Диспетчер |
| `GET`  | `/api/zayavki/:id/history` | История статусов | JWT + RBAC |
| `GET`  | `/api/remonty/my` | Мои ремонты | JWT + Механик |
| `POST` | `/api/remonty/:id/start` | Старт ремонта | JWT + Механик |
| `POST` | `/api/remonty/:id/finish` | Завершение ремонта | JWT + Механик |
| `GET`  | `/api/zayavki/:id/chat` | Сообщения чата | JWT + RBAC |
| `POST` | `/api/zayavki/:id/chat` | Отправка сообщения | JWT + RBAC |
| `GET`  | `/api/finance/budgets` | Бюджеты | JWT + FinanceRead |
| `GET`  | `/api/finance/expenses` | Расходы | JWT + FinanceRead |
| `POST` | `/api/finance/expenses/import` | Импорт CSV | JWT + FinanceWrite |
| `GET`  | `/api/finance/reports/tco` | TCO по ТС | JWT + FinanceRead |
| `GET`  | `/api/finance/reports/plan-fact` | План/факт | JWT + FinanceRead |
| `GET`  | `/api/finance/reports/dashboard` | KPI дашборд | JWT + FinanceRead |
| `GET`  | `/api/finance/reports/forecast` | Прогноз Holt-Winters | JWT + FinanceRead |
| `GET`  | `/api/finance/audit` | Журнал аудита | JWT + Директор/Аналитик |
| `GET`  | `/api/docs` | Swagger UI | — |

### Пример запроса

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"ivanov","password":"password"}'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "fio": "Иванов Иван Иванович",
    "login": "ivanov",
    "rol_nazvanie": "Директор",
    "podrazdelenie_nazvanie": "Главное управление"
  }
}
```

---

## Тестирование

Проект покрыт автоматическими тестами: **201 тест**, **83% покрытие** строк бэкенда.

### Запуск

```bash
npm test                  # все тесты
npm run test:coverage     # с HTML-отчетом покрытия
npm run test:unit         # unit-тесты middleware
npm run test:integration  # интеграционные тесты
npm run test:business     # бизнес-логика
npm run test:ci           # CI-режим
```

### Структура тестов

| Каталог | Тестов | Что проверяется |
|---------|--------|-----------------|
| `__tests__/unit/` | 18 | JWT-middleware, RBAC (все роли x read/write) |
| `__tests__/integration/auth` | 14 | login/register/me/roles — все HTTP-сценарии |
| `__tests__/integration/expenses` | 22 | CRUD расходов, RBAC, CSV-импорт, audit-log |
| `__tests__/integration/budgets` | 20 | CRUD бюджетов, bulk, copy, план/факт, RBAC |
| `__tests__/integration/parts-receipts` | 15 | Приходные накладные, склад, транзакции |
| `__tests__/integration/reports` | 17 | TCO, дашборд KPI, прогноз Holt-Winters |
| `__tests__/integration/audit` | 5 | Журнал операций, фильтры, RBAC |
| `__tests__/integration/zayavki` | 37 | Заявки, RBAC, ручное назначение, автонаводка |
| `__tests__/integration/remonty` | 20 | Ремонты: start/finish, стоимости, audit |
| `__tests__/business-logic/` | 33 | План/факт, CSV-парсер, JWT-tampering, Holt-Winters |
| **Итого** | **201** | — |

### Пороги покрытия

```js
// jest.config.js
coverageThreshold: {
  global: { branches: 60, functions: 70, lines: 70, statements: 70 }
}
```

Текущие значения: statements 80%, branches 80%, functions 84%, lines 83%.

---

## Безопасность

- **bcryptjs** — хэширование паролей с солью
- **JWT** — stateless-аутентификация с секретным ключом (срок жизни 7 дней)
- **RBAC** — проверка прав на каждом эндпоинте через middleware
- **Rate limiting** — ограничение на вход (5 попыток / 15 мин) и API (100 запросов / 15 мин)
- **SQL-инъекции** — параметризованные запросы через placeholder `?` (адаптирован под `$N` в pg)
- **Валидация** — express-validator на всех входных данных

---

## Дизайн и пользовательский интерфейс

- **Палитра**: белый / бежевый / серый
- **Шрифты**: Manrope (основной) + Cormorant Garamond (заголовки)
- **Эффекты**: glass-morphism карточки, floating labels, плывущие бежевые блобы фоном, точечная сетка с радиальной маской
- **Анимации**: скользящий индикатор табов, logo-glide, shake при ошибке, fade-in появление элементов
- **Локализация**: переключатель языка (RU / EN / TG) в UI, сохранение в localStorage
- **Адаптивность**: Flexbox и Grid, поддержка разных размеров экранов

---

## Тестовые учетные записи

После `npm run seed:demo` доступны 12 сотрудников. **Пароль у всех — `password`**.

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

---

## Документация API (Swagger)

Интерактивная документация доступна по адресу:

```
http://localhost:3000/api/docs
```

Включает описание всех эндпоинтов, моделей данных, примеры запросов и ответов.

---

## Лицензия

MIT © 2026 Carvix
