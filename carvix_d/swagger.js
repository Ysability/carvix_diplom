/**
 * Carvix — OpenAPI 3.0 specification (Swagger).
 *
 * Документация всех ключевых API-эндпоинтов системы управления автопарком.
 * Доступна по /api/docs после подключения в server.js.
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Carvix API',
      version: '1.0.0',
      description:
        'REST API системы управления автопарком, ТО и ремонтами. ' +
        'Ролевая модель: Пользователь, Диспетчер, Механик, Главный механик, Аналитик, Директор.',
      contact: { name: 'Carvix Team' },
    },
    servers: [
      { url: 'http://localhost:3000/api', description: 'Локальный сервер' },
      { url: 'https://carvix.onrender.com/api', description: 'Render (production)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Введите JWT-токен, полученный при login.',
        },
      },
      schemas: {
        LoginRequest: {
          type: 'object',
          required: ['login', 'password'],
          properties: {
            login: { type: 'string', example: 'ivanov' },
            password: { type: 'string', example: 'password' },
          },
        },
        RegisterRequest: {
          type: 'object',
          required: ['fio', 'login', 'password', 'rol_id', 'podrazdelenie_id'],
          properties: {
            fio: { type: 'string', example: 'Иванов И.И.' },
            login: { type: 'string', example: 'ivanov' },
            password: { type: 'string', example: 'password' },
            rol_id: { type: 'integer', example: 5 },
            podrazdelenie_id: { type: 'integer', example: 1 },
          },
        },
        ProfileUpdateRequest: {
          type: 'object',
          properties: {
            fio: { type: 'string', example: 'Иванов И.И.' },
            old_password: { type: 'string', example: 'password' },
            new_password: { type: 'string', example: 'newpassword' },
          },
        },
        ExpenseCreateRequest: {
          type: 'object',
          required: ['data', 'kategoriya', 'summa'],
          properties: {
            data: { type: 'string', format: 'date', example: '2026-05-14' },
            kategoriya: { type: 'string', enum: ['remont','zapchasti','topliv','strakhovka','nalog','moyka','prochee'] },
            summa: { type: 'number', minimum: 0, example: 5000 },
            ts_id: { type: 'integer', nullable: true },
            podrazdelenie_id: { type: 'integer', nullable: true },
            opisanie: { type: 'string', maxLength: 2000 },
          },
        },
        BudgetCreateRequest: {
          type: 'object',
          required: ['podrazdelenie_id', 'god', 'mesyats', 'kategoriya', 'plan_summa'],
          properties: {
            podrazdelenie_id: { type: 'integer', example: 1 },
            god: { type: 'integer', minimum: 2020, maximum: 2100, example: 2026 },
            mesyats: { type: 'integer', minimum: 1, maximum: 12, example: 5 },
            kategoriya: { type: 'string', enum: ['remont','zapchasti','topliv','prochee'] },
            plan_summa: { type: 'number', minimum: 0, example: 100000 },
          },
        },
        TransportCreateRequest: {
          type: 'object',
          required: ['gos_nomer', 'invent_nomer', 'model_id'],
          properties: {
            gos_nomer: { type: 'string', maxLength: 50, example: 'А123АА77' },
            invent_nomer: { type: 'string', maxLength: 50, example: 'INV-001' },
            model_id: { type: 'integer', example: 1 },
            podrazdelenie_id: { type: 'integer', nullable: true },
            probeg: { type: 'integer', minimum: 0 },
            data_vypuska: { type: 'string', format: 'date' },
            tekuschee_sostoyanie: { type: 'string', maxLength: 100 },
          },
        },
        RequestCreateRequest: {
          type: 'object',
          required: ['ts_id', 'tip_remonta_id'],
          properties: {
            ts_id: { type: 'integer', example: 1 },
            tip_remonta_id: { type: 'integer', example: 2 },
            prioritet: { type: 'integer', minimum: 1, maximum: 5, example: 3 },
            opisanie: { type: 'string', maxLength: 2000 },
          },
        },
        RepairFinishRequest: {
          type: 'object',
          required: ['stoimost_rabot', 'stoimost_zapchastey'],
          properties: {
            stoimost_rabot: { type: 'number', minimum: 0, example: 5000 },
            stoimost_zapchastey: { type: 'number', minimum: 0, example: 3000 },
            kommentariy: { type: 'string', maxLength: 2000 },
            itog: { type: 'string', maxLength: 255 },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Описание ошибки' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Авторизация, регистрация, профиль' },
      { name: 'Dashboard', description: 'Отчёты и дашборды для руководства и аналитика' },
      { name: 'Expenses', description: 'Реестр расходов автопарка' },
      { name: 'Budgets', description: 'Бюджеты подразделений (план/факт)' },
      { name: 'Transport', description: 'Транспортные средства' },
      { name: 'Requests', description: 'Заявки на ремонт' },
      { name: 'Repairs', description: 'Ремонты и назначение механиков' },
      { name: 'Exports', description: 'Экспорт отчётов (Excel, PDF)' },
    ],
    paths: {
      // ── AUTH ──
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Вход в систему',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: {
            200: { description: 'Успешный вход', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, user: { type: 'object' } } } } } },
            400: { description: 'Ошибка валидации', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: { description: 'Слишком много попыток', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Регистрация сотрудника',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } },
          },
          responses: {
            201: { description: 'Сотрудник зарегистрирован' },
            400: { description: 'Ошибка валидации' },
            409: { description: 'Логин уже занят' },
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Текущий пользователь',
          responses: {
            200: { description: 'Данные пользователя' },
            401: { description: 'Не авторизован' },
          },
        },
      },
      '/auth/profile': {
        put: {
          tags: ['Auth'],
          summary: 'Обновить профиль (ФИО / пароль)',
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProfileUpdateRequest' } } },
          },
          responses: {
            200: { description: 'Профиль обновлён' },
            400: { description: 'Ошибка валидации' },
            403: { description: 'Неверный текущий пароль' },
          },
        },
      },
      // ── DASHBOARD ──
      '/finance/reports/dashboard': {
        get: {
          tags: ['Dashboard'],
          summary: 'Дашборд Директора (KPI, динамика, структура, TOP-5 TCO)',
          parameters: [
            { name: 'god', in: 'query', schema: { type: 'integer' } },
            { name: 'podrazdelenie_id', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'Данные дашборда' },
            403: { description: 'Недостаточно прав' },
          },
        },
      },
      '/finance/reports/analyst-dashboard': {
        get: {
          tags: ['Dashboard'],
          summary: 'Дашборд Аналитика (загрузка механиков, типы ремонта, статусы)',
          parameters: [
            { name: 'god', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'Аналитические данные' },
            403: { description: 'Недостаточно прав' },
          },
        },
      },
      '/finance/reports/tco': {
        get: {
          tags: ['Dashboard'],
          summary: 'TCO по всем ТС',
          parameters: [
            { name: 'sort', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Список TCO' },
            403: { description: 'Недостаточно прав' },
          },
        },
      },
      // ── EXPENSES ──
      '/finance/expenses': {
        get: {
          tags: ['Expenses'],
          summary: 'Список расходов с фильтрами и пагинацией',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'kategoriya', in: 'query', schema: { type: 'string' } },
            { name: 'source', in: 'query', schema: { type: 'string' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Список расходов' } },
        },
        post: {
          tags: ['Expenses'],
          summary: 'Добавить прочий расход',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ExpenseCreateRequest' } } },
          },
          responses: {
            201: { description: 'Расход добавлен' },
            400: { description: 'Ошибка валидации' },
            403: { description: 'Недостаточно прав' },
          },
        },
      },
      '/finance/expenses/{id}': {
        put: {
          tags: ['Expenses'],
          summary: 'Редактировать прочий расход',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ExpenseCreateRequest' } } },
          },
          responses: {
            200: { description: 'Расход обновлён' },
            400: { description: 'Ошибка валидации' },
          },
        },
        delete: {
          tags: ['Expenses'],
          summary: 'Удалить прочий расход',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Удалено' }, 404: { description: 'Не найдено' } },
        },
      },
      // ── BUDGETS ──
      '/finance/budgets': {
        get: {
          tags: ['Budgets'],
          summary: 'Список бюджетов',
          parameters: [
            { name: 'god', in: 'query', schema: { type: 'integer' } },
            { name: 'mesyats', in: 'query', schema: { type: 'integer' } },
            { name: 'podrazdelenie_id', in: 'query', schema: { type: 'integer' } },
            { name: 'kategoriya', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Список бюджетов' } },
        },
        post: {
          tags: ['Budgets'],
          summary: 'Создать бюджет (только Директор)',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BudgetCreateRequest' } } },
          },
          responses: { 201: { description: 'Создано' }, 400: { description: 'Ошибка валидации' }, 403: { description: 'Недостаточно прав' } },
        },
      },
      '/finance/budgets/plan-fakt': {
        get: {
          tags: ['Budgets'],
          summary: 'План/факт по бюджетам',
          parameters: [
            { name: 'god', in: 'query', schema: { type: 'integer' } },
            { name: 'mesyats', in: 'query', schema: { type: 'integer' } },
            { name: 'podrazdelenie_id', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Данные план/факт' } },
        },
      },
      // ── TRANSPORT ──
      '/transport': {
        get: {
          tags: ['Transport'],
          summary: 'Список ТС',
          parameters: [
            { name: 'podrazdelenie_id', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Список ТС' } },
        },
        post: {
          tags: ['Transport'],
          summary: 'Создать ТС',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TransportCreateRequest' } } },
          },
          responses: { 201: { description: 'ТС создано' }, 400: { description: 'Ошибка валидации' } },
        },
      },
      '/transport/{id}': {
        get: {
          tags: ['Transport'],
          summary: 'Карточка ТС',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Данные ТС' }, 404: { description: 'Не найдено' } },
        },
        patch: {
          tags: ['Transport'],
          summary: 'Обновить ТС',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Обновлено' } },
        },
        delete: {
          tags: ['Transport'],
          summary: 'Удалить ТС (только Директор/Гл. механик)',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Удалено' }, 403: { description: 'Запрещено' } },
        },
      },
      // ── REQUESTS ──
      '/zayavki': {
        get: {
          tags: ['Requests'],
          summary: 'Список заявок с фильтрами',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'integer' } },
            { name: 'ts_id', in: 'query', schema: { type: 'integer' } },
            { name: 'podrazdelenie_id', in: 'query', schema: { type: 'integer' } },
            { name: 'mine', in: 'query', schema: { type: 'integer' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Список заявок' } },
        },
        post: {
          tags: ['Requests'],
          summary: 'Создать заявку',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RequestCreateRequest' } } },
          },
          responses: { 201: { description: 'Заявка создана' }, 400: { description: 'Ошибка валидации' } },
        },
      },
      '/zayavki/{id}/assign': {
        patch: {
          tags: ['Requests'],
          summary: 'Назначить механика на заявку (вручную)',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { mekhanik_id: { type: 'integer' } } } } },
          },
          responses: { 200: { description: 'Назначен' }, 400: { description: 'Ошибка' } },
        },
      },
      '/zayavki/{id}/auto-assign': {
        post: {
          tags: ['Requests'],
          summary: 'Автонаводка — назначить наименее загруженного механика',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Назначен автоматически' }, 409: { description: 'Нет механиков' } },
        },
      },
      '/zayavki/{id}/status': {
        patch: {
          tags: ['Requests'],
          summary: 'Сменить статус заявки',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { status_id: { type: 'integer' }, kommentariy: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Статус изменён' } },
        },
      },
      // ── REPAIRS ──
      '/remonty/my': {
        get: {
          tags: ['Repairs'],
          summary: 'Ремонты текущего механика (или все для Гл. механика/Директора)',
          responses: { 200: { description: 'Список ремонтов' } },
        },
      },
      '/remonty/{id}/start': {
        patch: {
          tags: ['Repairs'],
          summary: 'Начать ремонт',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Ремонт начат' }, 403: { description: 'Не назначен вам' } },
        },
      },
      '/remonty/{id}/finish': {
        patch: {
          tags: ['Repairs'],
          summary: 'Закрыть ремонт',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RepairFinishRequest' } } },
          },
          responses: { 200: { description: 'Ремонт завершён' }, 400: { description: 'Ошибка валидации' } },
        },
      },
      // ── EXPORTS ──
      '/finance/exports/excel/tco': {
        get: {
          tags: ['Exports'],
          summary: 'Excel: TCO по машинам',
          parameters: [
            { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Excel файл' } },
        },
      },
      '/finance/exports/excel/expenses': {
        get: {
          tags: ['Exports'],
          summary: 'Excel: реестр расходов',
          parameters: [
            { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string' } },
            { name: 'to', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Excel файл' } },
        },
      },
      '/finance/exports/excel/analyst': {
        get: {
          tags: ['Exports'],
          summary: 'Excel: аналитический отчёт (Аналитик)',
          parameters: [
            { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'god', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'Excel файл' } },
        },
      },
      '/finance/exports/pdf/monthly/{pdId}/{god}/{m}': {
        get: {
          tags: ['Exports'],
          summary: 'PDF: месячный отчёт по подразделению',
          parameters: [
            { name: 'pdId', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'god', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'm', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'PDF файл' } },
        },
      },
    },
  },
  apis: [], // spec собран вручную выше
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
