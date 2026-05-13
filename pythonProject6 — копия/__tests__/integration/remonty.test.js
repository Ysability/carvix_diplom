/**
 * Интеграционные тесты /api/remonty — рабочее место Механика.
 *
 * Покрывают:
 *   • RBAC (Пользователь и Аналитик не имеют доступа)
 *   • GET /my для Механика, Главного механика, Директора
 *   • PATCH /:id/start: проверка владельца, защита от завершённого ремонта
 *   • PATCH /:id/finish: валидация цен, статус → "Выполнена", audit
 */

const request = require('supertest');

const mockDb = require('../helpers/mockDb');
jest.mock('../../db', () => require('../helpers/mockDb'));

const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withRemonty: true, withFinance: false });

const userAuth      = `Bearer ${tokenFor(ROLES.USER)}`;
const analyticAuth  = `Bearer ${tokenFor(ROLES.ANALYTIC)}`;
const mechanicAuth  = `Bearer ${tokenFor(ROLES.WORKER, { id: 3 })}`;
const otherMechAuth = `Bearer ${tokenFor(ROLES.WORKER, { id: 4 })}`;
const directorAuth  = `Bearer ${tokenFor(ROLES.DIRECTOR)}`;

beforeEach(() => mockDb.__reset());

/* ─────────────────────────────────────────────────────────────
   GET /api/remonty/my
   ───────────────────────────────────────────────────────────── */
describe('GET /api/remonty/my', () => {
  it('401 без токена', async () => {
    await request(app).get('/api/remonty/my').expect(401);
  });

  it('403 для Пользователя', async () => {
    await request(app)
      .get('/api/remonty/my')
      .set('Authorization', userAuth)
      .expect(403);
  });

  it('403 для Аналитика', async () => {
    await request(app)
      .get('/api/remonty/my')
      .set('Authorization', analyticAuth)
      .expect(403);
  });

  it('Механик: SQL фильтрует по mekhanik_id = req.user.id', async () => {
    mockDb.__when(/FROM remont r/i, []);
    await request(app)
      .get('/api/remonty/my')
      .set('Authorization', mechanicAuth)
      .expect(200);

    const call = mockDb.__find(/FROM remont r/i);
    expect(call.sql).toMatch(/WHERE r\.mekhanik_id = \?/);
    expect(call.params).toEqual([3]);
  });

  it('Директор: без WHERE-фильтра по механику', async () => {
    mockDb.__when(/FROM remont r/i, []);
    await request(app)
      .get('/api/remonty/my')
      .set('Authorization', directorAuth)
      .expect(200);

    const call = mockDb.__find(/FROM remont r/i);
    expect(call.sql).not.toMatch(/WHERE r\.mekhanik_id = \?/);
  });

  it('возвращает items[] и total', async () => {
    mockDb.__when(/FROM remont r/i, [
      { remont_id: 1, zayavka_id: 10, gos_nomer: 'А123', status: 'В работе' },
      { remont_id: 2, zayavka_id: 11, gos_nomer: 'Б456', status: 'В работе' },
    ]);
    const r = await request(app)
      .get('/api/remonty/my')
      .set('Authorization', mechanicAuth)
      .expect(200);
    expect(r.body.total).toBe(2);
    expect(r.body.items[0].gos_nomer).toBe('А123');
  });
});

/* ─────────────────────────────────────────────────────────────
   PATCH /api/remonty/:id/start
   ───────────────────────────────────────────────────────────── */
describe('PATCH /api/remonty/:id/start', () => {
  it('403 для Пользователя', async () => {
    await request(app)
      .patch('/api/remonty/1/start')
      .set('Authorization', userAuth)
      .expect(403);
  });

  it('400 при некорректном id', async () => {
    await request(app)
      .patch('/api/remonty/abc/start')
      .set('Authorization', mechanicAuth)
      .expect(400);
  });

  it('404, если ремонт не найден', async () => {
    mockDb.__when(/FROM remont WHERE id = \?/i, []);
    await request(app)
      .patch('/api/remonty/99/start')
      .set('Authorization', mechanicAuth)
      .expect(404);
  });

  it('403, если ремонт назначен другому механику', async () => {
    mockDb.__when(/FROM remont WHERE id = \?/i, [
      { id: 1, zayavka_id: 10, mekhanik_id: 99, data_okonchaniya: null },
    ]);
    await request(app)
      .patch('/api/remonty/1/start')
      .set('Authorization', mechanicAuth)  // id=3
      .expect(403);
  });

  it('400, если ремонт уже завершён', async () => {
    mockDb.__when(/FROM remont WHERE id = \?/i, [
      { id: 1, zayavka_id: 10, mekhanik_id: 3, data_okonchaniya: new Date() },
    ]);
    await request(app)
      .patch('/api/remonty/1/start')
      .set('Authorization', mechanicAuth)
      .expect(400);
  });

  it('200: проставляет data_nachala и переводит заявку → "В работе"', async () => {
    mockDb
      .__when(/FROM remont WHERE id = \?/i, [
        { id: 1, zayavka_id: 10, mekhanik_id: 3, data_okonchaniya: null },
      ])
      .__when(/UPDATE remont SET data_nachala = COALESCE/i, [])
      .__when(/SELECT id FROM status WHERE nazvanie = \?/i, [{ id: 2 }])
      .__when(/UPDATE zayavka SET status_id = \?/i, [])
      .__when(/INSERT INTO finansoviy_log/i, []);

    const r = await request(app)
      .patch('/api/remonty/1/start')
      .set('Authorization', mechanicAuth)
      .expect(200);

    expect(r.body).toEqual({ id: 1, started: true });
    // Аудит-запись
    expect(mockDb.__find(/INSERT INTO finansoviy_log/i)).toBeTruthy();
  });

  it('Директор может стартовать чужой ремонт', async () => {
    mockDb
      .__when(/FROM remont WHERE id = \?/i, [
        { id: 1, zayavka_id: 10, mekhanik_id: 99, data_okonchaniya: null },
      ])
      .__when(/UPDATE remont SET data_nachala/i, [])
      .__when(/SELECT id FROM status WHERE nazvanie = \?/i, [{ id: 2 }])
      .__when(/UPDATE zayavka SET status_id/i, [])
      .__when(/INSERT INTO finansoviy_log/i, []);

    await request(app)
      .patch('/api/remonty/1/start')
      .set('Authorization', directorAuth)
      .expect(200);
  });
});

/* ─────────────────────────────────────────────────────────────
   PATCH /api/remonty/:id/finish
   ───────────────────────────────────────────────────────────── */
describe('PATCH /api/remonty/:id/finish', () => {
  it('400 при отрицательной стоимости работ', async () => {
    await request(app)
      .patch('/api/remonty/1/finish')
      .set('Authorization', mechanicAuth)
      .send({ stoimost_rabot: -100, stoimost_zapchastey: 0 })
      .expect(400);
  });

  it('400 при отрицательной стоимости запчастей', async () => {
    await request(app)
      .patch('/api/remonty/1/finish')
      .set('Authorization', mechanicAuth)
      .send({ stoimost_rabot: 1000, stoimost_zapchastey: -50 })
      .expect(400);
  });

  it('400 при не-числе', async () => {
    await request(app)
      .patch('/api/remonty/1/finish')
      .set('Authorization', mechanicAuth)
      .send({ stoimost_rabot: 'abc', stoimost_zapchastey: 0 })
      .expect(400);
  });

  it('404, если ремонт не найден', async () => {
    mockDb.__when(/FROM remont WHERE id = \?/i, []);
    await request(app)
      .patch('/api/remonty/99/finish')
      .set('Authorization', mechanicAuth)
      .send({ stoimost_rabot: 1000, stoimost_zapchastey: 200 })
      .expect(404);
  });

  it('403, если ремонт чужой', async () => {
    mockDb.__when(/FROM remont WHERE id = \?/i, [
      { id: 1, zayavka_id: 10, mekhanik_id: 4, data_okonchaniya: null },
    ]);
    await request(app)
      .patch('/api/remonty/1/finish')
      .set('Authorization', mechanicAuth)  // id=3
      .send({ stoimost_rabot: 1000, stoimost_zapchastey: 200 })
      .expect(403);
  });

  it('400, если ремонт уже завершён', async () => {
    mockDb.__when(/FROM remont WHERE id = \?/i, [
      { id: 1, zayavka_id: 10, mekhanik_id: 3, data_okonchaniya: new Date() },
    ]);
    await request(app)
      .patch('/api/remonty/1/finish')
      .set('Authorization', mechanicAuth)
      .send({ stoimost_rabot: 1000, stoimost_zapchastey: 200 })
      .expect(400);
  });

  it('200: закрывает ремонт, статус заявки → "Выполнена", audit с суммой', async () => {
    mockDb
      .__when(/FROM remont WHERE id = \?/i, [
        { id: 1, zayavka_id: 10, mekhanik_id: 3, data_okonchaniya: null },
      ])
      .__when(/UPDATE remont\s+SET data_nachala = COALESCE\(data_nachala, NOW\(\)\),\s+data_okonchaniya = NOW\(\)/i, [])
      .__when(/SELECT id FROM status WHERE nazvanie = \?/i, [{ id: 3 }])
      .__when(/UPDATE zayavka SET status_id = \?/i, [])
      .__when(/INSERT INTO finansoviy_log/i, []);

    const r = await request(app)
      .patch('/api/remonty/1/finish')
      .set('Authorization', mechanicAuth)
      .send({
        stoimost_rabot: 4500,
        stoimost_zapchastey: 1500,
        kommentariy: 'Заменили колодки',
        itog: 'Проблема устранена',
      })
      .expect(200);

    expect(r.body).toEqual({
      id: 1,
      stoimost_rabot: 4500,
      stoimost_zapchastey: 1500,
      itog: 'Проблема устранена',
      status: 'Выполнена',
    });

    // Аудит: сумма работ + запчастей = 6000
    const audit = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(audit.params[3]).toBe(6000);
  });
});
