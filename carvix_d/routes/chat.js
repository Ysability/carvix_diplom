/**
 * Carvix — API чата по заявкам.
 *
 * Контракт:
 *   Отправлять / читать сообщения по заявке могут:
 *     • Создатель заявки (Пользователь / Диспетчер / …)
 *     • Назначенный механик
 *     • Главный механик, Директор — полный доступ
 */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { body } = require('express-validator');
const { handleResult } = require('../middleware/validate');

const router = express.Router();

/**
 * Проверить доступ к чату заявки.
 * Вернёт zayavka row или null.
 */
async function checkAccess(zayavkaId, user) {
  const [rows] = await pool.execute(
    `SELECT z.id, z.sozdatel_id, r.mekhanik_id
       FROM zayavka z
       LEFT JOIN remont r ON r.zayavka_id = z.id
      WHERE z.id = ?`,
    [zayavkaId]
  );
  if (!rows.length) return null;
  const z = rows[0];
  const role = user.rol_nazvanie;

  // Руководство — полный доступ
  if (['Директор', 'Главный механик', 'Диспетчер'].includes(role)) return z;

  // Создатель заявки
  if (z.sozdatel_id === user.id) return z;

  // Назначенный механик
  if (z.mekhanik_id === user.id) return z;

  return null;
}

// GET /api/chat/:zayavkaId — получить сообщения по заявке
router.get('/:zayavkaId', authRequired, async (req, res) => {
  try {
    const zayavkaId = Number(req.params.zayavkaId);
    if (!Number.isFinite(zayavkaId)) {
      return res.status(400).json({ error: 'Некорректный id заявки' });
    }

    const z = await checkAccess(zayavkaId, req.user);
    if (!z) return res.status(403).json({ error: 'Нет доступа к этому чату' });

    const [rows] = await pool.execute(
      `SELECT s.id, s.tekst, s.data_otpravki,
              s.otpravitel_id, so.fio AS otpravitel_fio,
              ro.nazvanie AS otpravitel_rol
         FROM soobscheniye s
         JOIN sotrudnik so ON so.id = s.otpravitel_id
         JOIN rol ro ON ro.id = so.rol_id
        WHERE s.zayavka_id = ?
        ORDER BY s.data_otpravki ASC`,
      [zayavkaId]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения сообщений' });
  }
});

// POST /api/chat/:zayavkaId — отправить сообщение
router.post('/:zayavkaId', authRequired, [
  body('tekst').trim().notEmpty().withMessage('Сообщение не может быть пустым')
    .isLength({ max: 2000 }).withMessage('Макс. 2000 символов'),
  handleResult,
], async (req, res) => {
  try {
    const zayavkaId = Number(req.params.zayavkaId);
    if (!Number.isFinite(zayavkaId)) {
      return res.status(400).json({ error: 'Некорректный id заявки' });
    }

    const z = await checkAccess(zayavkaId, req.user);
    if (!z) return res.status(403).json({ error: 'Нет доступа к этому чату' });

    const tekst = req.body.tekst.trim();
    const [ins] = await pool.execute(
      `INSERT INTO soobscheniye (zayavka_id, otpravitel_id, tekst)
       VALUES (?, ?, ?)
       RETURNING id, data_otpravki`,
      [zayavkaId, req.user.id, tekst]
    );

    res.status(201).json({
      id: ins[0].id,
      zayavka_id: zayavkaId,
      otpravitel_id: req.user.id,
      otpravitel_fio: req.user.fio,
      tekst,
      data_otpravki: ins[0].data_otpravki,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка отправки сообщения' });
  }
});

module.exports = router;
