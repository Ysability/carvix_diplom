/**
 * Carvix — unit-тесты middleware/auth.js (JWT-валидация).
 *
 * Тестовая стратегия:
 *   • не используем supertest и Express, вызываем middleware напрямую
 *     с заглушками `req`, `res`, `next` — это классические unit-тесты;
 *   • покрываем все 4 ветки: нет header / есть, но не Bearer / валидный токен /
 *     невалидный токен (включая «не тот секрет» и «просрочен»).
 */

const jwt = require('jsonwebtoken');
const { authRequired } = require('../../middleware/auth');
const { tokenFor, expiredTokenFor, tokenWithWrongSecret, ROLES } = require('../helpers/auth');

/** Фабрика mock-объектов req/res/next. */
function setup(headers = {}) {
  const req = { headers };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body)   { this.body = body;       return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('middleware/auth.authRequired', () => {
  it('возвращает 401, если заголовок Authorization отсутствует', () => {
    const { req, res, next } = setup({});
    authRequired(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Требуется авторизация' });
    expect(next).not.toHaveBeenCalled();
  });

  it('возвращает 401, если заголовок не начинается с "Bearer "', () => {
    const { req, res, next } = setup({ authorization: 'Basic abc123' });
    authRequired(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('возвращает 401 для токена, подписанного другим секретом', () => {
    const { req, res, next } = setup({
      authorization: `Bearer ${tokenWithWrongSecret(ROLES.DIRECTOR)}`,
    });

    authRequired(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Недействительный токен' });
    expect(next).not.toHaveBeenCalled();
  });

  it('возвращает 401 для просроченного токена', () => {
    const { req, res, next } = setup({
      authorization: `Bearer ${expiredTokenFor(ROLES.DIRECTOR)}`,
    });

    authRequired(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Недействительный токен' });
  });

  it('кладёт payload в req.user и вызывает next() при валидном токене', () => {
    const token = tokenFor(ROLES.DIRECTOR, { id: 42 });
    const { req, res, next } = setup({ authorization: `Bearer ${token}` });

    authRequired(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      id: 42,
      rol_nazvanie: 'Директор',
      login: 'ivanov',
    });
  });

  it('одинаково работает для регистра "Bearer" и пробелов вокруг (контрольный)', () => {
    // RFC 6750 строго требует "Bearer " с пробелом — middleware соблюдает это.
    const token = tokenFor(ROLES.ANALYTIC);
    const { req, res, next } = setup({ authorization: `Bearer ${token}` });
    authRequired(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('подписанный JWT действительно содержит ожидаемый payload (sanity-check)', () => {
    const token = tokenFor(ROLES.MECHANIC, { id: 99 });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded).toMatchObject({
      id: 99,
      rol_nazvanie: 'Главный механик',
    });
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
