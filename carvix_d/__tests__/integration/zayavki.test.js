/**
 * Интеграционные тесты /api/zayavki — заявки на ремонт.
 *
 * Покрывают:
 *   • RBAC чтения (Пользователь видит только свои; Механик — назначенные)
 *   • Создание заявки + ограничение Пользователя на ТС своего подразделения
 *   • Назначение механика вручную
 *   • Автонаводка: локальный пул, fallback на глобальный, отсутствие механиков
 *   • Смена статуса
 *   • 404/400 ошибки и edge-cases
 */

const request = require('supertest');

const mockDb = require('../helpers/mockDb');
jest.mock('../../db', () => require('../helpers/mockDb'));

const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withZayavki: true, withFinance: false });

const userAuth        = `Bearer ${tokenFor(ROLES.USER, { id: 7, podrazdelenie_id: 2 })}`;
const dispetcherAuth  = `Bearer ${tokenFor(ROLES.DISPATCHER, { id: 5, podrazdelenie_id: 1 })}`;
const mechanicAuth    = `Bearer ${tokenFor(ROLES.WORKER, { id: 3, podrazdelenie_id: 4 })}`;
const directorAuth    = `Bearer ${tokenFor(ROLES.DIRECTOR)}`;
const analyticAuth    = `Bearer ${tokenFor(ROLES.ANALYTIC)}`;

beforeEach(() => mockDb.__reset());

/* ─────────────────────────────────────────────────────────────
   Справочники
   ───────────────────────────────────────────────────────────── */
describe('GET /api/zayavki/dict/*', () => {
  it('401 без токена', async () => {
    await request(app).get('/api/zayavki/dict/statusy').expect(401);
  });

  it('возвращает список статусов', async () => {
    mockDb.__when(/FROM status/i, [
      { id: 1, nazvanie: 'Новая' },
      { id: 2, nazvanie: 'В работе' },
    ]);
    const r = await request(app)
      .get('/api/zayavki/dict/statusy')
      .set('Authorization', userAuth)
      .expect(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0].nazvanie).toBe('Новая');
  });

  it('GET /dict/ts: Пользователь получает только своё подразделение (filter в SQL)', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo/i, []);
    await request(app)
      .get('/api/zayavki/dict/ts')
      .set('Authorization', userAuth)
      .expect(200);

    const call = mockDb.__find(/FROM transportnoe_sredstvo/i);
    expect(call.sql).toMatch(/WHERE ts\.podrazdelenie_id = \?/);
    expect(call.params).toEqual([2]); // подразделение пользователя
  });

  it('GET /dict/ts: Директор видит все ТС (без WHERE)', async () => {
    mockDb.__when(/FROM transportnoe_sredstvo/i, []);
    await request(app)
      .get('/api/zayavki/dict/ts')
      .set('Authorization', directorAuth)
      .expect(200);
    const call = mockDb.__find(/FROM transportnoe_sredstvo/i);
    expect(call.sql).not.toMatch(/WHERE ts\.podrazdelenie_id/);
    expect(call.params).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────
   GET /api/zayavki — список с RBAC-фильтрацией
   ───────────────────────────────────────────────────────────── */
describe('GET /api/zayavki', () => {
  it('Пользователь автоматически фильтруется по своим заявкам', async () => {
    mockDb.__when(/FROM zayavka z/i, []);
    await request(app)
      .get('/api/zayavki')
      .set('Authorization', userAuth)
      .expect(200);

    const call = mockDb.__find(/FROM zayavka z/i);
    expect(call.sql).toMatch(/z\.sozdatel_id = \?/);
    expect(call.params).toContain(7); // id Пользователя
  });

  it('Механик видит только заявки, на которые назначен', async () => {
    mockDb.__when(/FROM zayavka z/i, []);
    await request(app)
      .get('/api/zayavki')
      .set('Authorization', mechanicAuth)
      .expect(200);

    const call = mockDb.__find(/FROM zayavka z/i);
    expect(call.sql).toMatch(/EXISTS \(SELECT 1 FROM remont r2 WHERE r2\.zayavka_id = z\.id AND r2\.mekhanik_id = \?\)/);
    expect(call.params).toContain(3);
  });

  it('Диспетчер без mine видит все заявки (нет принудительной фильтрации)', async () => {
    mockDb.__when(/FROM zayavka z/i, []);
    await request(app)
      .get('/api/zayavki')
      .set('Authorization', dispetcherAuth)
      .expect(200);

    const call = mockDb.__find(/FROM zayavka z/i);
    expect(call.sql).not.toMatch(/z\.sozdatel_id = \?/);
    expect(call.sql).not.toMatch(/EXISTS \(SELECT 1 FROM remont r2/);
  });

  it('фильтр ?status=2 пробрасывается в SQL', async () => {
    mockDb.__when(/FROM zayavka z/i, []);
    await request(app)
      .get('/api/zayavki?status=2')
      .set('Authorization', dispetcherAuth)
      .expect(200);
    const call = mockDb.__find(/FROM zayavka z/i);
    expect(call.sql).toMatch(/z\.status_id = \?/);
    expect(call.params).toContain(2);
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /api/zayavki
   ───────────────────────────────────────────────────────────── */
describe('POST /api/zayavki', () => {
  it('403 для Аналитика (не входит в whitelist создателей)', async () => {
    await request(app)
      .post('/api/zayavki')
      .set('Authorization', analyticAuth)
      .send({ ts_id: 1, tip_remonta_id: 1 })
      .expect(403);
  });

  it('403 для Механика', async () => {
    await request(app)
      .post('/api/zayavki')
      .set('Authorization', mechanicAuth)
      .send({ ts_id: 1, tip_remonta_id: 1 })
      .expect(403);
  });

  it('400 без ts_id или tip_remonta_id', async () => {
    await request(app)
      .post('/api/zayavki')
      .set('Authorization', userAuth)
      .send({})
      .expect(400);
  });

  it('400 при неверном prioritet', async () => {
    await request(app)
      .post('/api/zayavki')
      .set('Authorization', userAuth)
      .send({ ts_id: 1, tip_remonta_id: 1, prioritet: 99 })
      .expect(400);
  });

  it('Пользователь не может создать заявку на чужое подразделение → 403', async () => {
    // ТС из подразделения 5, у пользователя — 2
    mockDb.__when(/FROM transportnoe_sredstvo WHERE id = \?/i, [
      { podrazdelenie_id: 5 },
    ]);

    const r = await request(app)
      .post('/api/zayavki')
      .set('Authorization', userAuth)
      .send({ ts_id: 1, tip_remonta_id: 1 })
      .expect(403);
    expect(r.body.error).toMatch(/своего подразделения/);
  });

  it('201 при успешном создании; ставит статус "Новая" и пишет audit-log', async () => {
    mockDb
      // Пользователь создаёт на ТС своего подразделения (2)
      .__when(/FROM transportnoe_sredstvo WHERE id = \?/i, [{ podrazdelenie_id: 2 }])
      .__when(/FROM status WHERE nazvanie = \?/i, [{ id: 1 }])
      .__when(/INSERT INTO zayavka/i, [{ id: 42 }])
      .__when(/INSERT INTO finansoviy_log/i, []);

    const r = await request(app)
      .post('/api/zayavki')
      .set('Authorization', userAuth)
      .send({ ts_id: 1, tip_remonta_id: 3, opisanie: 'тест', prioritet: 2 })
      .expect(201);

    expect(r.body).toEqual({ id: 42, status: 'Новая' });

    const insZ = mockDb.__find(/INSERT INTO zayavka/i);
    expect(insZ.params).toEqual([7, 1, 3, 'тест', 1, 2]);
    // sozdatel_id, ts_id, tip_remonta_id, opisanie, status_id, prioritet

    expect(mockDb.__find(/INSERT INTO finansoviy_log/i)).toBeTruthy();
  });
});

/* ─────────────────────────────────────────────────────────────
   PATCH /api/zayavki/:id/assign — ручное назначение механика
   ───────────────────────────────────────────────────────────── */
describe('PATCH /api/zayavki/:id/assign', () => {
  it('403 для Пользователя', async () => {
    await request(app)
      .patch('/api/zayavki/1/assign')
      .set('Authorization', userAuth)
      .send({ mekhanik_id: 3 })
      .expect(403);
  });

  it('400 без mekhanik_id', async () => {
    await request(app)
      .patch('/api/zayavki/1/assign')
      .set('Authorization', dispetcherAuth)
      .send({})
      .expect(400);
  });

  it('404, если заявка не найдена', async () => {
    mockDb.__when(/SELECT z\.id, z\.status_id, st\.nazvanie AS status\s+FROM zayavka z/i, []);
    await request(app)
      .patch('/api/zayavki/99/assign')
      .set('Authorization', dispetcherAuth)
      .send({ mekhanik_id: 3 })
      .expect(404);
  });

  it('400, если заявка уже выполнена', async () => {
    mockDb.__when(/SELECT z\.id, z\.status_id, st\.nazvanie AS status\s+FROM zayavka z/i, [
      { id: 1, status_id: 3, status: 'Выполнена' },
    ]);
    const r = await request(app)
      .patch('/api/zayavki/1/assign')
      .set('Authorization', dispetcherAuth)
      .send({ mekhanik_id: 3 })
      .expect(400);
    expect(r.body.error).toMatch(/завершённую/);
  });

  it('400, если назначаемый — не Механик', async () => {
    mockDb
      .__when(/SELECT z\.id, z\.status_id, st\.nazvanie AS status\s+FROM zayavka z/i, [
        { id: 1, status_id: 1, status: 'Новая' },
      ])
      .__when(/SELECT s\.id, s\.fio, r\.nazvanie AS rol/i, [
        { id: 99, fio: 'Иванов', rol: 'Аналитик' },
      ]);

    const r = await request(app)
      .patch('/api/zayavki/1/assign')
      .set('Authorization', dispetcherAuth)
      .send({ mekhanik_id: 99 })
      .expect(400);
    expect(r.body.error).toMatch(/Механика/);
  });

  it('200: создаёт ремонт, обновляет статус → "В работе", пишет audit', async () => {
    mockDb
      .__when(/SELECT z\.id, z\.status_id, st\.nazvanie AS status\s+FROM zayavka z/i, [
        { id: 1, status_id: 1, status: 'Новая' },
      ])
      .__when(/SELECT s\.id, s\.fio, r\.nazvanie AS rol/i, [
        { id: 3, fio: 'Сидоров А.О.', rol: 'Механик' },
      ])
      // Главный механик
      .__when(/WHERE r\.nazvanie = 'Главный механик'/i, [{ id: 2 }])
      // Ремонта ещё нет
      .__when(/SELECT id FROM remont WHERE zayavka_id = \?/i, [])
      .__when(/INSERT INTO remont/i, [{ id: 100 }])
      .__when(/SELECT id FROM status WHERE nazvanie = \?/i, [{ id: 2 }])
      .__when(/UPDATE zayavka SET status_id/i, [])
      .__when(/INSERT INTO finansoviy_log/i, []);

    const r = await request(app)
      .patch('/api/zayavki/1/assign')
      .set('Authorization', dispetcherAuth)
      .send({ mekhanik_id: 3 })
      .expect(200);

    expect(r.body).toEqual({
      id: 1, remont_id: 100, mekhanik_id: 3, status: 'В работе',
    });
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /api/zayavki/:id/auto-assign — АВТОНАВОДКА
   ───────────────────────────────────────────────────────────── */
describe('POST /api/zayavki/:id/auto-assign', () => {
  it('403 для Пользователя', async () => {
    await request(app)
      .post('/api/zayavki/1/auto-assign')
      .set('Authorization', userAuth)
      .expect(403);
  });

  it('404, если заявка не найдена', async () => {
    mockDb.__when(/FROM zayavka z\s+JOIN status/i, []);
    await request(app)
      .post('/api/zayavki/99/auto-assign')
      .set('Authorization', dispetcherAuth)
      .expect(404);
  });

  it('400, если заявка уже выполнена', async () => {
    mockDb.__when(/FROM zayavka z\s+JOIN status/i, [
      { id: 1, status_id: 3, status: 'Выполнена', podrazdelenie_id: 4, podrazdelenie: 'СТО' },
    ]);
    await request(app)
      .post('/api/zayavki/1/auto-assign')
      .set('Authorization', dispetcherAuth)
      .expect(400);
  });

  it('LOCAL: выбирает наименее загруженного механика своего подразделения', async () => {
    mockDb
      .__when(/FROM zayavka z\s+JOIN status/i, [
        { id: 1, status_id: 1, status: 'Новая', podrazdelenie_id: 4, podrazdelenie: 'СТО' },
      ])
      // Локальный поиск находит механика с aktivnyh=0
      .__when(/AND s\.podrazdelenie_id = \?/i, [
        { id: 3, fio: 'Сидоров', podrazdelenie_id: 4, podrazdelenie: 'СТО',
          aktivnyh_remontov: 0, remontov_za_30_dney: 5 },
      ])
      .__when(/WHERE r\.nazvanie = 'Главный механик'/i, [{ id: 2 }])
      .__when(/SELECT id FROM remont WHERE zayavka_id = \?/i, [])
      .__when(/INSERT INTO remont/i, [{ id: 200 }])
      .__when(/SELECT id FROM status WHERE nazvanie = \?/i, [{ id: 2 }])
      .__when(/UPDATE zayavka SET status_id/i, [])
      .__when(/INSERT INTO finansoviy_log/i, []);

    const r = await request(app)
      .post('/api/zayavki/1/auto-assign')
      .set('Authorization', dispetcherAuth)
      .expect(200);

    expect(r.body.scope).toBe('local');
    expect(r.body.mekhanik).toEqual(expect.objectContaining({
      id: 3, fio: 'Сидоров', aktivnyh_remontov: 0, remontov_za_30_dney: 5,
    }));
    expect(r.body.remont_id).toBe(200);
    expect(r.body.status).toBe('В работе');
  });

  it('GLOBAL: если в подразделении ТС нет механиков — fallback на всех', async () => {
    let callCount = 0;
    mockDb
      .__when(/FROM zayavka z\s+JOIN status/i, [
        { id: 1, status_id: 1, status: 'Новая', podrazdelenie_id: 99, podrazdelenie: 'Новый филиал' },
      ])
      // Первый раз — пусто (local), второй — нашли (global)
      .__when(
        (sql) => /FROM sotrudnik s\s+JOIN rol r/i.test(sql) && /WHERE r\.nazvanie = 'Механик'/i.test(sql),
        () => {
          callCount++;
          if (callCount === 1) return [];                 // local empty
          return [{                                       // global hit
            id: 4, fio: 'Кузнецов', podrazdelenie_id: 4,
            podrazdelenie: 'СТО', aktivnyh_remontov: 1,
            remontov_za_30_dney: 8,
          }];
        }
      )
      .__when(/WHERE r\.nazvanie = 'Главный механик'/i, [{ id: 2 }])
      .__when(/SELECT id FROM remont WHERE zayavka_id = \?/i, [])
      .__when(/INSERT INTO remont/i, [{ id: 201 }])
      .__when(/SELECT id FROM status WHERE nazvanie = \?/i, [{ id: 2 }]);

    const r = await request(app)
      .post('/api/zayavki/1/auto-assign')
      .set('Authorization', dispetcherAuth)
      .expect(200);

    expect(r.body.scope).toBe('global');
    expect(r.body.mekhanik.id).toBe(4);
    expect(callCount).toBe(2);
  });

  it('409, если в системе вообще нет ни одного механика', async () => {
    mockDb
      .__when(/FROM zayavka z\s+JOIN status/i, [
        { id: 1, status_id: 1, status: 'Новая', podrazdelenie_id: 4, podrazdelenie: 'СТО' },
      ])
      .__when(
        (sql) => /FROM sotrudnik s\s+JOIN rol r/i.test(sql) && /WHERE r\.nazvanie = 'Механик'/i.test(sql),
        []
      );
    await request(app)
      .post('/api/zayavki/1/auto-assign')
      .set('Authorization', dispetcherAuth)
      .expect(409);
  });

  it('переиспользует существующий remont (не создаёт второй), если он уже есть', async () => {
    mockDb
      .__when(/FROM zayavka z\s+JOIN status/i, [
        { id: 1, status_id: 1, status: 'Новая', podrazdelenie_id: 4, podrazdelenie: 'СТО' },
      ])
      .__when(/AND s\.podrazdelenie_id = \?/i, [
        { id: 3, fio: 'Сид', podrazdelenie_id: 4, podrazdelenie: 'СТО',
          aktivnyh_remontov: 0, remontov_za_30_dney: 0 },
      ])
      .__when(/WHERE r\.nazvanie = 'Главный механик'/i, [{ id: 2 }])
      // Уже есть ремонт id=77
      .__when(/SELECT id FROM remont WHERE zayavka_id = \?/i, [{ id: 77 }])
      .__when(/UPDATE remont SET mekhanik_id/i, [])
      .__when(/SELECT id FROM status WHERE nazvanie = \?/i, [{ id: 2 }]);

    const r = await request(app)
      .post('/api/zayavki/1/auto-assign')
      .set('Authorization', dispetcherAuth)
      .expect(200);

    expect(r.body.remont_id).toBe(77);
    // INSERT INTO remont не вызывался
    expect(mockDb.__find(/INSERT INTO remont/i)).toBeFalsy();
  });
});

/* ─────────────────────────────────────────────────────────────
   PATCH /api/zayavki/:id/status
   ───────────────────────────────────────────────────────────── */
describe('PATCH /api/zayavki/:id/status', () => {
  it('403 для Механика', async () => {
    await request(app)
      .patch('/api/zayavki/1/status')
      .set('Authorization', mechanicAuth)
      .send({ status_id: 5 })
      .expect(403);
  });

  it('400 без status_id', async () => {
    await request(app)
      .patch('/api/zayavki/1/status')
      .set('Authorization', dispetcherAuth)
      .send({})
      .expect(400);
  });

  it('404, если заявка не найдена', async () => {
    mockDb.__when(/SELECT id FROM zayavka WHERE id = \?/i, []);
    await request(app)
      .patch('/api/zayavki/99/status')
      .set('Authorization', dispetcherAuth)
      .send({ status_id: 4 })
      .expect(404);
  });

  it('400 при несуществующем статусе', async () => {
    mockDb
      .__when(/SELECT id FROM zayavka WHERE id = \?/i, [{ id: 1 }])
      .__when(/SELECT id, nazvanie FROM status WHERE id = \?/i, []);
    await request(app)
      .patch('/api/zayavki/1/status')
      .set('Authorization', dispetcherAuth)
      .send({ status_id: 999 })
      .expect(400);
  });

  it('200 + audit при успешной смене', async () => {
    mockDb
      .__when(/SELECT id FROM zayavka WHERE id = \?/i, [{ id: 1 }])
      .__when(/SELECT id, nazvanie FROM status WHERE id = \?/i, [
        { id: 5, nazvanie: 'Ожидание запчастей' },
      ])
      .__when(/UPDATE zayavka SET status_id/i, [])
      .__when(/INSERT INTO finansoviy_log/i, []);

    const r = await request(app)
      .patch('/api/zayavki/1/status')
      .set('Authorization', dispetcherAuth)
      .send({ status_id: 5, kommentariy: 'Жду колодки' })
      .expect(200);

    expect(r.body).toEqual({ id: 1, status_id: 5, status: 'Ожидание запчастей' });
    const auditCall = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(auditCall.params[4]).toMatch(/Ожидание запчастей: Жду колодки/);
  });
});

/* ─────────────────────────────────────────────────────────────
   GET /api/zayavki/:id — детали + RBAC
   ───────────────────────────────────────────────────────────── */
describe('GET /api/zayavki/:id', () => {
  it('400 при некорректном id', async () => {
    await request(app)
      .get('/api/zayavki/abc')
      .set('Authorization', dispetcherAuth)
      .expect(400);
  });

  it('404, если не найдена', async () => {
    mockDb.__when(/FROM zayavka z\s+JOIN status/i, []);
    await request(app)
      .get('/api/zayavki/999')
      .set('Authorization', dispetcherAuth)
      .expect(404);
  });

  it('Пользователь получает 403 на чужую заявку', async () => {
    mockDb.__when(/FROM zayavka z\s+JOIN status/i, [
      { id: 1, sozdatel_id: 1, mekhanik_id: null /* … */ },
    ]);
    await request(app)
      .get('/api/zayavki/1')
      .set('Authorization', userAuth) // id=7
      .expect(403);
  });

  it('Механик получает 403 на ремонт другого механика', async () => {
    mockDb.__when(/FROM zayavka z\s+JOIN status/i, [
      { id: 1, sozdatel_id: 99, mekhanik_id: 99 /* не я */ },
    ]);
    await request(app)
      .get('/api/zayavki/1')
      .set('Authorization', mechanicAuth) // id=3
      .expect(403);
  });

  it('200 для Диспетчера всегда (даже на чужую)', async () => {
    mockDb.__when(/FROM zayavka z\s+JOIN status/i, [
      { id: 1, sozdatel_id: 99, mekhanik_id: 99, status: 'Новая' },
    ]);
    await request(app)
      .get('/api/zayavki/1')
      .set('Authorization', dispetcherAuth)
      .expect(200);
  });
});
