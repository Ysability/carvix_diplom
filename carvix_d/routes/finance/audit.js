/**
 * Carvix — журнал финансовых операций.
 *
 *   GET /api/finance/audit-log     лог с фильтрами и пагинацией
 *
 * Доступ: только Аналитик и Директор.
 */

const express = require('express');
const pool = require('../../db');
const { authRequired } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');

const router = express.Router();

router.get(
  '/',
  authRequired,
  requireRole('Директор', 'Аналитик'),
  async (req, res) => {
    try {
      const {
        from, to,
        sotrudnik_id,
        tip_operatsii,
        limit = 100,
        offset = 0,
      } = req.query;

      const where = [];
      const params = [];

      if (from) { params.push(from); where.push(`l.data_operatsii >= $${params.length}::timestamp`); }
      if (to)   { params.push(to);   where.push(`l.data_operatsii <= $${params.length}::timestamp`); }
      if (sotrudnik_id) {
        params.push(sotrudnik_id);
        where.push(`l.sotrudnik_id = $${params.length}`);
      }
      if (tip_operatsii) {
        params.push(tip_operatsii);
        where.push(`l.tip_operatsii = $${params.length}`);
      }
      if (req.query.q) {
        const q = `%${req.query.q.trim()}%`;
        params.push(q, q, q);
        where.push(`(l.kommentariy ILIKE $${params.length - 2} OR l.tip_operatsii ILIKE $${params.length - 1} OR s.fio ILIKE $${params.length})`);
      }

      const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const lim = Math.min(parseInt(limit, 10) || 100, 500);
      const off = parseInt(offset, 10) || 0;

      const sql = `
        SELECT l.id, l.data_operatsii, l.tip_operatsii,
               l.obyekt_tablitsa, l.obyekt_id,
               l.summa, l.kommentariy,
               l.sotrudnik_id, s.fio AS sotrudnik_fio,
               r.nazvanie AS sotrudnik_rol
          FROM finansoviy_log l
          LEFT JOIN sotrudnik s ON s.id = l.sotrudnik_id
          LEFT JOIN rol r       ON r.id = s.rol_id
         ${whereSQL}
         ORDER BY l.data_operatsii DESC, l.id DESC
         LIMIT ${lim} OFFSET ${off}
      `;
      const totalSQL = `SELECT COUNT(*)::int AS total FROM finansoviy_log l LEFT JOIN sotrudnik s ON s.id = l.sotrudnik_id ${whereSQL}`;

      const [{ rows: items }, { rows: total }] = await Promise.all([
        pool.pool.query(sql, params),
        pool.pool.query(totalSQL, params),
      ]);

      res.json({
        items, total: total[0].total, limit: lim, offset: off,
      });
    } catch (e) {
      console.error('[audit-log] GET error:', e);
      res.status(500).json({ error: 'Ошибка получения журнала' });
    }
  }
);

module.exports = router;
