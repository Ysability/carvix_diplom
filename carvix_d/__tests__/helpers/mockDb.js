/**
 * Carvix — синглтон-мок для модуля `db.js`.
 *
 * API повторяет реальный pool из `db.js`:
 *   • `execute(sql, params)`  → `[rows, fields]`            (mysql2-стиль)
 *   • `query(sql, params)`    → `[rows, fields]`
 *   • `pool.query(sql, params)` → `{ rows, fields }`        (pg-стиль, его
 *                                  использует часть роутеров напрямую)
 *   • `transaction(async (tx) => {...})` — даёт `tx.execute` и `tx.raw`,
 *                                          обращающиеся к тому же mock-у.
 *
 * Использование в тесте:
 *
 *   const mockDb = require('../helpers/mockDb');
 *   jest.mock('../../db', () => require('../helpers/mockDb'));
 *
 *   beforeEach(() => mockDb.__reset());
 *
 *   mockDb.__when(/SELECT id, fio FROM sotrudnik/i, [{ id: 1, fio: 'Иван' }]);
 *
 *   // ... выполняем запрос к API ...
 *
 *   expect(mockDb.__calls).toContainEqual(
 *     expect.objectContaining({ sql: expect.stringMatching(/INSERT INTO finansoviy_log/i) })
 *   );
 *
 * Параметры:
 *   • `matcher` может быть `RegExp` или `function(sql, params): boolean`;
 *   • `response` может быть массивом строк ИЛИ функцией `(sql, params) => rows`.
 */

const calls = [];
const handlers = [];

function findHandler(sql, params) {
  return handlers.find((h) =>
    typeof h.match === 'function'
      ? h.match(sql, params)
      : h.match.test(sql)
  );
}

function resolveRows(handler, sql, params) {
  if (!handler) return [];
  return typeof handler.response === 'function'
    ? handler.response(sql, params)
    : handler.response;
}

async function execute(sql, params = []) {
  calls.push({ sql, params, kind: 'execute' });
  const handler = findHandler(sql, params);
  return [resolveRows(handler, sql, params)];
}

async function query(sql, params = []) {
  calls.push({ sql, params, kind: 'query' });
  const handler = findHandler(sql, params);
  return [resolveRows(handler, sql, params)];
}

async function poolQuery(sql, params = []) {
  calls.push({ sql, params, kind: 'pool.query' });
  const handler = findHandler(sql, params);
  return { rows: resolveRows(handler, sql, params), fields: [] };
}

async function transaction(fn) {
  const tx = {
    execute: async (sql, params = []) => {
      calls.push({ sql, params, kind: 'tx.execute' });
      const h = findHandler(sql, params);
      return [resolveRows(h, sql, params)];
    },
    raw: async (sql, params = []) => {
      calls.push({ sql, params, kind: 'tx.raw' });
      const h = findHandler(sql, params);
      return { rows: resolveRows(h, sql, params), fields: [] };
    },
  };
  return fn(tx);
}

module.exports = {
  execute,
  query,
  raw: poolQuery,
  transaction,
  end: async () => {},
  pool: { query: poolQuery },

  // -------- testing helpers (нижнее подчёркивание = «приватные») --------

  /** Зарегистрировать обработчик ответа на SQL-запрос (LIFO порядок). */
  __when(matcher, response) {
    handlers.unshift({ match: matcher, response });
    return module.exports;
  },

  /** Полный сброс между тестами. */
  __reset() {
    calls.length = 0;
    handlers.length = 0;
  },

  /** Все вызовы execute/query/pool.query, в хронологическом порядке. */
  get __calls() {
    return calls;
  },

  /** Найти первый вызов с SQL, удовлетворяющим regex/функции. */
  __find(matcher) {
    const test =
      typeof matcher === 'function'
        ? matcher
        : (sql) => matcher.test(sql);
    return calls.find((c) => test(c.sql, c.params));
  },

  /** Сколько раз был вызван SQL, удовлетворяющий matcher. */
  __countMatching(matcher) {
    const test =
      typeof matcher === 'function'
        ? matcher
        : (sql) => matcher.test(sql);
    return calls.filter((c) => test(c.sql, c.params)).length;
  },
};
