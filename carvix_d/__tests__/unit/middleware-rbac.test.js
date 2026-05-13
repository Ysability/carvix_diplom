/**
 * Carvix — unit-тесты middleware/rbac.js (Role-Based Access Control).
 *
 * Покрываем:
 *   • 403 при отсутствии user.rol_nazvanie (поломанный/старый токен);
 *   • 403 при роли, которой нет в whitelist;
 *   • next() при разрешённой роли;
 *   • готовые сахарные middleware: requireFinanceRead и requireFinanceWrite
 *     корректно различают чтение и запись.
 */

const {
  requireRole,
  requireFinanceRead,
  requireFinanceWrite,
} = require('../../middleware/rbac');
const { ROLES } = require('../helpers/auth');

function setup(role) {
  const req = { user: role ? { rol_nazvanie: role } : {} };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body)   { this.body = body;       return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('middleware/rbac.requireRole', () => {
  it('возвращает 403, если в req.user нет роли', () => {
    const { req, res, next } = setup(null);
    requireRole(ROLES.DIRECTOR)(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Роль не определена/);
    expect(next).not.toHaveBeenCalled();
  });

  it('возвращает 403, если роль не входит в whitelist', () => {
    const { req, res, next } = setup(ROLES.USER);
    requireRole(ROLES.DIRECTOR, ROLES.ANALYTIC)(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Недостаточно прав/);
    expect(res.body.error).toMatch(/Директор/);
    expect(res.body.error).toMatch(/Аналитик/);
  });

  it('пропускает запрос, если роль входит в whitelist', () => {
    const { req, res, next } = setup(ROLES.DIRECTOR);
    requireRole(ROLES.DIRECTOR, ROLES.ANALYTIC)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});

describe('middleware/rbac.requireFinanceRead (Директор/Аналитик/Главный механик)', () => {
  it.each([ROLES.DIRECTOR, ROLES.ANALYTIC, ROLES.MECHANIC])(
    'разрешает чтение роли %s',
    (role) => {
      const { req, res, next } = setup(role);
      requireFinanceRead(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  );

  it('запрещает чтение обычному пользователю', () => {
    const { req, res, next } = setup(ROLES.USER);
    requireFinanceRead(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('middleware/rbac.requireFinanceWrite (Директор/Главный механик)', () => {
  it('разрешает запись Директору', () => {
    const { req, res, next } = setup(ROLES.DIRECTOR);
    requireFinanceWrite(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('разрешает запись Главному механику', () => {
    const { req, res, next } = setup(ROLES.MECHANIC);
    requireFinanceWrite(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('запрещает запись Аналитику (read-only)', () => {
    const { req, res, next } = setup(ROLES.ANALYTIC);
    requireFinanceWrite(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Недостаточно прав/);
  });

  it('запрещает запись обычному пользователю', () => {
    const { req, res, next } = setup(ROLES.USER);
    requireFinanceWrite(req, res, next);
    expect(res.statusCode).toBe(403);
  });
});
