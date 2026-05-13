/**
 * Carvix — управление бюджетами и сравнение план/факт.
 *
 *   GET    /api/finance/budgets                список с фильтрами
 *   GET    /api/finance/budgets/plan-fakt      план/факт + % исполнения
 *   POST   /api/finance/budgets                создать (чтение/запись — только Директор)
 *   PUT    /api/finance/budgets/:id            изменить план_сумму
 *   DELETE /api/finance/budgets/:id            удалить
 */

const express = require('express');
const pool = require('../../db');
const { authRequired } = require('../../middleware/auth');
const { requireRole, requireFinanceRead } = require('../../middleware/rbac');

const router = express.Router();

const onlyDirektor = requireRole('Директор');

const ALLOWED_KATEGORIY = ['remont', 'zapchasti', 'topliv', 'prochee'];

/* ----------- GET /budgets ----------- */
router.get('/', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const { god, mesyats, podrazdelenie_id, kategoriya } = req.query;
    const where = [];
    const params = [];

    if (god) { params.push(god); where.push(`b.god = $${params.length}`); }
    if (mesyats) { params.push(mesyats); where.push(`b.mesyats = $${params.length}`); }
    if (podrazdelenie_id) { params.push(podrazdelenie_id); where.push(`b.podrazdelenie_id = $${params.length}`); }
    if (kategoriya) { params.push(kategoriya); where.push(`b.kategoriya = $${params.length}`); }

    const sql = `
      SELECT b.id, b.podrazdelenie_id, pd.nazvanie AS podrazdelenie_nazvanie,
             b.god, b.mesyats, b.kategoriya, b.plan_summa
        FROM byudzhet b
        JOIN podrazdelenie pd ON pd.id = b.podrazdelenie_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY b.god DESC, b.mesyats ASC, pd.nazvanie ASC, b.kategoriya ASC
    `;
    const r = await pool.pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    console.error('[budgets] GET error:', e);
    res.status(500).json({ error: 'Ошибка получения бюджетов' });
  }
});

/* ----------- GET /budgets/plan-fakt ----------- */
router.get('/plan-fakt', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const { god, mesyats, podrazdelenie_id, kategoriya } = req.query;
    const where = [];
    const params = [];

    if (god) { params.push(god); where.push(`v.god = $${params.length}`); }
    if (mesyats) { params.push(mesyats); where.push(`v.mesyats = $${params.length}`); }
    if (podrazdelenie_id) { params.push(podrazdelenie_id); where.push(`v.podrazdelenie_id = $${params.length}`); }
    if (kategoriya) { params.push(kategoriya); where.push(`v.kategoriya = $${params.length}`); }

    const sql = `
      SELECT v.byudzhet_id, v.podrazdelenie_id, v.podrazdelenie_nazvanie,
             v.god, v.mesyats, v.kategoriya,
             v.plan_summa, v.fakt_summa, v.otklonenie, v.protsent_ispolneniya
        FROM v_byudzhet_plan_fakt v
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY v.god DESC, v.mesyats ASC, v.podrazdelenie_nazvanie, v.kategoriya
    `;
    const r = await pool.pool.query(sql, params);

    // Агрегаты для дашборда
    const totals = r.rows.reduce(
      (acc, row) => {
        acc.plan += Number(row.plan_summa);
        acc.fakt += Number(row.fakt_summa);
        return acc;
      },
      { plan: 0, fakt: 0 }
    );
    totals.otklonenie = totals.plan - totals.fakt;
    totals.protsent = totals.plan ? Math.round((totals.fakt / totals.plan) * 1000) / 10 : 0;

    res.json({ items: r.rows, totals });
  } catch (e) {
    console.error('[budgets] plan-fakt error:', e);
    res.status(500).json({ error: 'Ошибка плана/факта' });
  }
});

/* ----------- POST /budgets/bulk -----------
 * Массовое UPSERT-сохранение годовой матрицы плана.
 * Ожидаемый формат body:
 *   { items: [{ podrazdelenie_id, god, mesyats, kategoriya, plan_summa }, ...] }
 *
 * Существующие комбинации (podrazdelenie_id, god, mesyats, kategoriya) обновляются,
 * новые — вставляются. Возвращает { created, updated }.
 */
router.post('/bulk', authRequired, onlyDirektor, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'items должен быть непустым массивом' });

    let created = 0, updated = 0;
    await pool.transaction(async (tx) => {
      for (const it of items) {
        const { podrazdelenie_id, god, mesyats, kategoriya, plan_summa } = it;
        if (!podrazdelenie_id || !god || !mesyats || !kategoriya || plan_summa === undefined) continue;
        if (!ALLOWED_KATEGORIY.includes(kategoriya)) continue;
        if (Number(plan_summa) < 0) continue;

        const [r] = await tx.execute(
          `INSERT INTO byudzhet (podrazdelenie_id, god, mesyats, kategoriya, plan_summa)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (podrazdelenie_id, god, mesyats, kategoriya)
             DO UPDATE SET plan_summa = EXCLUDED.plan_summa
           RETURNING id, (xmax = 0) AS is_new`,
          [podrazdelenie_id, god, mesyats, kategoriya, Number(plan_summa)]
        );
        if (r[0].is_new) created++; else updated++;
      }

      await tx.execute(
        `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, summa, kommentariy)
         VALUES (?, 'BULK_BYUDZHET', 'byudzhet', NULL, ?)`,
        [req.user.id, `Массовое сохранение бюджетов: создано ${created}, обновлено ${updated}`]
      );
    });

    res.json({ ok: true, created, updated });
  } catch (e) {
    console.error('[budgets] bulk error:', e);
    res.status(500).json({ error: 'Ошибка массового сохранения бюджетов: ' + e.message });
  }
});

/* ----------- POST /budgets/copy-from-prev-year -----------
 * Копирует все бюджеты из (god - 1) в god, домножая plan_summa на коэффициент.
 * body: { god, koeff = 1.1 }
 */
router.post('/copy-from-prev-year', authRequired, onlyDirektor, async (req, res) => {
  try {
    const { god, koeff = 1.1 } = req.body;
    if (!god) return res.status(400).json({ error: 'Укажите god' });
    const targetGod = Number(god);
    const k = Number(koeff);
    if (!Number.isFinite(k) || k <= 0)
      return res.status(400).json({ error: 'koeff должен быть числом > 0' });

    const result = await pool.transaction(async (tx) => {
      const [src] = await tx.execute(
        `SELECT podrazdelenie_id, mesyats, kategoriya, plan_summa
           FROM byudzhet WHERE god = ?`,
        [targetGod - 1]
      );
      if (!src.length) return { copied: 0 };

      let copied = 0;
      for (const row of src) {
        await tx.execute(
          `INSERT INTO byudzhet (podrazdelenie_id, god, mesyats, kategoriya, plan_summa)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (podrazdelenie_id, god, mesyats, kategoriya)
             DO UPDATE SET plan_summa = EXCLUDED.plan_summa`,
          [row.podrazdelenie_id, targetGod, row.mesyats, row.kategoriya,
           Math.round(Number(row.plan_summa) * k * 100) / 100]
        );
        copied++;
      }

      await tx.execute(
        `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, summa, kommentariy)
         VALUES (?, 'COPY_BYUDZHET', 'byudzhet', NULL, ?)`,
        [req.user.id,
         `Скопировано ${copied} бюджетных записей с ${targetGod - 1} на ${targetGod} с коэффициентом ${k}`]
      );

      return { copied };
    });

    res.json({ ok: true, ...result, target_god: targetGod, source_god: targetGod - 1, koeff: k });
  } catch (e) {
    console.error('[budgets] copy-from-prev-year error:', e);
    res.status(500).json({ error: 'Ошибка копирования бюджетов: ' + e.message });
  }
});

/* ----------- POST /budgets ----------- */
router.post('/', authRequired, onlyDirektor, async (req, res) => {
  try {
    const { podrazdelenie_id, god, mesyats, kategoriya, plan_summa } = req.body;

    if (!podrazdelenie_id || !god || !mesyats || !kategoriya || plan_summa === undefined)
      return res.status(400).json({ error: 'Заполните все поля' });
    if (!ALLOWED_KATEGORIY.includes(kategoriya))
      return res.status(400).json({ error: 'Недопустимая категория' });
    if (Number(plan_summa) < 0)
      return res.status(400).json({ error: 'Плановая сумма не может быть отрицательной' });
    if (Number(mesyats) < 1 || Number(mesyats) > 12)
      return res.status(400).json({ error: 'Месяц должен быть от 1 до 12' });

    try {
      const [rows] = await pool.execute(
        `INSERT INTO byudzhet (podrazdelenie_id, god, mesyats, kategoriya, plan_summa)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *`,
        [podrazdelenie_id, god, mesyats, kategoriya, Number(plan_summa)]
      );

      await pool.execute(
        `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
         VALUES (?, 'SOZDAN_BYUDZHET', 'byudzhet', ?, ?, ?)`,
        [req.user.id, rows[0].id, Number(plan_summa),
         `Бюджет ${kategoriya} ${mesyats}/${god} для подразделения #${podrazdelenie_id}`]
      );

      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'Бюджет на этот период/категорию уже существует',
        });
      }
      throw err;
    }
  } catch (e) {
    console.error('[budgets] POST error:', e);
    res.status(500).json({ error: 'Ошибка создания бюджета' });
  }
});

/* ----------- PUT /budgets/:id ----------- */
router.put('/:id', authRequired, onlyDirektor, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { plan_summa } = req.body;
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    if (plan_summa === undefined || Number(plan_summa) < 0)
      return res.status(400).json({ error: 'Некорректная плановая сумма' });

    const [rows] = await pool.execute(
      `UPDATE byudzhet SET plan_summa = ? WHERE id = ? RETURNING *`,
      [Number(plan_summa), id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Бюджет не найден' });

    await pool.execute(
      `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
       VALUES (?, 'IZMENEN_BYUDZHET', 'byudzhet', ?, ?, ?)`,
      [req.user.id, id, Number(plan_summa), 'Изменена плановая сумма бюджета']
    );

    res.json(rows[0]);
  } catch (e) {
    console.error('[budgets] PUT error:', e);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

/* ----------- DELETE /budgets/:id ----------- */
router.delete('/:id', authRequired, onlyDirektor, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    const [rows] = await pool.execute(
      'DELETE FROM byudzhet WHERE id = ? RETURNING plan_summa',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });

    await pool.execute(
      `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
       VALUES (?, 'UDALEN_BYUDZHET', 'byudzhet', ?, ?, ?)`,
      [req.user.id, id, Number(rows[0].plan_summa), 'Удалён бюджет']
    );

    res.json({ ok: true, deleted_id: id });
  } catch (e) {
    console.error('[budgets] DELETE error:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
