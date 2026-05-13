/**
 * Carvix — тесты бизнес-логики «План/Факт».
 *
 * Эта формула — ключевая для финансового модуля:
 *
 *   total_otklonenie = SUM(plan) - SUM(fakt)
 *   total_protsent   = (SUM(fakt) / SUM(plan)) * 100,  округление до 0.1 %
 *                      0  если SUM(plan) === 0  (защита от деления на 0)
 *
 * Тесты проверяют формулу на типовых сценариях, имитируя возврат
 * представления `v_byudzhet_plan_fakt`.
 */

jest.mock('../../db', () => require('../helpers/mockDb'));

const request = require('supertest');
const mockDb = require('../helpers/mockDb');
const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withAuth: false, withFinance: true });
const auth = `Bearer ${tokenFor(ROLES.DIRECTOR)}`;

beforeEach(() => mockDb.__reset());

async function planFaktTotals(rows) {
  mockDb.__when(/FROM v_byudzhet_plan_fakt v/i, rows);
  const r = await request(app)
    .get('/api/finance/budgets/plan-fakt')
    .set('Authorization', auth)
    .expect(200);
  return r.body.totals;
}

describe('План/Факт — расчёт итогов', () => {
  it('исполнение в плане 100% — отклонение 0', async () => {
    const totals = await planFaktTotals([
      { plan_summa: '50000', fakt_summa: '50000' },
    ]);
    expect(totals).toEqual({ plan: 50000, fakt: 50000, otklonenie: 0, protsent: 100 });
  });

  it('недоисполнение бюджета — положительное отклонение, % < 100', async () => {
    const totals = await planFaktTotals([
      { plan_summa: '100000', fakt_summa: '70000' },
    ]);
    expect(totals.plan).toBe(100000);
    expect(totals.fakt).toBe(70000);
    expect(totals.otklonenie).toBe(30000);
    expect(totals.protsent).toBe(70);
  });

  it('перерасход — отрицательное отклонение, % > 100', async () => {
    const totals = await planFaktTotals([
      { plan_summa: '100000', fakt_summa: '125000' },
    ]);
    expect(totals.otklonenie).toBe(-25000);
    expect(totals.protsent).toBe(125);
  });

  it('агрегация по нескольким строкам', async () => {
    const totals = await planFaktTotals([
      { plan_summa: '40000', fakt_summa: '38000' },   // топливо
      { plan_summa: '30000', fakt_summa: '20000' },   // запчасти
      { plan_summa: '50000', fakt_summa: '60000' },   // ремонт
    ]);
    expect(totals.plan).toBe(120000);
    expect(totals.fakt).toBe(118000);
    expect(totals.otklonenie).toBe(2000);
    // 118 000 / 120 000 = 0.98333... → округление до 0.1% = 98.3
    expect(totals.protsent).toBe(98.3);
  });

  it('защита от деления на 0: пустой план → protsent = 0', async () => {
    const totals = await planFaktTotals([]);
    expect(totals).toEqual({ plan: 0, fakt: 0, otklonenie: 0, protsent: 0 });
  });

  it('округление процента до одного знака после запятой', async () => {
    // 33333 / 100000 = 33.333...% → 33.3
    const totals = await planFaktTotals([
      { plan_summa: '100000', fakt_summa: '33333' },
    ]);
    expect(totals.protsent).toBe(33.3);
  });
});
