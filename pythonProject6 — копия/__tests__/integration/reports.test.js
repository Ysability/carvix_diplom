/**
 * Carvix — интеграционные тесты модуля «Отчёты и дашборд»
 * (/api/finance/reports).
 *
 * Покрываем:
 *   • TCO-список: агрегация totals (tco/rabot/zapchastey/prochee);
 *   • TCO-детальный (/tco/:tsId): 400 при не-числе, 404 при отсутствии,
 *     200 + summary + remonty + prochiy_raskhod;
 *   • Дашборд: KPI с расчётом delta_pct, заполнение всех 12 месяцев нулями.
 */

jest.mock('../../db', () => require('../helpers/mockDb'));

const request = require('supertest');
const mockDb = require('../helpers/mockDb');
const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withAuth: false, withFinance: true });

const directorAuth = `Bearer ${tokenFor(ROLES.DIRECTOR)}`;
const userAuth     = `Bearer ${tokenFor(ROLES.USER)}`;

beforeEach(() => mockDb.__reset());

/* =============================================================
   GET /api/finance/reports/tco
   ============================================================= */
describe('GET /api/finance/reports/tco', () => {
  it('403 для роли Пользователь', async () => {
    await request(app)
      .get('/api/finance/reports/tco')
      .set('Authorization', userAuth)
      .expect(403);
  });

  it('200, расчёт totals правильно агрегирует все TS', async () => {
    mockDb.__when(/FROM v_tco_ts v/i, [
      { ts_id: 1, gos_nomer: 'А777АА', invent_nomer: 'INV1',
        marka_nazvanie: 'КАМАЗ', model_nazvanie: '5320',
        podrazdelenie_nazvanie: 'ГУ',
        kolvo_zayavok: 5, kolvo_remontov: 3,
        itogo_rabot: '10000', itogo_zapchastey: '5000', itogo_prochee: '2000',
        tco_obshchee: '17000' },
      { ts_id: 2, gos_nomer: 'В123ВВ', invent_nomer: 'INV2',
        marka_nazvanie: 'ГАЗ', model_nazvanie: '3309',
        podrazdelenie_nazvanie: 'СФ',
        kolvo_zayavok: 2, kolvo_remontov: 1,
        itogo_rabot: '4000', itogo_zapchastey: '1000', itogo_prochee: '500',
        tco_obshchee: '5500' },
    ]);

    const r = await request(app)
      .get('/api/finance/reports/tco')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.items).toHaveLength(2);
    expect(r.body.totals).toEqual({
      tco:        22500,    // 17000 + 5500
      rabot:      14000,    // 10000 + 4000
      zapchastey: 6000,     // 5000 + 1000
      prochee:    2500,     // 2000 + 500
    });
  });

  it('применяет sort=tco_asc и фильтрацию по подразделению', async () => {
    mockDb.__when(/FROM v_tco_ts v/i, []);
    await request(app)
      .get('/api/finance/reports/tco?sort=tco_asc&podrazdelenie_id=2')
      .set('Authorization', directorAuth)
      .expect(200);

    const call = mockDb.__find(/FROM v_tco_ts v/i);
    expect(call.sql).toMatch(/ORDER BY tco_obshchee ASC/);
    expect(call.params).toEqual(['2']);
  });
});

/* =============================================================
   GET /api/finance/reports/tco/:tsId
   ============================================================= */
describe('GET /api/finance/reports/tco/:tsId', () => {
  it('400 при tsId не-числе', async () => {
    await request(app)
      .get('/api/finance/reports/tco/abc')
      .set('Authorization', directorAuth)
      .expect(400);
  });

  it('404, если ТС не найдено', async () => {
    mockDb.__when(/FROM v_tco_ts WHERE ts_id/i, []);
    await request(app)
      .get('/api/finance/reports/tco/9999')
      .set('Authorization', directorAuth)
      .expect(404);
  });

  it('200, возвращает summary + remonty + prochiy_raskhod', async () => {
    mockDb
      .__when(/FROM v_tco_ts WHERE ts_id/i,
        [{ ts_id: 7, gos_nomer: 'А777АА', tco_obshchee: '50000' }])
      .__when(/FROM remont r\s+JOIN zayavka/i,
        [{ id: 1, data_nachala: '2026-04-01', stoimost_rabot: '5000',
           stoimost_zapchastey: '3000', itogo: '8000', tip_remonta: 'Плановый' }])
      .__when(/FROM prochiy_raskhod\s+WHERE ts_id/i,
        [{ id: 11, data: '2026-04-15', kategoriya: 'topliv',
           summa: '4500', opisanie: 'Заправка' }]);

    const r = await request(app)
      .get('/api/finance/reports/tco/7')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.summary.ts_id).toBe(7);
    expect(r.body.remonty).toHaveLength(1);
    expect(r.body.prochiy_raskhod).toHaveLength(1);
  });
});

/* =============================================================
   GET /api/finance/reports/dashboard
   ============================================================= */
describe('GET /api/finance/reports/dashboard', () => {
  it('200, заполняет все 12 месяцев нулями где нет данных, считает delta_pct', async () => {
    // Любой запрос pool.pool.query — вернёт пусто
    // (роут защищён от этого: дополняет нулями)
    mockDb
      // 1. dynamics
      .__when((sql) => /FROM v_fakt_po_podrazdeleniyu/i.test(sql) && /CASE WHEN kategoriya='remont'/i.test(sql),
        [{ mesyats: 4, remont: '1000', zapchasti: '500', topliv: '300', prochee: '100', total: '1900' }])
      // 2. struct
      .__when((sql) => /FROM v_fakt_po_podrazdeleniyu/i.test(sql) && /GROUP BY kategoriya/i.test(sql),
        [{ kategoriya: 'topliv', summa: '300' }])
      // 3. top TCO
      .__when(/FROM v_tco_ts/i,
        [{ ts_id: 1, gos_nomer: 'А777АА', marka_nazvanie: 'КАМАЗ',
           model_nazvanie: '5320', podrazdelenie_nazvanie: 'ГУ',
           tco_obshchee: '17000', kolvo_remontov: 3 }])
      // 4. plan/fakt summary
      .__when(/SUM\(plan_summa\).*FROM v_byudzhet_plan_fakt/is,
        [{ plan: '120000', fakt: '80000', otklonenie: '40000' }])
      // 5. plan vs vneplan
      .__when(/FROM remont r\s+JOIN zayavka.*tip_remonta/is,
        [{ tip: 'Плановый', kolvo: 5, summa: '15000' }])
      // 6. KPI tek/pred mesyats
      .__when(/SUM\(CASE WHEN god=\$1 AND mesyats=\$2\s+THEN fakt_summa ELSE 0 END\) AS tek_mesyats/i,
        [{ tek_mesyats: '10000', pred_mesyats: '8000' }]);

    const r = await request(app)
      .get('/api/finance/reports/dashboard?god=2026')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.god).toBe(2026);
    expect(r.body.dynamics).toHaveLength(12);
    // месяц 4 — фактические данные, остальные нули
    expect(r.body.dynamics[3]).toMatchObject({ mesyats: 4, total: '1900' });
    expect(r.body.dynamics[0]).toMatchObject({ mesyats: 1, total: '0' });

    // KPI delta_pct = (10000 - 8000) / 8000 * 100 = 25.0
    expect(r.body.kpi.tek_mesyats).toBe(10000);
    expect(r.body.kpi.pred_mesyats).toBe(8000);
    expect(r.body.kpi.delta_pct).toBe(25);
    expect(r.body.kpi.plan_god).toBe(120000);
    expect(r.body.kpi.fakt_god).toBe(80000);

    // Структура и топ-ТС
    expect(r.body.struktura[0]).toEqual({ kategoriya: 'topliv', summa: 300 });
    expect(r.body.top_ts[0].marka).toBe('КАМАЗ');
  });

  it('delta_pct = null, когда предыдущий месяц = 0 (защита от деления на 0)', async () => {
    mockDb
      .__when(/CASE WHEN kategoriya='remont'/is, [])
      .__when(/GROUP BY kategoriya/i, [])
      .__when(/FROM v_tco_ts/i, [])
      .__when(/SUM\(plan_summa\)/is, [{ plan: 0, fakt: 0, otklonenie: 0 }])
      .__when(/FROM remont r\s+JOIN zayavka.*tip_remonta/is, [])
      .__when(/AS tek_mesyats/i, [{ tek_mesyats: 5000, pred_mesyats: 0 }]);

    const r = await request(app)
      .get('/api/finance/reports/dashboard?god=2026')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.kpi.delta_pct).toBeNull();
  });
});

/* =============================================================
   GET /api/finance/reports/forecast (Holt-Winters)
   ============================================================= */
describe('GET /api/finance/reports/forecast', () => {
  /** Генерирует 36 точек {god, mesyats, summa} с сезонностью. */
  function makeSeasonalSeries(startYear = 2023) {
    const factors = [1.4, 1.3, 1.1, 0.9, 0.8, 0.7, 0.7, 0.8, 0.9, 1.1, 1.2, 1.4];
    const rows = [];
    for (let y = 0; y < 3; y++) {
      for (let m = 0; m < 12; m++) {
        rows.push({
          god: startYear + y,
          mesyats: m + 1,
          summa: String(50000 * factors[m]),
        });
      }
    }
    return rows;
  }

  it('401 без токена', async () => {
    await request(app).get('/api/finance/reports/forecast').expect(401);
  });

  it('200 + history + forecast + method=holt-winters при 36 месяцах данных', async () => {
    mockDb.__when(/FROM v_fakt_po_podrazdeleniyu v\s+WHERE/i, makeSeasonalSeries());

    const r = await request(app)
      .get('/api/finance/reports/forecast?horizon=12&kategoriya=topliv')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.method).toBe('holt-winters');
    expect(r.body.history).toHaveLength(36);
    expect(r.body.forecast).toHaveLength(12);

    // Каждая точка прогноза имеет (god, mesyats, point, lower, upper)
    for (const f of r.body.forecast) {
      expect(f).toEqual(expect.objectContaining({
        god: expect.any(Number),
        mesyats: expect.any(Number),
        step: expect.any(Number),
        point: expect.any(Number),
        lower: expect.any(Number),
        upper: expect.any(Number),
      }));
      expect(f.lower).toBeLessThanOrEqual(f.point);
      expect(f.upper).toBeGreaterThanOrEqual(f.point);
    }

    // Параметры эхом возвращаются клиенту
    expect(r.body.params).toMatchObject({
      horizon: 12, kategoriya: 'topliv', podrazdelenie_id: null,
    });
  });

  it('horizon обрезается до 24 (валидация)', async () => {
    mockDb.__when(/FROM v_fakt_po_podrazdeleniyu/i, makeSeasonalSeries());
    const r = await request(app)
      .get('/api/finance/reports/forecast?horizon=999')
      .set('Authorization', directorAuth)
      .expect(200);
    expect(r.body.params.horizon).toBe(24);
    expect(r.body.forecast).toHaveLength(24);
  });

  it('horizon < 1 защищается до 1', async () => {
    mockDb.__when(/FROM v_fakt_po_podrazdeleniyu/i, makeSeasonalSeries());
    const r = await request(app)
      .get('/api/finance/reports/forecast?horizon=0')
      .set('Authorization', directorAuth)
      .expect(200);
    expect(r.body.params.horizon).toBe(12); // 0 → fallback на дефолт 12
  });

  it('пустая история → method=no-data, forecast=[]', async () => {
    mockDb.__when(/FROM v_fakt_po_podrazdeleniyu/i, []);
    const r = await request(app)
      .get('/api/finance/reports/forecast')
      .set('Authorization', directorAuth)
      .expect(200);
    expect(r.body.method).toBe('no-data');
    expect(r.body.history).toEqual([]);
    expect(r.body.forecast).toEqual([]);
  });

  it('< 24 месяцев данных → method=linear-trend (fallback)', async () => {
    // Только 6 месяцев — недостаточно для Holt-Winters
    const rows = [];
    for (let m = 1; m <= 6; m++) {
      rows.push({ god: 2026, mesyats: m, summa: String(10000 + m * 1000) });
    }
    mockDb.__when(/FROM v_fakt_po_podrazdeleniyu/i, rows);

    const r = await request(app)
      .get('/api/finance/reports/forecast?horizon=3')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.method).toBe('linear-trend');
    expect(r.body.forecast).toHaveLength(3);
  });

  it('фильтры kategoriya и podrazdelenie_id пробрасываются в SQL', async () => {
    mockDb.__when(/FROM v_fakt_po_podrazdeleniyu/i, []);

    await request(app)
      .get('/api/finance/reports/forecast?kategoriya=topliv&podrazdelenie_id=2')
      .set('Authorization', directorAuth)
      .expect(200);

    const call = mockDb.__find(/FROM v_fakt_po_podrazdeleniyu v\s+WHERE/i);
    // Параметры: [minGod, kategoriya, podrazdelenie_id]
    expect(call.params[1]).toBe('topliv');
    expect(call.params[2]).toBe(2);
  });

  it('пропуски в исторических данных заполняются нулями (непрерывная серия)', async () => {
    // Подаём только январь и март; февраль должен оказаться нулём
    mockDb.__when(/FROM v_fakt_po_podrazdeleniyu/i, [
      { god: 2026, mesyats: 1, summa: '1000' },
      { god: 2026, mesyats: 3, summa: '3000' },
    ]);

    const r = await request(app)
      .get('/api/finance/reports/forecast')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.history).toEqual([
      { god: 2026, mesyats: 1, summa: 1000 },
      { god: 2026, mesyats: 2, summa: 0 },
      { god: 2026, mesyats: 3, summa: 3000 },
    ]);
  });

  it('даты прогноза идут последовательно после последнего наблюдения (с переходом через год)', async () => {
    // Серия заканчивается октябрём 2026 → прогноз: ноябрь, декабрь, январь 2027
    const rows = [];
    for (let g = 2024; g <= 2025; g++) {
      for (let m = 1; m <= 12; m++) {
        rows.push({ god: g, mesyats: m, summa: '1000' });
      }
    }
    for (let m = 1; m <= 10; m++) {
      rows.push({ god: 2026, mesyats: m, summa: '1000' });
    }
    mockDb.__when(/FROM v_fakt_po_podrazdeleniyu/i, rows);

    const r = await request(app)
      .get('/api/finance/reports/forecast?horizon=4')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body.forecast.map((f) => `${f.god}-${f.mesyats}`)).toEqual([
      '2026-11', '2026-12', '2027-1', '2027-2',
    ]);
  });
});
