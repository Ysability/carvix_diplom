/**
 * Carvix — тесты CSV-импорта расходов: бизнес-валидация на разных форматах.
 *
 * Здесь мы НЕ проверяем HTTP-эндпоинт целиком (это уже сделано в expenses.test.js),
 * а целенаправленно гоняем парсер на крайних кейсах:
 *
 *   • разделитель «;» как у Excel-RU;
 *   • кириллические заголовки (Дата, Категория, ...);
 *   • число с запятой "12 500,50" → 12500.50;
 *   • разный регистр заголовков;
 *   • пустые/вырожденные строки;
 *   • «фейковые» гос-номера и подразделения отсекаются с понятным reason.
 */

jest.mock('../../db', () => require('../helpers/mockDb'));

const request = require('supertest');
const mockDb = require('../helpers/mockDb');
const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withAuth: false, withFinance: true });
const auth = `Bearer ${tokenFor(ROLES.DIRECTOR)}`;

function importCsv(text) {
  // Возвращаем supertest-chain (Test), а не Promise — это нужно чтобы вызывающий
  // мог делать `.expect(200)` перед `await`. async-обёртка ломала бы chaining.
  return request(app)
    .post('/api/finance/expenses/import-csv')
    .set('Authorization', auth)
    .attach('file', Buffer.from(text, 'utf8'), 'file.csv');
}

beforeEach(() => {
  mockDb.__reset();
  mockDb
    .__when(/SELECT id, gos_nomer, podrazdelenie_id FROM transportnoe_sredstvo/i, [
      { id: 7, gos_nomer: 'А777АА177', podrazdelenie_id: 1 },
    ])
    .__when(/SELECT id, nazvanie FROM podrazdelenie/i, [
      { id: 1, nazvanie: 'Главное управление' },
    ])
    .__when(/INSERT INTO prochiy_raskhod/i, []);
});

describe('CSV-импорт: парсер и валидация', () => {
  it('разделитель ; (Excel-RU) корректно распознаётся', async () => {
    const csv = 'data;kategoriya;summa;gos_nomer\n2026-04-10;topliv;1234;А777АА177';
    const r = await importCsv(csv).expect(200);
    expect(r.body.inserted).toBe(1);
  });

  it('кириллические заголовки (дата, категория, сумма, гос_номер) — работают', async () => {
    const csv = 'дата,категория,сумма,гос_номер\n2026-04-10,topliv,500,А777АА177';
    const r = await importCsv(csv).expect(200);
    expect(r.body.inserted).toBe(1);
  });

  it('числа с запятой и пробелами ("12 500,50") нормализуются', async () => {
    const csv = 'data,kategoriya,summa,gos_nomer\n2026-04-10,topliv,"12 500,50",А777АА177';
    const r = await importCsv(csv).expect(200);
    expect(r.body.inserted).toBe(1);
    // Проверяем что в БД ушло именно 12500.5
    const ins = mockDb.__find(/INSERT INTO prochiy_raskhod/i);
    expect(Number(ins.params[4])).toBeCloseTo(12500.5, 2);
  });

  it('импорт по подразделению (без гос-номера)', async () => {
    const csv = 'data,kategoriya,summa,podrazdelenie\n2026-04-10,nalog,9000,Главное управление';
    const r = await importCsv(csv).expect(200);
    expect(r.body.inserted).toBe(1);
  });

  it('точная диагностика ошибок: номер строки + причина', async () => {
    const csv = [
      'data,kategoriya,summa,gos_nomer',
      '2026-04-10,topliv,500,А777АА177',         // OK   — строка 2
      ',topliv,500,А777АА177',                   // нет даты   — строка 3
      '2026-04-10,FAKE,500,А777АА177',           // плохая категория — строка 4
      '2026-04-10,topliv,xyz,А777АА177',         // плохая сумма — строка 5
      '2026-04-10,topliv,500,НЕИЗВЕСТНЫЙ',       // нет такого ТС — строка 6
    ].join('\n');

    const r = await importCsv(csv).expect(200);
    expect(r.body.inserted).toBe(1);
    expect(r.body.skipped).toBe(4);
    expect(r.body.errors).toHaveLength(4);

    expect(r.body.errors).toContainEqual(expect.objectContaining({ row: 3, reason: expect.stringMatching(/Нет даты/) }));
    expect(r.body.errors).toContainEqual(expect.objectContaining({ row: 4, reason: expect.stringMatching(/Недопустимая категория/) }));
    expect(r.body.errors).toContainEqual(expect.objectContaining({ row: 5, reason: expect.stringMatching(/Некорректная сумма/) }));
    expect(r.body.errors).toContainEqual(expect.objectContaining({ row: 6, reason: expect.stringMatching(/не найден/) }));
  });

  it('400, если CSV полностью пустой (только заголовок)', async () => {
    const csv = 'data,kategoriya,summa,gos_nomer\n';
    const r = await importCsv(csv).expect(400);
    expect(r.body.error).toMatch(/CSV пустой/);
  });
});
