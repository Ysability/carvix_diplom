/**
 * Carvix — validation helpers (express-validator).
 */

const { body, param, validationResult } = require('express-validator');

/* ---------- generic result handler ---------- */
function handleResult(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const msgs = errors.array().map(e => e.msg);
  return res.status(400).json({ error: msgs.join('; ') });
}

/* ---------- reusable validators ---------- */
const v = {
  id:   param('id').isInt({ min: 1 }).withMessage('Некорректный id'),
  fio:  body('fio').trim().notEmpty().withMessage('Укажите ФИО')
          .isLength({ max: 255 }).withMessage('ФИО не должно превышать 255 символов'),

  login:     body('login').trim().notEmpty().withMessage('Укажите логин'),
  password:  body('password').isLength({ min: 6 }).withMessage('Пароль минимум 6 символов'),

  summa:     body('summa').isFloat({ min: 0 }).withMessage('Сумма должна быть числом ≥ 0'),
  date:      body('data').notEmpty().withMessage('Укажите дату').isDate().withMessage('Некорректная дата'),
  kategoriya: body('kategoriya').trim().notEmpty().withMessage('Укажите категорию'),

  god:       body('god').isInt({ min: 2020, max: 2100 }).withMessage('Год должен быть между 2020 и 2100'),
  mesyats:   body('mesyats').isInt({ min: 1, max: 12 }).withMessage('Месяц должен быть от 1 до 12'),
  plan_summa: body('plan_summa').isFloat({ min: 0 }).withMessage('Плановая сумма должна быть ≥ 0'),

  ts_id:     body('ts_id').optional().custom((v) => v === null || Number.isInteger(+v) && +v > 0).withMessage('Некорректный id ТС'),
  podrazdelenie_id: body('podrazdelenie_id').optional().custom((v) => v === null || Number.isInteger(+v) && +v > 0).withMessage('Некорректный id подразделения'),

  gosNomer:  body('gos_nomer').trim().notEmpty().withMessage('Укажите гос. номер').isLength({ max: 50 }),
  inventNomer: body('invent_nomer').trim().notEmpty().withMessage('Укажите инвентарный номер').isLength({ max: 50 }),
  modelId:   body('model_id').isInt({ min: 1 }).withMessage('Некорректный id модели'),

  tipRemontaId: body('tip_remonta_id').isInt({ min: 1 }).withMessage('Некорректный id типа ремонта'),
  prioritet:    body('prioritet').optional().isInt({ min: 1, max: 5 }).withMessage('Приоритет от 1 до 5'),

  stoimostRabot:      body('stoimost_rabot').isFloat({ min: 0 }).withMessage('Стоимость работ ≥ 0'),
  stoimostZapchastey: body('stoimost_zapchastey').isFloat({ min: 0 }).withMessage('Стоимость запчастей ≥ 0'),
};

module.exports = { handleResult, v };
