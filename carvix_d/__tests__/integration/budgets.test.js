/**
 * Carvix — интеграционные тесты модуля «Бюджеты» (/api/finance/budgets).
 *
 * Покрываем:
 *   • RBAC: запись (POST/PUT/DELETE/bulk/copy-from-prev) разрешена только Директору;
 *   • валидацию: категория, мес. 1–12, plan_summa ≥ 0;
 *   • расчёт totals в /plan-fakt (отклонение, % исполнения);
 *   • bulk-сохранение: пропуск некорректных элементов, подсчёт created/updated;
 *   • copy-from-prev-year: коэффициент-множитель применяется правильно.
 */

jest.mock('../../db', () => require('../helpers/mockDb'));

const request = require('supertest');
const mockDb = require('../helpers/mockDb');
const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withAuth: false, withFinance: true });

const directorAuth = `Bearer ${tokenFor(ROLES.DIRECTOR)}`;
const analyticAuth = `Bearer ${tokenFor(ROLES.ANALYTIC)}`;
const mechanicAuth = `Bearer ${tokenFor(ROLES.MECHANIC)}`;

beforeEach(() => mockDb.__reset());

/* =============================================================
   GET /api/finance/budgets
   ============================================================= */
describe('GET /api/finance/budgets', () => {
  it('200 — список с фильтрацией по году', async () => {
    mockDb.__when(/FROM byudzhet b/i, [
      { id: 1, podrazdelenie_id: 1, podrazdelenie_nazvanie: 'ГУ',
        god: 2026, mesyats: 4, kategoriya: 'topliv', plan_summa: '50000' },
    ]);

    const r = await request(app)
      .get('/api/finance/budgets?god=2026')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body).toHaveLength(1);
    expect(r.body[0].kategoriya).toBe('topliv');

    // SQL получил параметр god
    const call = mockDb.__find(/FROM byudzhet b/i);
    expect(call.params).toEqual(['2026']);
  });
});

/* =============================================================
   GET /api/finance/budgets/plan-fakt
   ============================================================= */
describe('GET /api/finance/budgets/plan-fakt', () => {
  it('возвращает items + totals с отклонением и процентом исполнения', async () => {
    mockDb.__when(/FROM v_byudzhet_plan_fakt v/i, [
      { byudzhet_id: 1, podrazdelenie_id: 1, podrazdelenie_nazvanie: 'ГУ',
        god: 2026, mesyats: 4, kategoriya: 'topliv',
        plan_summa: '50000', fakt_summa: '40000',
        otklonenie: '10000', protsent_ispolneniya: '80.0' },
      { byudzhet_id: 2, podrazdelenie_id: 1, podrazdelenie_nazvanie: 'ГУ',
        god: 2026, mesyats: 4, kategoriya: 'remont',
        plan_summa: '100000', fakt_summa: '110000',
        otklonenie: '-10000', protsent_ispolneniya: '110.0' },
    ]);

    const r = await request(app)
      .get('/api/finance/budgets/plan-fakt?god=2026')
      .set('Authorization', analyticAuth)
      .expect(200);

    expect(r.body.items).toHaveLength(2);
    // 50 000 + 100 000 = 150 000 план
    expect(r.body.totals.plan).toBe(150000);
    // 40 000 + 110 000 = 150 000 факт → отклонение 0, процент 100
    expect(r.body.totals.fakt).toBe(150000);
    expect(r.body.totals.otklonenie).toBe(0);
    expect(r.body.totals.protsent).toBe(100);
  });

  it('totals.protsent = 0, если план нулевой (защита от деления на 0)', async () => {
    mockDb.__when(/FROM v_byudzhet_plan_fakt v/i, []);
    const r = await request(app)
      .get('/api/finance/budgets/plan-fakt?god=2026')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.totals).toEqual({ plan: 0, fakt: 0, otklonenie: 0, protsent: 0 });
  });
});

/* =============================================================
   POST /api/finance/budgets — RBAC + валидация
   ============================================================= */
describe('POST /api/finance/budgets', () => {
  it('403 для Аналитика и Главного механика (запись только Директор)', async () => {
    await request(app)
      .post('/api/finance/budgets')
      .set('Authorization', analyticAuth)
      .send({ podrazdelenie_id: 1, god: 2026, mesyats: 4, kategoriya: 'topliv', plan_summa: 1 })
      .expect(403);

    await request(app)
      .post('/api/finance/budgets')
      .set('Authorization', mechanicAuth)
      .send({ podrazdelenie_id: 1, god: 2026, mesyats: 4, kategoriya: 'topliv', plan_summa: 1 })
      .expect(403);
  });

  it.each([
    { name: 'без полей',                  body: {},                                                                msg: /Заполните все поля/ },
    { name: 'плохая категория',           body: { podrazdelenie_id: 1, god: 2026, mesyats: 4, kategoriya: 'lol', plan_summa: 1 }, msg: /Недопустимая категория/ },
    { name: 'отрицательная plan_summa',   body: { podrazdelenie_id: 1, god: 2026, mesyats: 4, kategoriya: 'topliv', plan_summa: -1 }, msg: /не может быть отрицательной/ },
    { name: 'месяц вне диапазона 1–12',   body: { podrazdelenie_id: 1, god: 2026, mesyats: 13, kategoriya: 'topliv', plan_summa: 1 }, msg: /Месяц должен быть от 1 до 12/ },
  ])('400: $name', async ({ body, msg }) => {
    const r = await request(app)
      .post('/api/finance/budgets')
      .set('Authorization', directorAuth)
      .send(body)
      .expect(400);
    expect(r.body.error).toMatch(msg);
  });

  it('201 + audit-log при успешной вставке', async () => {
    mockDb.__when(/INSERT INTO byudzhet/i, [{
      id: 99, podrazdelenie_id: 1, god: 2026, mesyats: 4,
      kategoriya: 'topliv', plan_summa: '60000',
    }]);

    const r = await request(app)
      .post('/api/finance/budgets')
      .set('Authorization', directorAuth)
      .send({ podrazdelenie_id: 1, god: 2026, mesyats: 4,
              kategoriya: 'topliv', plan_summa: 60000 })
      .expect(201);

    expect(r.body.id).toBe(99);

    const log = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(log.sql).toMatch(/SOZDAN_BYUDZHET/);
    expect(log.params[0]).toBe(1);          // sotrudnik_id Директора
    expect(log.params[1]).toBe(99);         // obyekt_id
    expect(Number(log.params[2])).toBe(60000);
  });
});

/* =============================================================
   POST /api/finance/budgets/bulk
   ============================================================= */
describe('POST /api/finance/budgets/bulk', () => {
  it('403 для Главного механика', async () => {
    await request(app)
      .post('/api/finance/budgets/bulk')
      .set('Authorization', mechanicAuth)
      .send({ items: [] })
      .expect(403);
  });

  it('400, если items пустой', async () => {
    await request(app)
      .post('/api/finance/budgets/bulk')
      .set('Authorization', directorAuth)
      .send({ items: [] })
      .expect(400);
  });

  it('пропускает невалидные элементы и считает created/updated по флагу is_new', async () => {
    // Симулируем pg-возврат: для одних строк xmax=0 (created), для других нет (updated)
    let callIdx = 0;
    mockDb.__when(/INSERT INTO byudzhet/i, () => {
      callIdx++;
      // Чередуем: первая запись новая, вторая обновлена
      return [{ id: callIdx, is_new: callIdx === 1 }];
    });

    const items = [
      { podrazdelenie_id: 1, god: 2026, mesyats: 4, kategoriya: 'topliv',     plan_summa: 100 },
      { podrazdelenie_id: 1, god: 2026, mesyats: 4, kategoriya: 'remont',    plan_summa: 200 },
      // Невалидный — будет пропущен
      { podrazdelenie_id: 1, god: 2026, mesyats: 4, kategoriya: 'BAD',       plan_summa: 1 },
      { podrazdelenie_id: null, god: 2026, mesyats: 4, kategoriya: 'topliv', plan_summa: 1 },
    ];

    const r = await request(app)
      .post('/api/finance/budgets/bulk')
      .set('Authorization', directorAuth)
      .send({ items })
      .expect(200);

    expect(r.body).toEqual({ ok: true, created: 1, updated: 1 });
    // INSERT INTO byudzhet вызвался ровно 2 раза (только валидные)
    expect(mockDb.__countMatching(/INSERT INTO byudzhet/i)).toBe(2);

    const log = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(log.sql).toMatch(/BULK_BYUDZHET/);
  });
});

/* =============================================================
   POST /api/finance/budgets/copy-from-prev-year
   ============================================================= */
describe('POST /api/finance/budgets/copy-from-prev-year', () => {
  it('400, если не указан god', async () => {
    await request(app)
      .post('/api/finance/budgets/copy-from-prev-year')
      .set('Authorization', directorAuth)
      .send({})
      .expect(400);
  });

  it('400 при коэффициенте ≤ 0', async () => {
    await request(app)
      .post('/api/finance/budgets/copy-from-prev-year')
      .set('Authorization', directorAuth)
      .send({ god: 2026, koeff: 0 })
      .expect(400);

    await request(app)
      .post('/api/finance/budgets/copy-from-prev-year')
      .set('Authorization', directorAuth)
      .send({ god: 2026, koeff: -2 })
      .expect(400);
  });

  it('копирует все строки прошлого года и применяет koeff к plan_summa', async () => {
    mockDb
      .__when(/SELECT podrazdelenie_id, mesyats, kategoriya, plan_summa\s+FROM byudzhet/i, [
        { podrazdelenie_id: 1, mesyats: 1, kategoriya: 'topliv', plan_summa: '10000' },
        { podrazdelenie_id: 1, mesyats: 2, kategoriya: 'topliv', plan_summa: '20000' },
      ])
      .__when(/INSERT INTO byudzhet/i, []);

    const r = await request(app)
      .post('/api/finance/budgets/copy-from-prev-year')
      .set('Authorization', directorAuth)
      .send({ god: 2026, koeff: 1.1 })
      .expect(200);

    expect(r.body).toMatchObject({
      ok: true, copied: 2, target_god: 2026, source_god: 2025, koeff: 1.1,
    });

    // INSERT INTO byudzhet вызвался дважды и plan_summa = source × 1.1
    const inserts = mockDb.__calls.filter((c) => /INSERT INTO byudzhet/i.test(c.sql));
    expect(inserts).toHaveLength(2);
    expect(Number(inserts[0].params[4])).toBeCloseTo(11000, 2);  // 10 000 × 1.1
    expect(Number(inserts[1].params[4])).toBeCloseTo(22000, 2);  // 20 000 × 1.1
  });
});

/* =============================================================
   PUT /api/finance/budgets/:id
   ============================================================= */
describe('PUT /api/finance/budgets/:id', () => {
  it('400 при отрицательной plan_summa', async () => {
    await request(app)
      .put('/api/finance/budgets/1')
      .set('Authorization', directorAuth)
      .send({ plan_summa: -1 })
      .expect(400);
  });

  it('404, если бюджет не найден', async () => {
    mockDb.__when(/UPDATE byudzhet/i, []);
    await request(app)
      .put('/api/finance/budgets/777')
      .set('Authorization', directorAuth)
      .send({ plan_summa: 100 })
      .expect(404);
  });

  it('200 + audit-log при успешном обновлении', async () => {
    mockDb.__when(/UPDATE byudzhet/i, [{
      id: 5, plan_summa: '99000', podrazdelenie_id: 1,
      god: 2026, mesyats: 4, kategoriya: 'topliv',
    }]);

    const r = await request(app)
      .put('/api/finance/budgets/5')
      .set('Authorization', directorAuth)
      .send({ plan_summa: 99000 })
      .expect(200);

    expect(r.body.plan_summa).toBe('99000');

    const log = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(log.sql).toMatch(/IZMENEN_BYUDZHET/);
    expect(log.params[1]).toBe(5);
  });
});

/* =============================================================
   DELETE /api/finance/budgets/:id
   ============================================================= */
describe('DELETE /api/finance/budgets/:id', () => {
  it('404, если не найдено', async () => {
    mockDb.__when(/DELETE FROM byudzhet/i, []);
    await request(app)
      .delete('/api/finance/budgets/123')
      .set('Authorization', directorAuth)
      .expect(404);
  });

  it('200 + audit-log при успешном удалении', async () => {
    mockDb.__when(/DELETE FROM byudzhet/i, [{ plan_summa: '50000' }]);

    const r = await request(app)
      .delete('/api/finance/budgets/3')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body).toEqual({ ok: true, deleted_id: 3 });
    const log = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(log.sql).toMatch(/UDALEN_BYUDZHET/);
    expect(Number(log.params[2])).toBe(50000);
  });
});
