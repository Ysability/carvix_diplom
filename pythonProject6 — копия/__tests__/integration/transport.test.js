/**
 * Интеграционные тесты /api/transport.
 *
 * Покрывают:
 *   • справочники (марки/модели/подразделения, find-or-create)
 *   • RBAC: Пользователь видит только своё подразделение
 *   • POST: Пользователь принудительно ставится в своё подразделение
 *   • уникальность гос-номера (409)
 *   • PATCH: разрешённые поля, защита от обновления чужого ТС Пользователем
 *   • DELETE: только Директор/Гл. механик; 409 если есть заявки
 */

const request = require('supertest');

const mockDb = require('../helpers/mockDb');
jest.mock('../../db', () => require('../helpers/mockDb'));

const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withTransport: true, withFinance: false });

const userAuth      = `Bearer ${tokenFor(ROLES.USER, { podrazdelenie_id: 1 })}`;
const otherUserAuth = `Bearer ${tokenFor(ROLES.USER, { id: 9, podrazdelenie_id: 2 })}`;
const directorAuth  = `Bearer ${tokenFor(ROLES.DIRECTOR)}`;
const analyticAuth  = `Bearer ${tokenFor(ROLES.ANALYTIC)}`;
const dispetcherAuth = `Bearer ${tokenFor(ROLES.DISPATCHER)}`;

beforeEach(() => mockDb.__reset());

/* ============================================================
   Словари
   ============================================================ */
describe('GET /api/transport/dict/*', () => {
  it('401 без токена', async () => {
    await request(app).get('/api/transport/dict/marki').expect(401);
  });

  it('возвращает список марок', async () => {
    mockDb.__when(/FROM marka/i, [{ id: 1, nazvanie: 'Toyota' }, { id: 2, nazvanie: 'KAMAZ' }]);
    const r = await request(app)
      .get('/api/transport/dict/marki')
      .set('Authorization', userAuth)
      .expect(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0].nazvanie).toBe('Toyota');
  });

  it('фильтрует модели по marka_id', async () => {
    mockDb.__when(/FROM model/i, [{ id: 5, nazvanie: 'Camry', marka_id: 1, marka: 'Toyota' }]);
    await request(app)
      .get('/api/transport/dict/modeli?marka_id=1')
      .set('Authorization', userAuth)
      .expect(200);
    const call = mockDb.__find(/FROM model/i);
    expect(call.sql).toMatch(/WHERE m\.marka_id = \?/);
    expect(call.params).toEqual([1]);
  });

  it('POST /dict/marki: возвращает существующую марку без создания', async () => {
    mockDb.__when(/SELECT id, nazvanie FROM marka WHERE LOWER/i, [{ id: 1, nazvanie: 'Toyota' }]);
    const r = await request(app)
      .post('/api/transport/dict/marki')
      .set('Authorization', userAuth)
      .send({ nazvanie: 'toyota' })
      .expect(200);
    expect(r.body).toEqual({ id: 1, nazvanie: 'Toyota', created: false });
  });

  it('POST /dict/marki: создаёт новую марку', async () => {
    mockDb
      .__when(/SELECT id, nazvanie FROM marka WHERE LOWER/i, [])
      .__when(/INSERT INTO marka/i, [{ id: 42 }]);
    const r = await request(app)
      .post('/api/transport/dict/marki')
      .set('Authorization', userAuth)
      .send({ nazvanie: 'Lada' })
      .expect(201);
    expect(r.body).toEqual({ id: 42, nazvanie: 'Lada', created: true });
  });

  it('POST /dict/marki: 400 без nazvanie', async () => {
    await request(app)
      .post('/api/transport/dict/marki')
      .set('Authorization', userAuth)
      .send({})
      .expect(400);
  });

  it('POST /dict/modeli: 400 если марка не найдена', async () => {
    mockDb.__when(/SELECT id FROM marka WHERE id = \?/i, []);
    await request(app)
      .post('/api/transport/dict/modeli')
      .set('Authorization', userAuth)
      .send({ marka_id: 999, nazvanie: 'X' })
      .expect(400);
  });

  it('POST /dict/modeli: создаёт модель', async () => {
    mockDb
      .__when(/SELECT id FROM marka WHERE id = \?/i, [{ id: 1 }])
      .__when(/SELECT id, nazvanie, marka_id FROM model WHERE marka_id/i, [])
      .__when(/INSERT INTO model/i, [{ id: 7 }]);
    const r = await request(app)
      .post('/api/transport/dict/modeli')
      .set('Authorization', userAuth)
      .send({ marka_id: 1, nazvanie: 'Vesta' })
      .expect(201);
    expect(r.body).toEqual({ id: 7, marka_id: 1, nazvanie: 'Vesta', created: true });
  });
});

/* ============================================================
   GET /api/transport
   ============================================================ */
describe('GET /api/transport', () => {
  it('Пользователь: SQL фильтрует по sozdatel_id (свои ТС)', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo ts/i, []);
    await request(app)
      .get('/api/transport')
      .set('Authorization', userAuth)
      .expect(200);
    const call = mockDb.__find(/FROM transportnoe_sredstvo ts/i);
    expect(call.sql).toMatch(/WHERE ts\.sozdatel_id = \?/);
    // ROLES.USER — id=4 (из helpers/auth.js), без переопределения в tokenFor идёт 4
    expect(call.params).toEqual([4]);
  });

  it('Директор: без фильтрации по sozdatel_id', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo ts/i, []);
    await request(app)
      .get('/api/transport')
      .set('Authorization', directorAuth)
      .expect(200);
    const call = mockDb.__find(/FROM transportnoe_sredstvo ts/i);
    expect(call.sql).not.toMatch(/WHERE ts\.sozdatel_id/);
  });

  it('Директор: фильтр ?podrazdelenie_id=2 пробрасывается', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo ts/i, []);
    await request(app)
      .get('/api/transport?podrazdelenie_id=2')
      .set('Authorization', directorAuth)
      .expect(200);
    const call = mockDb.__find(/FROM transportnoe_sredstvo ts/i);
    expect(call.sql).toMatch(/WHERE ts\.podrazdelenie_id = \?/);
    expect(call.params).toEqual([2]);
  });

  it('возвращает items[] и total', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo ts/i, [
      { id: 1, gos_nomer: 'А123АА', marka: 'Toyota', model: 'Camry', kolichestvo_zayavok: 2 },
    ]);
    const r = await request(app)
      .get('/api/transport')
      .set('Authorization', userAuth)
      .expect(200);
    expect(r.body.total).toBe(1);
    expect(r.body.items[0].gos_nomer).toBe('А123АА');
  });
});

/* ============================================================
   GET /api/transport/:id
   ============================================================ */
describe('GET /api/transport/:id', () => {
  it('400 при невалидном id', async () => {
    await request(app)
      .get('/api/transport/abc')
      .set('Authorization', userAuth)
      .expect(400);
  });

  it('404 если не найдено', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo ts/i, []);
    await request(app)
      .get('/api/transport/999')
      .set('Authorization', userAuth)
      .expect(404);
  });

  it('Пользователь получает 403 на чужое ТС (sozdatel_id != id)', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo ts/i, [
      { id: 1, sozdatel_id: 99, gos_nomer: 'X' },
    ]);
    await request(app)
      .get('/api/transport/1')
      .set('Authorization', userAuth)  // id=4
      .expect(403);
  });

  it('Пользователь видит своё ТС', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo ts/i, [
      { id: 1, sozdatel_id: 4, gos_nomer: 'X' },
    ]);
    await request(app)
      .get('/api/transport/1')
      .set('Authorization', userAuth)
      .expect(200);
  });

  it('Директор видит любое ТС', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo ts/i, [
      { id: 1, sozdatel_id: 99, gos_nomer: 'X' },
    ]);
    await request(app)
      .get('/api/transport/1')
      .set('Authorization', directorAuth)
      .expect(200);
  });
});

/* ============================================================
   POST /api/transport
   ============================================================ */
describe('POST /api/transport', () => {
  const validBody = {
    gos_nomer: 'В007ВВ',
    invent_nomer: 'INV-001',
    model_id: 5,
    probeg: 1000,
  };

  it('400 без обязательных полей', async () => {
    await request(app)
      .post('/api/transport')
      .set('Authorization', userAuth)
      .send({ gos_nomer: 'X' })
      .expect(400);
  });

  it('400 если модель не существует', async () => {
    mockDb.__when(/SELECT id FROM model WHERE id/i, []);
    await request(app)
      .post('/api/transport')
      .set('Authorization', userAuth)
      .send(validBody)
      .expect(400);
  });

  it('409 если гос-номер уже существует', async () => {
    mockDb
      .__when(/SELECT id FROM model WHERE id/i, [{ id: 5 }])
      .__when(/SELECT id FROM podrazdelenie WHERE id/i, [{ id: 1 }])
      .__when(/SELECT id FROM transportnoe_sredstvo WHERE LOWER\(gos_nomer\)/i, [{ id: 11 }]);
    await request(app)
      .post('/api/transport')
      .set('Authorization', userAuth)
      .send(validBody)
      .expect(409);
  });

  it('Пользователь: ТС создаётся в его подразделении (даже если в body передано другое)', async () => {
    mockDb
      .__when(/SELECT id FROM model WHERE id/i, [{ id: 5 }])
      .__when(/SELECT id FROM podrazdelenie WHERE id/i, [{ id: 1 }])
      .__when(/SELECT id FROM transportnoe_sredstvo WHERE LOWER\(gos_nomer\)/i, [])
      .__when(/INSERT INTO transportnoe_sredstvo/i, [{ id: 100 }])
      .__when(/INSERT INTO finansoviy_log/i, []);

    const r = await request(app)
      .post('/api/transport')
      .set('Authorization', userAuth)  // pd=1
      .send({ ...validBody, podrazdelenie_id: 999 })  // попытка чужого pd
      .expect(201);
    expect(r.body.id).toBe(100);

    const insert = mockDb.__find(/INSERT INTO transportnoe_sredstvo/i);
    // params: gos_nomer, invent_nomer, model_id, podrazdelenie_id, probeg, data_vypuska, sostoyanie
    expect(insert.params[3]).toBe(1); // принудительно своё подразделение
  });

  it('Директор: может указать любое подразделение', async () => {
    mockDb
      .__when(/SELECT id FROM model WHERE id/i, [{ id: 5 }])
      .__when(/SELECT id FROM podrazdelenie WHERE id/i, [{ id: 7 }])
      .__when(/SELECT id FROM transportnoe_sredstvo WHERE LOWER\(gos_nomer\)/i, [])
      .__when(/INSERT INTO transportnoe_sredstvo/i, [{ id: 200 }])
      .__when(/INSERT INTO finansoviy_log/i, []);

    await request(app)
      .post('/api/transport')
      .set('Authorization', directorAuth)
      .send({ ...validBody, podrazdelenie_id: 7 })
      .expect(201);

    const insert = mockDb.__find(/INSERT INTO transportnoe_sredstvo/i);
    expect(insert.params[3]).toBe(7);
  });

  it('Регрессия: если в JWT нет podrazdelenie_id (старый токен) — берётся из БД', async () => {
    // Эмулируем старый JWT: токен Пользователя без поля podrazdelenie_id
    const legacyToken = `Bearer ${tokenFor(ROLES.USER, { podrazdelenie_id: undefined })}`;

    mockDb
      // ВАЖНО: сначала идёт fallback-чтение подразделения из БД
      .__when(/SELECT podrazdelenie_id FROM sotrudnik WHERE id = \?/i, [{ podrazdelenie_id: 7 }])
      .__when(/SELECT id FROM model WHERE id/i, [{ id: 5 }])
      .__when(/SELECT id FROM podrazdelenie WHERE id/i, [{ id: 7 }])
      .__when(/SELECT id FROM transportnoe_sredstvo WHERE LOWER\(gos_nomer\)/i, [])
      .__when(/INSERT INTO transportnoe_sredstvo/i, [{ id: 555 }])
      .__when(/INSERT INTO finansoviy_log/i, []);

    await request(app)
      .post('/api/transport')
      .set('Authorization', legacyToken)
      .send(validBody)
      .expect(201);

    const insert = mockDb.__find(/INSERT INTO transportnoe_sredstvo/i);
    expect(insert.params[3]).toBe(7); // pd_id из БД, а не undefined
  });

  it('400, если в JWT нет podrazdelenie_id и в БД у пользователя тоже null', async () => {
    const legacyToken = `Bearer ${tokenFor(ROLES.USER, { podrazdelenie_id: undefined })}`;
    mockDb.__when(/SELECT podrazdelenie_id FROM sotrudnik WHERE id = \?/i, [{ podrazdelenie_id: null }]);
    await request(app)
      .post('/api/transport')
      .set('Authorization', legacyToken)
      .send(validBody)
      .expect(400);
  });

  it('по умолчанию проставляет sostoyanie = "В строю"', async () => {
    mockDb
      .__when(/SELECT id FROM model WHERE id/i, [{ id: 5 }])
      .__when(/SELECT id FROM podrazdelenie WHERE id/i, [{ id: 1 }])
      .__when(/SELECT id FROM transportnoe_sredstvo WHERE LOWER\(gos_nomer\)/i, [])
      .__when(/INSERT INTO transportnoe_sredstvo/i, [{ id: 1 }])
      .__when(/INSERT INTO finansoviy_log/i, []);
    await request(app)
      .post('/api/transport')
      .set('Authorization', userAuth)
      .send(validBody)
      .expect(201);
    const insert = mockDb.__find(/INSERT INTO transportnoe_sredstvo/i);
    expect(insert.params[6]).toBe('В строю');
  });
});

/* ============================================================
   PATCH /api/transport/:id
   ============================================================ */
describe('PATCH /api/transport/:id', () => {
  it('404 если не найдено', async () => {
    mockDb.__when(/SELECT id, podrazdelenie_id, sozdatel_id FROM transportnoe_sredstvo/i, []);
    await request(app)
      .patch('/api/transport/99')
      .set('Authorization', userAuth)
      .send({ probeg: 1000 })
      .expect(404);
  });

  it('Пользователь получает 403 на чужое ТС', async () => {
    mockDb.__when(/SELECT id, podrazdelenie_id, sozdatel_id FROM transportnoe_sredstvo/i, [
      { id: 1, podrazdelenie_id: 99, sozdatel_id: 99 },
    ]);
    await request(app)
      .patch('/api/transport/1')
      .set('Authorization', userAuth)  // id=4
      .send({ probeg: 5000 })
      .expect(403);
  });

  it('400 если нет полей для обновления', async () => {
    mockDb.__when(/SELECT id, podrazdelenie_id, sozdatel_id FROM transportnoe_sredstvo/i, [
      { id: 1, podrazdelenie_id: 1, sozdatel_id: 4 },
    ]);
    await request(app)
      .patch('/api/transport/1')
      .set('Authorization', userAuth)
      .send({})
      .expect(400);
  });

  it('200: обновляет probeg + audit', async () => {
    mockDb
      .__when(/SELECT id, podrazdelenie_id, sozdatel_id FROM transportnoe_sredstvo/i, [
        { id: 1, podrazdelenie_id: 1, sozdatel_id: 4 },
      ])
      .__when(/UPDATE transportnoe_sredstvo SET/i, [])
      .__when(/INSERT INTO finansoviy_log/i, []);
    const r = await request(app)
      .patch('/api/transport/1')
      .set('Authorization', userAuth)
      .send({ probeg: 12345 })
      .expect(200);
    expect(r.body).toEqual({ id: 1, updated: true });

    const update = mockDb.__find(/UPDATE transportnoe_sredstvo SET/i);
    expect(update.sql).toMatch(/probeg = \?/);
    expect(update.params[0]).toBe(12345);
  });

  it('игнорирует неразрешённые поля (gos_nomer)', async () => {
    mockDb.__when(/SELECT id, podrazdelenie_id, sozdatel_id FROM transportnoe_sredstvo/i, [
      { id: 1, podrazdelenie_id: 1, sozdatel_id: 4 },
    ]);
    // Передаём только не-allowed поле → должно быть 400
    await request(app)
      .patch('/api/transport/1')
      .set('Authorization', userAuth)
      .send({ gos_nomer: 'HACKED' })
      .expect(400);
  });
});

/* ============================================================
   DELETE /api/transport/:id
   ============================================================ */
describe('DELETE /api/transport/:id', () => {
  it('Пользователь: 403 на чужое ТС (sozdatel_id != id)', async () => {
    mockDb.__when(/SELECT id, sozdatel_id FROM transportnoe_sredstvo/i, [
      { id: 1, sozdatel_id: 99 },
    ]);
    await request(app)
      .delete('/api/transport/1')
      .set('Authorization', userAuth)
      .expect(403);
  });

  it('Пользователь: 200 на своё ТС (sozdatel_id == id)', async () => {
    mockDb
      .__when(/SELECT id, sozdatel_id FROM transportnoe_sredstvo/i, [
        { id: 1, sozdatel_id: 4 },
      ])
      .__when(/SELECT COUNT\(\*\)::int AS n FROM zayavka WHERE ts_id/i, [{ n: 0 }])
      .__when(/DELETE FROM transportnoe_sredstvo/i, [{ id: 1 }])
      .__when(/INSERT INTO finansoviy_log/i, []);
    const r = await request(app)
      .delete('/api/transport/1')
      .set('Authorization', userAuth)  // id=4
      .expect(200);
    expect(r.body).toEqual({ id: 1, deleted: true });
  });

  it('Аналитик: 403 (не в ROLE_DELETE и не владелец)', async () => {
    mockDb.__when(/SELECT id, sozdatel_id FROM transportnoe_sredstvo/i, [
      { id: 1, sozdatel_id: 99 },
    ]);
    await request(app)
      .delete('/api/transport/1')
      .set('Authorization', analyticAuth)
      .expect(403);
  });

  it('Диспетчер: 403 на чужое ТС', async () => {
    mockDb.__when(/SELECT id, sozdatel_id FROM transportnoe_sredstvo/i, [
      { id: 1, sozdatel_id: 99 },
    ]);
    await request(app)
      .delete('/api/transport/1')
      .set('Authorization', dispetcherAuth)
      .expect(403);
  });

  it('Директор: может удалить чужое ТС', async () => {
    mockDb
      .__when(/SELECT id, sozdatel_id FROM transportnoe_sredstvo/i, [
        { id: 1, sozdatel_id: 999 },
      ])
      .__when(/SELECT COUNT\(\*\)::int AS n FROM zayavka WHERE ts_id/i, [{ n: 0 }])
      .__when(/DELETE FROM transportnoe_sredstvo/i, [{ id: 1 }])
      .__when(/INSERT INTO finansoviy_log/i, []);
    await request(app)
      .delete('/api/transport/1')
      .set('Authorization', directorAuth)
      .expect(200);
  });

  it('409 если на ТС есть заявки', async () => {
    mockDb
      .__when(/SELECT id, sozdatel_id FROM transportnoe_sredstvo/i, [
        { id: 1, sozdatel_id: 1 },
      ])
      .__when(/SELECT COUNT\(\*\)::int AS n FROM zayavka WHERE ts_id/i, [{ n: 3 }]);
    await request(app)
      .delete('/api/transport/1')
      .set('Authorization', directorAuth)
      .expect(409);
  });

  it('404 если ТС не найдено', async () => {
    mockDb.__when(/SELECT id, sozdatel_id FROM transportnoe_sredstvo/i, []);
    await request(app)
      .delete('/api/transport/999')
      .set('Authorization', directorAuth)
      .expect(404);
  });
});
