/**
 * Carvix — API ремонтов (для механиков).
 *
 * Контракт ролей:
 *   • Механик — видит свои ремонты (по `mekhanik_id = req.user.id`),
 *     может стартовать и закрывать ремонт. Назначить себя на чужой
 *     ремонт нельзя — это делает Диспетчер.
 *   • Главный механик / Директор — могут редактировать любой ремонт.
 *
 * Все write-операции пишут в finansoviy_log для аудита.
 */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { requireMekhanik } = require('../middleware/rbac');
const { handleResult } = require('../middleware/validate');
const { param, body } = require('express-validator');

const router = express.Router();

async function findStatusId(name) {
  const [rows] = await pool.execute(
    'SELECT id FROM status WHERE nazvanie = ? LIMIT 1',
    [name]
  );
  return rows[0]?.id || null;
}

async function logAction(tx, sotrudnikId, tipOp, remontId, summa, kommentariy) {
  await tx.execute(
    `INSERT INTO finansoviy_log
       (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
     VALUES (?, ?, 'remont', ?, ?, ?)`,
    [sotrudnikId, tipOp, remontId, summa ?? null, kommentariy || null]
  );
}

/**
 * GET /api/remonty/my — открытые ремонты текущего механика.
 * Для главного механика — открытые ремонты всех его подчинённых.
 */
router.get('/my', authRequired, requireMekhanik, async (req, res) => {
  try {
    const role = req.user.rol_nazvanie;
    const params = [];
    let where = '';

    if (role === 'Механик') {
      where = 'WHERE r.mekhanik_id = ?';
      params.push(req.user.id);
    } else if (role === 'Главный механик') {
      where = 'WHERE r.glavniy_mekhanik_id = ? OR r.mekhanik_id IS NOT NULL';
      params.push(req.user.id);
    }
    // Директор — без фильтра

    const [rows] = await pool.execute(
      `SELECT r.id AS remont_id, r.zayavka_id,
              r.data_nachala, r.data_okonchaniya,
              r.stoimost_rabot, r.stoimost_zapchastey,
              r.kommentariy, r.itog,
              z.opisanie, z.prioritet,
              z.status_id, st.nazvanie AS status,
              tr.nazvanie AS tip_remonta,
              ts.id AS ts_id, ts.gos_nomer,
              ma.nazvanie AS marka, mo.nazvanie AS model,
              pd.nazvanie AS podrazdelenie,
              ms.fio AS mekhanik_fio
         FROM remont r
         JOIN zayavka              z  ON z.id = r.zayavka_id
         JOIN status               st ON st.id = z.status_id
         JOIN tip_remonta          tr ON tr.id = z.tip_remonta_id
         JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
         JOIN model                mo ON mo.id = ts.model_id
         JOIN marka                ma ON ma.id = mo.marka_id
         JOIN podrazdelenie        pd ON pd.id = ts.podrazdelenie_id
         LEFT JOIN sotrudnik       ms ON ms.id = r.mekhanik_id
         ${where}
         ORDER BY r.data_okonchaniya IS NULL DESC,
                  r.data_nachala DESC NULLS FIRST,
                  r.id DESC
         LIMIT 200`,
      params
    );
    res.json({ items: rows, total: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения ремонтов' });
  }
});

/**
 * PATCH /api/remonty/:id/start
 *
 * Механик начинает ремонт: data_nachala = NOW(), статус заявки → "В работе".
 * Только сам назначенный механик (или директор/главный) может стартовать.
 */
router.patch('/:id/start', authRequired, requireMekhanik, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Некорректный id' });
    }

    const result = await pool.transaction(async (tx) => {
      const [[r]] = await tx.execute(
        'SELECT id, zayavka_id, mekhanik_id, data_nachala, data_okonchaniya FROM remont WHERE id = ?',
        [id]
      );
      if (!r) return { code: 404, body: { error: 'Ремонт не найден' } };

      // Только назначенный механик (если он есть) — кроме руководства
      if (
        req.user.rol_nazvanie === 'Механик' &&
        r.mekhanik_id !== req.user.id
      ) {
        return {
          code: 403,
          body: { error: 'Этот ремонт назначен не вам' },
        };
      }
      if (r.data_okonchaniya) {
        return { code: 400, body: { error: 'Ремонт уже завершён' } };
      }

      await tx.execute(
        'UPDATE remont SET data_nachala = COALESCE(data_nachala, NOW()) WHERE id = ?',
        [id]
      );
      const vRabote = await findStatusId('В работе');
      if (vRabote) {
        await tx.execute(
          'UPDATE zayavka SET status_id = ? WHERE id = ?',
          [vRabote, r.zayavka_id]
        );
      }
      await logAction(tx, req.user.id, 'start', id, null, null);
      return { code: 200, body: { id, started: true } };
    });
    return res.status(result.code).json(result.body);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка старта ремонта' });
  }
});

/**
 * PATCH /api/remonty/:id/finish
 *
 * Механик закрывает ремонт.
 *   body: {
 *     stoimost_rabot:      number >= 0   (обязательно),
 *     stoimost_zapchastey: number >= 0   (обязательно),
 *     kommentariy:         string?,
 *     itog:                string?       ('Проблема устранена' и т.п.)
 *   }
 */
router.patch('/:id/finish', authRequired, requireMekhanik, [
  param('id').isInt({ min: 1 }).withMessage('Некорректный id'),
  body('stoimost_rabot').isFloat({ min: 0 }).withMessage('Стоимость работ должна быть числом ≥ 0'),
  body('stoimost_zapchastey').isFloat({ min: 0 }).withMessage('Стоимость запчастей должна быть числом ≥ 0'),
  body('kommentariy').optional().trim().isLength({ max: 2000 }).withMessage('Комментарий — макс. 2000 символов'),
  body('itog').optional().trim().isLength({ max: 255 }).withMessage('Итог — макс. 255 символов'),
  handleResult,
], async (req, res) => {
  try {
    const id = Number(req.params.id);
    const stoimost_rabot = Number(req.body?.stoimost_rabot);
    const stoimost_zapchastey = Number(req.body?.stoimost_zapchastey);
    const kommentariy = req.body?.kommentariy || null;
    const itog = req.body?.itog || 'Проблема устранена';

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Некорректный id' });
    }
    if (!Number.isFinite(stoimost_rabot) || stoimost_rabot < 0) {
      return res
        .status(400)
        .json({ error: 'Стоимость работ должна быть числом ≥ 0' });
    }
    if (!Number.isFinite(stoimost_zapchastey) || stoimost_zapchastey < 0) {
      return res
        .status(400)
        .json({ error: 'Стоимость запчастей должна быть числом ≥ 0' });
    }

    const result = await pool.transaction(async (tx) => {
      const [[r]] = await tx.execute(
        'SELECT id, zayavka_id, mekhanik_id, data_nachala, data_okonchaniya FROM remont WHERE id = ?',
        [id]
      );
      if (!r) return { code: 404, body: { error: 'Ремонт не найден' } };

      if (
        req.user.rol_nazvanie === 'Механик' &&
        r.mekhanik_id !== req.user.id
      ) {
        return { code: 403, body: { error: 'Этот ремонт назначен не вам' } };
      }
      if (r.data_okonchaniya) {
        return { code: 400, body: { error: 'Ремонт уже завершён' } };
      }

      await tx.execute(
        `UPDATE remont
            SET data_nachala = COALESCE(data_nachala, NOW()),
                data_okonchaniya = NOW(),
                stoimost_rabot = ?,
                stoimost_zapchastey = ?,
                kommentariy = ?,
                itog = ?
          WHERE id = ?`,
        [stoimost_rabot, stoimost_zapchastey, kommentariy, itog, id]
      );

      const vyp = await findStatusId('Выполнена');
      if (vyp) {
        await tx.execute(
          'UPDATE zayavka SET status_id = ? WHERE id = ?',
          [vyp, r.zayavka_id]
        );
      }

      await logAction(
        tx,
        req.user.id,
        'finish',
        id,
        stoimost_rabot + stoimost_zapchastey,
        itog
      );

      return {
        code: 200,
        body: {
          id,
          stoimost_rabot,
          stoimost_zapchastey,
          itog,
          status: 'Выполнена',
        },
      };
    });

    return res.status(result.code).json(result.body);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка закрытия ремонта' });
  }
});

module.exports = router;
