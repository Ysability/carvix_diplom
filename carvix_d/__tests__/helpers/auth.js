/**
 * Carvix — генератор JWT-токенов для разных ролей в тестах.
 *
 * Использование:
 *   const { tokenFor, ROLES } = require('../helpers/auth');
 *   const token = tokenFor(ROLES.DIRECTOR);
 *   await request(app).get('/api/finance/expenses')
 *     .set('Authorization', `Bearer ${token}`);
 */

const jwt = require('jsonwebtoken');

const ROLES = {
  DIRECTOR:    'Директор',
  ANALYTIC:    'Аналитик',
  MECHANIC:    'Главный механик',
  USER:        'Пользователь',
  DISPATCHER:  'Диспетчер',
  WORKER:      'Механик',
  UNKNOWN:     'Неизвестная роль',
};

const DEFAULT_USER_BY_ROLE = {
  [ROLES.DIRECTOR]:   { id: 1, fio: 'Иванов И.И.',  login: 'ivanov',    rol_id: 5, podrazdelenie_id: 1 },
  [ROLES.ANALYTIC]:   { id: 2, fio: 'Сидоров С.С.', login: 'analytic',  rol_id: 6, podrazdelenie_id: 1 },
  [ROLES.MECHANIC]:   { id: 3, fio: 'Петров П.П.',  login: 'petrov',    rol_id: 7, podrazdelenie_id: 4 },
  [ROLES.USER]:       { id: 4, fio: 'Кузнецов К.К.', login: 'user',     rol_id: 1, podrazdelenie_id: 2 },
  [ROLES.DISPATCHER]: { id: 5, fio: 'Морозова А.В.', login: 'morozova', rol_id: 2, podrazdelenie_id: 1 },
  [ROLES.WORKER]:     { id: 6, fio: 'Сидоров А.О.',  login: 'sidorov',  rol_id: 3, podrazdelenie_id: 4 },
};

/**
 * Подписывает JWT для тестового пользователя.
 * @param {string} role — одна из ROLES.*
 * @param {Object} [overrides] — переопределить fio/login/id и т.д.
 * @param {Object} [opts] — { expiresIn } (по умолчанию '1h')
 */
function tokenFor(role, overrides = {}, opts = {}) {
  const base = DEFAULT_USER_BY_ROLE[role] || DEFAULT_USER_BY_ROLE[ROLES.USER];
  const payload = {
    ...base,
    rol_nazvanie: role,
    ...overrides,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: opts.expiresIn || '1h',
  });
}

/** Создать заведомо просроченный токен (для негативных тестов). */
function expiredTokenFor(role) {
  const base = DEFAULT_USER_BY_ROLE[role] || DEFAULT_USER_BY_ROLE[ROLES.USER];
  return jwt.sign(
    { ...base, rol_nazvanie: role },
    process.env.JWT_SECRET,
    { expiresIn: -10 } // expired 10 sec ago
  );
}

/** Токен, подписанный «не тем» секретом — должен отвергаться middleware. */
function tokenWithWrongSecret(role) {
  const base = DEFAULT_USER_BY_ROLE[role] || DEFAULT_USER_BY_ROLE[ROLES.USER];
  return jwt.sign(
    { ...base, rol_nazvanie: role },
    'definitely-not-the-real-secret',
    { expiresIn: '1h' }
  );
}

module.exports = { ROLES, tokenFor, expiredTokenFor, tokenWithWrongSecret };
