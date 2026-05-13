/**
 * Carvix — Role-Based Access Control middleware.
 *
 * Использование:
 *   router.get('/budgets', authRequired, requireRole('Директор', 'Аналитик'), handler);
 *
 * Роль берётся из JWT-payload (поле rol_nazvanie). Если в токене нет роли
 * (старые токены) — возвращаем 403.
 */

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.rol_nazvanie;

    if (!role) {
      return res
        .status(403)
        .json({ error: 'Роль не определена. Выполните вход заново.' });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: `Недостаточно прав. Требуется одна из ролей: ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
}

// ──────────────────────────────────────────────────────────
// Готовые группы ролей (сахар)
// ──────────────────────────────────────────────────────────

// Финансы
const requireFinanceRead = requireRole(
  'Директор',
  'Аналитик',
  'Главный механик'
);
const requireFinanceWrite = requireRole('Директор', 'Главный механик');

// Заявки/ремонты
//
// Создавать заявку могут все, кому она «принадлежит» как пользователю
// автопарка: Пользователь, Диспетчер, Главный механик и Директор.
// Механик и Аналитик заявки не создают.
const requireZayavkaCreate = requireRole(
  'Пользователь',
  'Диспетчер',
  'Главный механик',
  'Директор'
);

// Видеть **все** заявки могут диспетчер и руководство.
// Пользователь и механик ограничены своими — это контролируется в SQL.
const requireZayavkaReadAll = requireRole(
  'Диспетчер',
  'Главный механик',
  'Директор',
  'Аналитик'
);

// Назначать механика, делать автонаводку, менять статус
const requireDispetcher = requireRole(
  'Диспетчер',
  'Главный механик',
  'Директор'
);

// Работа с ремонтом (старт, финиш, журнал нормо-часов)
const requireMekhanik = requireRole(
  'Механик',
  'Главный механик',
  'Директор'
);

module.exports = {
  requireRole,
  requireFinanceRead,
  requireFinanceWrite,
  requireZayavkaCreate,
  requireZayavkaReadAll,
  requireDispetcher,
  requireMekhanik,
};
