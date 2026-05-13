/**
 * Carvix — интеграционные тесты модуля аудит-журнала
 * (/api/finance/audit-log).
 *
 * Покрываем:
 *   • RBAC: только Директор и Аналитик (Главный механик и Пользователь — 403);
 *   • фильтрация по датам / sotrudnik_id / tip_operatsii;
 *   • пагинация (limit ограничен 500);
 *   • формат ответа: items + total + limit + offset.
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

describe('GET /api/finance/audit-log', () => {
  it('401 без токена', async () => {
    await request(app).get('/api/finance/audit-log').expect(401);
  });

  it('403 для Главного механика (доступ только Директор/Аналитик)', async () => {
    await request(app)
      .get('/api/finance/audit-log')
      .set('Authorization', mechanicAuth)
      .expect(403);
  });

  it('200 для Аналитика; возвращает items + total', async () => {
    mockDb
      .__when(/FROM finansoviy_log l/i, [
        { id: 1, data_operatsii: '2026-04-15T10:00:00Z',
          tip_operatsii: 'DOBAVLEN_RASKHOD',
          obyekt_tablitsa: 'prochiy_raskhod', obyekt_id: 100,
          summa: '1000', kommentariy: 'Тест',
          sotrudnik_id: 1, sotrudnik_fio: 'Иванов', sotrudnik_rol: 'Директор' },
      ])
      .__when(/SELECT COUNT\(\*\)/i, [{ total: 1 }]);

    const r = await request(app)
      .get('/api/finance/audit-log')
      .set('Authorization', analyticAuth)
      .expect(200);

    expect(r.body.total).toBe(1);
    expect(r.body.items[0].tip_operatsii).toBe('DOBAVLEN_RASKHOD');
    expect(r.body.limit).toBe(100);
    expect(r.body.offset).toBe(0);
  });

  it('передаёт фильтры from/to/sotrudnik_id/tip_operatsii в SQL', async () => {
    mockDb
      .__when(/FROM finansoviy_log l/i, [])
      .__when(/SELECT COUNT/i, [{ total: 0 }]);

    await request(app)
      .get('/api/finance/audit-log?from=2026-04-01&to=2026-04-30&sotrudnik_id=1&tip_operatsii=DOBAVLEN_RASKHOD')
      .set('Authorization', directorAuth)
      .expect(200);

    const call = mockDb.__find((sql) =>
      /FROM finansoviy_log l/i.test(sql) && /ORDER BY l\.data_operatsii DESC/i.test(sql)
    );
    expect(call.params).toEqual([
      '2026-04-01', '2026-04-30', '1', 'DOBAVLEN_RASKHOD',
    ]);
  });

  it('limit обрезается до 500', async () => {
    mockDb
      .__when(/FROM finansoviy_log l/i, [])
      .__when(/SELECT COUNT/i, [{ total: 0 }]);

    const r = await request(app)
      .get('/api/finance/audit-log?limit=99999')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.limit).toBe(500);
  });
});
