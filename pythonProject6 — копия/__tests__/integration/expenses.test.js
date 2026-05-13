/**
 * Carvix — интеграционные тесты модуля «Расходы» (/api/finance/expenses).
 *
 * Покрываем:
 *   • RBAC: read для трёх ролей, write только для Директор+Главный механик;
 *   • валидацию POST/PUT (категория, сумма, обязательные поля);
 *   • правильное формирование ответа GET с пагинацией и итогом по сумме;
 *   • запись audit-log при каждой write-операции;
 *   • CSV-импорт: валидные и невалидные строки, отчёт об ошибках.
 */

jest.mock('../../db', () => require('../helpers/mockDb'));

const request = require('supertest');
const mockDb = require('../helpers/mockDb');
const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withAuth: false, withFinance: true });

const directorAuth = `Bearer ${tokenFor(ROLES.DIRECTOR)}`;
const analyticAuth = `Bearer ${tokenFor(ROLES.ANALYTIC)}`;
const userAuth     = `Bearer ${tokenFor(ROLES.USER)}`;
const mechanicAuth = `Bearer ${tokenFor(ROLES.MECHANIC)}`;

beforeEach(() => mockDb.__reset());

/* =============================================================
   GET /api/finance/expenses — list + filters + pagination
   ============================================================= */
describe('GET /api/finance/expenses', () => {
  it('401 без токена', async () => {
    await request(app).get('/api/finance/expenses').expect(401);
  });

  it('403 для роли Пользователь (нет в whitelist чтения)', async () => {
    await request(app)
      .get('/api/finance/expenses')
      .set('Authorization', userAuth)
      .expect(403);
  });

  it('200 для Аналитика; возвращает items + total + total_summa', async () => {
    mockDb
      .__when((sql) => /FROM \(.*\) x/is.test(sql) && /ORDER BY/i.test(sql), [
        { source: 'prochiy', source_id: '1', data: '2026-04-15',
          kategoriya: 'topliv', summa: '12500.00',
          ts_id: 7, gos_nomer: 'А777АА177',
          podrazdelenie_id: 1, podrazdelenie_nazvanie: 'ГУ',
          opisanie: 'Заправка' },
      ])
      .__when((sql) => /COUNT\(\*\).*FROM/is.test(sql),
        [{ total: 1, total_summa: '12500.00' }]);

    const r = await request(app)
      .get('/api/finance/expenses?from=2026-04-01&to=2026-04-30&kategoriya=topliv')
      .set('Authorization', analyticAuth)
      .expect(200);

    expect(r.body.items).toHaveLength(1);
    expect(r.body.total).toBe(1);
    expect(r.body.total_summa).toBe(12500);
    expect(r.body.limit).toBe(50); // дефолт
    expect(r.body.offset).toBe(0);
  });

  it('limit обрезается до 500 (защита от DoS-выкачки всей таблицы)', async () => {
    mockDb
      .__when(/FROM \(.*\) x/is, [])
      .__when(/COUNT/i, [{ total: 0, total_summa: 0 }]);

    const r = await request(app)
      .get('/api/finance/expenses?limit=99999')
      .set('Authorization', directorAuth)
      .expect(200);
    expect(r.body.limit).toBe(500);
  });
});

/* =============================================================
   POST /api/finance/expenses — RBAC + validation
   ============================================================= */
describe('POST /api/finance/expenses', () => {
  it('403 для Аналитика (read-only)', async () => {
    const r = await request(app)
      .post('/api/finance/expenses')
      .set('Authorization', analyticAuth)
      .send({ data: '2026-04-15', kategoriya: 'topliv', summa: 1000, ts_id: 1 })
      .expect(403);
    expect(r.body.error).toMatch(/Недостаточно прав/);
  });

  it.each([
    { name: 'нет даты',         body: { kategoriya: 'topliv', summa: 100, ts_id: 1 }, msg: /data обязательно/ },
    { name: 'плохая категория', body: { data: '2026-04-15', kategoriya: 'xxx', summa: 100, ts_id: 1 }, msg: /Недопустимая категория/ },
    { name: 'отрицательная сумма', body: { data: '2026-04-15', kategoriya: 'topliv', summa: -50, ts_id: 1 }, msg: /Сумма должна быть числом > 0/ },
    { name: 'нет ts_id и подразделения', body: { data: '2026-04-15', kategoriya: 'topliv', summa: 100 }, msg: /Укажите ts_id или podrazdelenie_id/ },
  ])('400: $name', async ({ body, msg }) => {
    const r = await request(app)
      .post('/api/finance/expenses')
      .set('Authorization', directorAuth)
      .send(body)
      .expect(400);
    expect(r.body.error).toMatch(msg);
  });

  it('201 + audit-log при успешной вставке', async () => {
    mockDb.__when(/INSERT INTO prochiy_raskhod/i, [{
      id: 101, ts_id: 7, podrazdelenie_id: 1,
      data: '2026-04-15', kategoriya: 'topliv',
      summa: '5000', opisanie: 'Тест',
    }]);

    const r = await request(app)
      .post('/api/finance/expenses')
      .set('Authorization', directorAuth)
      .send({ data: '2026-04-15', kategoriya: 'topliv', summa: 5000,
              ts_id: 7, opisanie: 'Тест' })
      .expect(201);

    expect(r.body.id).toBe(101);

    // Audit-log должен быть записан с тем же sotrudnik_id, что и в токене (1)
    const logCall = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(logCall).toBeTruthy();
    // params: [sotrudnik_id, obyekt_id, summa, kommentariy]
    expect(logCall.params[0]).toBe(1);     // sotrudnik_id (из токена Директора)
    expect(logCall.params[1]).toBe(101);   // obyekt_id
    expect(Number(logCall.params[2])).toBe(5000); // summa
  });
});

/* =============================================================
   PUT /api/finance/expenses/:id — inline-edit
   ============================================================= */
describe('PUT /api/finance/expenses/:id', () => {
  it('400 при отсутствии полей для изменения', async () => {
    const r = await request(app)
      .put('/api/finance/expenses/15')
      .set('Authorization', mechanicAuth)
      .send({})
      .expect(400);
    expect(r.body.error).toMatch(/Нет изменений/);
  });

  it('400 при недопустимой категории', async () => {
    await request(app)
      .put('/api/finance/expenses/15')
      .set('Authorization', mechanicAuth)
      .send({ kategoriya: 'lol' })
      .expect(400);
  });

  it('400 при отрицательной сумме', async () => {
    await request(app)
      .put('/api/finance/expenses/15')
      .set('Authorization', mechanicAuth)
      .send({ summa: -1 })
      .expect(400);
  });

  it('404, если запись не найдена в prochiy_raskhod', async () => {
    mockDb.__when(/UPDATE prochiy_raskhod/i, []);
    await request(app)
      .put('/api/finance/expenses/999')
      .set('Authorization', directorAuth)
      .send({ summa: 100 })
      .expect(404);
  });

  it('200 + audit-log при успешном изменении', async () => {
    mockDb.__when(/UPDATE prochiy_raskhod/i, [{
      id: 15, kategoriya: 'topliv', summa: '2500', data: '2026-04-15',
      opisanie: null, ts_id: 7, podrazdelenie_id: 1,
    }]);

    const r = await request(app)
      .put('/api/finance/expenses/15')
      .set('Authorization', directorAuth)
      .send({ summa: 2500 })
      .expect(200);

    expect(r.body.id).toBe(15);

    const logCall = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(logCall.params[1]).toBe(15);              // obyekt_id
    expect(Number(logCall.params[2])).toBe(2500);
    expect(logCall.sql).toMatch(/IZMENEN_RASKHOD/);
  });
});

/* =============================================================
   DELETE /api/finance/expenses/:id
   ============================================================= */
describe('DELETE /api/finance/expenses/:id', () => {
  it('400, если id не число', async () => {
    await request(app)
      .delete('/api/finance/expenses/abc')
      .set('Authorization', directorAuth)
      .expect(400);
  });

  it('404, если расход не найден', async () => {
    mockDb.__when(/SELECT id, summa, kategoriya FROM prochiy_raskhod/i, []);
    await request(app)
      .delete('/api/finance/expenses/777')
      .set('Authorization', directorAuth)
      .expect(404);
  });

  it('200 + audit-log; правильно удаляет существующий расход', async () => {
    mockDb
      .__when(/SELECT id, summa, kategoriya FROM prochiy_raskhod/i,
        [{ id: 12, summa: '8500', kategoriya: 'moyka' }])
      .__when(/DELETE FROM prochiy_raskhod/i, []);

    const r = await request(app)
      .delete('/api/finance/expenses/12')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body).toEqual({ ok: true, deleted_id: 12 });
    expect(mockDb.__find(/DELETE FROM prochiy_raskhod/i).params).toEqual([12]);
    const log = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(log.sql).toMatch(/UDALEN_RASKHOD/);
    expect(log.params[1]).toBe(12);
    expect(Number(log.params[2])).toBe(8500);
  });
});

/* =============================================================
   POST /api/finance/expenses/import-csv
   ============================================================= */
describe('POST /api/finance/expenses/import-csv', () => {
  beforeEach(() => {
    // Минимальные справочники, ожидаемые загрузчиком
    mockDb
      .__when(/SELECT id, gos_nomer, podrazdelenie_id FROM transportnoe_sredstvo/i, [
        { id: 7, gos_nomer: 'А777АА177', podrazdelenie_id: 1 },
        { id: 8, gos_nomer: 'В123ВВ77', podrazdelenie_id: 2 },
      ])
      .__when(/SELECT id, nazvanie FROM podrazdelenie/i, [
        { id: 1, nazvanie: 'Главное управление' },
        { id: 2, nazvanie: 'Северный филиал' },
      ])
      // Любой INSERT INTO prochiy_raskhod внутри транзакции — успешный
      .__when(/INSERT INTO prochiy_raskhod/i, []);
  });

  it('400, если файл не прислан', async () => {
    const r = await request(app)
      .post('/api/finance/expenses/import-csv')
      .set('Authorization', directorAuth)
      .expect(400);
    expect(r.body.error).toMatch(/Файл не загружен/);
  });

  it('успешно загружает 2 строки и возвращает inserted/skipped', async () => {
    const csv = [
      'data,kategoriya,summa,gos_nomer,opisanie',
      '2026-04-10,topliv,4500,А777АА177,Заправка',
      '2026-04-11,strakhovka,12000,А777АА177,ОСАГО',
    ].join('\n');

    const r = await request(app)
      .post('/api/finance/expenses/import-csv')
      .set('Authorization', directorAuth)
      .attach('file', Buffer.from(csv, 'utf8'), 'expenses.csv')
      .expect(200);

    expect(r.body).toMatchObject({ ok: true, inserted: 2, skipped: 0, errors: [] });
    expect(mockDb.__countMatching(/INSERT INTO prochiy_raskhod/i)).toBe(2);
  });

  it('пропускает строки с невалидной категорией / суммой / номером, остальные импортирует', async () => {
    const csv = [
      'data,kategoriya,summa,gos_nomer',
      '2026-04-10,topliv,4500,А777АА177',          // OK
      '2026-04-10,XXXXX,1000,А777АА177',           // плохая категория
      '2026-04-10,topliv,abc,А777АА177',           // плохая сумма
      '2026-04-10,topliv,500,НЕИЗВЕСТНЫЙ',         // нет такого ТС
      ',topliv,500,А777АА177',                     // нет даты
      '2026-04-12,nalog,9000,В123ВВ77',            // OK
    ].join('\n');

    const r = await request(app)
      .post('/api/finance/expenses/import-csv')
      .set('Authorization', directorAuth)
      .attach('file', Buffer.from(csv, 'utf8'), 'expenses.csv')
      .expect(200);

    expect(r.body.inserted).toBe(2);
    expect(r.body.skipped).toBe(4);
    expect(r.body.errors).toHaveLength(4);
    // Проверяем что в errors есть номера строк (заголовок = строка 1)
    const reasons = r.body.errors.map((e) => e.reason).join(' | ');
    expect(reasons).toMatch(/Недопустимая категория/);
    expect(reasons).toMatch(/Некорректная сумма/);
    expect(reasons).toMatch(/Гос\.номер.*не найден/);
    expect(reasons).toMatch(/Нет даты/);
  });

  it('логирует факт импорта в finansoviy_log', async () => {
    const csv = 'data,kategoriya,summa,gos_nomer\n2026-04-10,topliv,100,А777АА177';
    await request(app)
      .post('/api/finance/expenses/import-csv')
      .set('Authorization', directorAuth)
      .attach('file', Buffer.from(csv, 'utf8'), 'tiny.csv')
      .expect(200);

    const logCall = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(logCall.sql).toMatch(/IMPORT_CSV/);
    expect(logCall.params[0]).toBe(1); // sotrudnik_id Директора
  });
});
