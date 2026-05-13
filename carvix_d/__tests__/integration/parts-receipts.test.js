/**
 * Carvix — интеграционные тесты модуля «Приходные накладные»
 * (/api/finance/parts/receipts).
 *
 * Покрываем:
 *   • справочники запчастей и поставщиков (включая регресс на ed_izm-баг
 *     — мы используем колонку tsena, а не несуществующую edinitsa_izmereniya);
 *   • RBAC: write только Директор+Главный механик;
 *   • валидацию POST (нет постав-щика / нет даты / нет позиций / отрицательная
 *     цена / нулевое количество);
 *   • расчёт итоговой summa_obshaya;
 *   • что транзакция создаёт шапку, позиции, обновляет склад и пишет audit-log;
 *   • DELETE: 404, реверс остатков, удаление и audit-log.
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
   Справочники
   ============================================================= */
describe('GET dictionary endpoints', () => {
  it('zapchasti — возвращает posledniaya_tsena (псевдоним tsena), регресс на ed_izm-баг', async () => {
    mockDb.__when(/FROM zapchast/i, [
      { id: 1, naimenovanie: 'Фильтр масляный', artikul: 'F-001',
        kategoriya: 'Расходники', posledniaya_tsena: '450.00',
        ostatok_na_sklade: 12 },
    ]);
    const r = await request(app)
      .get('/api/finance/parts/receipts/dictionary/zapchasti')
      .set('Authorization', mechanicAuth)
      .expect(200);

    expect(r.body[0]).toHaveProperty('posledniaya_tsena');
    expect(r.body[0]).toHaveProperty('ostatok_na_sklade', 12);
    // Регресс: запрос НЕ должен использовать колонку edinitsa_izmereniya
    expect(mockDb.__find(/FROM zapchast/i).sql).not.toMatch(/edinitsa_izmereniya/);
  });

  it('postavshiki — возвращает справочник поставщиков', async () => {
    mockDb.__when(/FROM postavshik/i, [
      { id: 1, nazvanie: 'ООО Деталь', kontakty: 'sales@detal.ru' },
    ]);
    const r = await request(app)
      .get('/api/finance/parts/receipts/dictionary/postavshiki')
      .set('Authorization', analyticAuth)
      .expect(200);
    expect(r.body[0].nazvanie).toBe('ООО Деталь');
  });
});

/* =============================================================
   GET /parts/receipts
   ============================================================= */
describe('GET /api/finance/parts/receipts', () => {
  it('200, возвращает список с агрегированным kolvo_pozitsiy и itogo_edinic', async () => {
    mockDb.__when(/FROM prikhod_zapchasti p/i, [
      { id: 1, data_prikhoda: '2026-04-15', nomer_nakl: 'TN-001',
        summa_obshaya: '15000', postavshik_id: 1, postavshik_nazvanie: 'ООО Деталь',
        kommentariy: null, sozdatel_id: 1, sozdatel_fio: 'Иванов',
        kolvo_pozitsiy: 3, itogo_edinic: 12 },
    ]);
    const r = await request(app)
      .get('/api/finance/parts/receipts?from=2026-04-01')
      .set('Authorization', directorAuth)
      .expect(200);
    expect(r.body[0].kolvo_pozitsiy).toBe(3);
    expect(r.body[0].itogo_edinic).toBe(12);
  });
});

/* =============================================================
   POST /parts/receipts — создание (транзакция)
   ============================================================= */
describe('POST /api/finance/parts/receipts', () => {
  it('403 для Аналитика', async () => {
    await request(app)
      .post('/api/finance/parts/receipts')
      .set('Authorization', analyticAuth)
      .send({})
      .expect(403);
  });

  it.each([
    { name: 'нет постав-щика и даты',  body: { pozitsii: [{ zapchast_id: 1, kolichestvo: 1, tsena_za_edinicu: 1 }] } },
    { name: 'пустой массив pozitsii',  body: { postavshik_id: 1, data_prikhoda: '2026-04-15', pozitsii: [] } },
  ])('400: $name', async ({ body }) => {
    await request(app)
      .post('/api/finance/parts/receipts')
      .set('Authorization', mechanicAuth)
      .send(body)
      .expect(400);
  });

  it.each([
    { name: 'нет zapchast_id', position: { kolichestvo: 1, tsena_za_edinicu: 1 } },
    { name: 'нет kolichestvo', position: { zapchast_id: 1, tsena_za_edinicu: 1 } },
    { name: 'нет tsena',       position: { zapchast_id: 1, kolichestvo: 1 } },
    { name: 'kolichestvo = 0', position: { zapchast_id: 1, kolichestvo: 0, tsena_za_edinicu: 1 } },
    { name: 'отрицательная цена', position: { zapchast_id: 1, kolichestvo: 1, tsena_za_edinicu: -5 } },
  ])('400: позиция $name', async ({ position }) => {
    await request(app)
      .post('/api/finance/parts/receipts')
      .set('Authorization', mechanicAuth)
      .send({ postavshik_id: 1, data_prikhoda: '2026-04-15', pozitsii: [position] })
      .expect(400);
  });

  it('201: транзакция создаёт шапку, позиции, обновляет склад и пишет audit-log; summa_obshaya рассчитана корректно', async () => {
    mockDb
      .__when(/INSERT INTO prikhod_zapchasti\b/i, [{
        id: 55, postavshik_id: 1, data_prikhoda: '2026-04-15',
        nomer_nakl: 'TN-001', summa_obshaya: '17500', sozdatel_id: 1,
      }])
      .__when(/INSERT INTO prikhod_zapchasti_pozitsii/i, [])
      .__when(/UPDATE zapchast/i, [])
      .__when(/INSERT INTO finansoviy_log/i, []);

    const pozitsii = [
      { zapchast_id: 1, kolichestvo: 5,  tsena_za_edinicu: 500 },   //  2 500
      { zapchast_id: 2, kolichestvo: 10, tsena_za_edinicu: 1500 },  // 15 000
    ];

    const r = await request(app)
      .post('/api/finance/parts/receipts')
      .set('Authorization', mechanicAuth)
      .send({ postavshik_id: 1, data_prikhoda: '2026-04-15',
              nomer_nakl: 'TN-001', pozitsii })
      .expect(201);

    expect(r.body.id).toBe(55);

    // Проверка summa_obshaya, переданной в шапку: 2_500 + 15_000 = 17_500
    const hdrInsert = mockDb.__find(/INSERT INTO prikhod_zapchasti\s+\(/i);
    expect(Number(hdrInsert.params[3])).toBe(17500);

    // Позиции — две вставки
    expect(mockDb.__countMatching(/INSERT INTO prikhod_zapchasti_pozitsii/i)).toBe(2);

    // Склад — два UPDATE
    expect(mockDb.__countMatching(/UPDATE zapchast/i)).toBe(2);

    // Audit-log
    const log = mockDb.__find(/INSERT INTO finansoviy_log/i);
    expect(log.sql).toMatch(/PRIKHOD_ZAPCHASTI/);
    expect(log.params[1]).toBe(55);
    expect(Number(log.params[2])).toBe(17500);
  });
});

/* =============================================================
   DELETE /parts/receipts/:id — реверс склада + audit-log
   ============================================================= */
describe('DELETE /api/finance/parts/receipts/:id', () => {
  it('400, если id не число', async () => {
    await request(app)
      .delete('/api/finance/parts/receipts/abc')
      .set('Authorization', directorAuth)
      .expect(400);
  });

  it('404, если накладная не найдена', async () => {
    mockDb.__when(/SELECT id, summa_obshaya, nomer_nakl FROM prikhod_zapchasti/i, []);
    const r = await request(app)
      .delete('/api/finance/parts/receipts/777')
      .set('Authorization', directorAuth)
      .expect(404);
    expect(r.body.error).toMatch(/Накладная не найдена/);
  });

  it('200: реверсирует остатки склада, удаляет шапку, пишет audit-log', async () => {
    mockDb
      .__when(/SELECT id, summa_obshaya, nomer_nakl FROM prikhod_zapchasti/i,
        [{ id: 33, summa_obshaya: '17500', nomer_nakl: 'TN-001' }])
      .__when(/SELECT zapchast_id, kolichestvo FROM prikhod_zapchasti_pozitsii/i, [
        { zapchast_id: 1, kolichestvo: 5 },
        { zapchast_id: 2, kolichestvo: 10 },
      ])
      .__when(/UPDATE zapchast/i, [])
      .__when(/DELETE FROM prikhod_zapchasti/i, []);

    const r = await request(app)
      .delete('/api/finance/parts/receipts/33')
      .set('Authorization', directorAuth)
      .expect(200);

    expect(r.body).toEqual({ ok: true, deleted_id: 33 });
    expect(mockDb.__countMatching(/UPDATE zapchast/i)).toBe(2); // два реверса склада
    expect(mockDb.__find(/DELETE FROM prikhod_zapchasti/i)).toBeTruthy();
    expect(mockDb.__find(/INSERT INTO finansoviy_log/i).sql).toMatch(/OTMENA_PRIKHODA/);
  });
});
