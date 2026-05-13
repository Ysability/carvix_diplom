/**
 * Carvix — приходные накладные на запчасти.
 *
 *   GET    /api/finance/parts/receipts          список с фильтрами
 *   GET    /api/finance/parts/receipts/:id      детальный + позиции
 *   POST   /api/finance/parts/receipts          создать (в транзакции:
 *                                                 + позиции,
 *                                                 + остатки на складе,
 *                                                 + audit-log)
 *   DELETE /api/finance/parts/receipts/:id      удалить (CASCADE по позициям)
 */

const express = require('express');
const pool = require('../../db');
const { authRequired } = require('../../middleware/auth');
const { requireFinanceRead, requireFinanceWrite } = require('../../middleware/rbac');

const router = express.Router();

/* ----------- Справочники для выпадашек ----------- */
// Список запчастей
router.get('/dictionary/zapchasti', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const r = await pool.pool.query(
      `SELECT id, naimenovanie, artikul, kategoriya,
              tsena AS posledniaya_tsena,
              ostatok_na_sklade
         FROM zapchast
        ORDER BY naimenovanie`
    );
    res.json(r.rows);
  } catch (e) {
    console.error('[receipts] zapchasti error:', e);
    res.status(500).json({ error: 'Ошибка справочника запчастей' });
  }
});

// Список поставщиков
router.get('/dictionary/postavshiki', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const r = await pool.pool.query(
      `SELECT id, nazvanie, kontakty FROM postavshik ORDER BY nazvanie`
    );
    res.json(r.rows);
  } catch (e) {
    console.error('[receipts] postavshiki error:', e);
    res.status(500).json({ error: 'Ошибка справочника поставщиков' });
  }
});

/* ----------- GET /parts/receipts ----------- */
router.get('/', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const { from, to, postavshik_id } = req.query;
    const where = [];
    const params = [];

    if (from) { params.push(from); where.push(`p.data_prikhoda >= $${params.length}::date`); }
    if (to)   { params.push(to);   where.push(`p.data_prikhoda <= $${params.length}::date`); }
    if (postavshik_id) { params.push(postavshik_id); where.push(`p.postavshik_id = $${params.length}`); }

    const sql = `
      SELECT p.id, p.data_prikhoda, p.nomer_nakl, p.summa_obshaya,
             p.postavshik_id, ps.nazvanie AS postavshik_nazvanie,
             p.kommentariy, p.sozdatel_id,
             s.fio AS sozdatel_fio,
             COUNT(pp.id)::int    AS kolvo_pozitsiy,
             COALESCE(SUM(pp.kolichestvo), 0)::int AS itogo_edinic
        FROM prikhod_zapchasti p
        JOIN postavshik ps ON ps.id = p.postavshik_id
        LEFT JOIN sotrudnik s ON s.id = p.sozdatel_id
        LEFT JOIN prikhod_zapchasti_pozitsii pp ON pp.prikhod_id = p.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       GROUP BY p.id, ps.nazvanie, s.fio
       ORDER BY p.data_prikhoda DESC, p.id DESC
    `;
    const r = await pool.pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    console.error('[receipts] GET error:', e);
    res.status(500).json({ error: 'Ошибка получения накладных' });
  }
});

/* ----------- GET /parts/receipts/:id ----------- */
router.get('/:id', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    const [rows] = await pool.execute(
      `SELECT p.*, ps.nazvanie AS postavshik_nazvanie, ps.kontakty, s.fio AS sozdatel_fio
         FROM prikhod_zapchasti p
         JOIN postavshik ps    ON ps.id = p.postavshik_id
         LEFT JOIN sotrudnik s ON s.id = p.sozdatel_id
        WHERE p.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Накладная не найдена' });

    const [pozitsii] = await pool.execute(
      `SELECT pp.id, pp.zapchast_id, z.naimenovanie, z.artikul,
              pp.kolichestvo, pp.tsena_za_edinicu,
              (pp.kolichestvo * pp.tsena_za_edinicu) AS itogo_pozitsii
         FROM prikhod_zapchasti_pozitsii pp
         JOIN zapchast z ON z.id = pp.zapchast_id
        WHERE pp.prikhod_id = ?
        ORDER BY pp.id`,
      [id]
    );

    res.json({ ...rows[0], pozitsii });
  } catch (e) {
    console.error('[receipts] GET :id error:', e);
    res.status(500).json({ error: 'Ошибка получения накладной' });
  }
});

/* ----------- POST /parts/receipts ----------- */
router.post('/', authRequired, requireFinanceWrite, async (req, res) => {
  try {
    const { postavshik_id, data_prikhoda, nomer_nakl, kommentariy, pozitsii } = req.body;

    if (!postavshik_id || !data_prikhoda || !Array.isArray(pozitsii) || pozitsii.length === 0) {
      return res.status(400).json({ error: 'Заполните постав-щика, дату и хотя бы одну позицию' });
    }

    for (const p of pozitsii) {
      if (!p.zapchast_id || !p.kolichestvo || p.tsena_za_edinicu === undefined) {
        return res.status(400).json({ error: 'У позиции должны быть zapchast_id, kolichestvo, tsena_za_edinicu' });
      }
      if (Number(p.kolichestvo) <= 0 || Number(p.tsena_za_edinicu) < 0) {
        return res.status(400).json({ error: 'Некорректные числа в позиции' });
      }
    }

    const summa_obshaya = pozitsii.reduce(
      (s, p) => s + Number(p.kolichestvo) * Number(p.tsena_za_edinicu),
      0
    );

    const result = await pool.transaction(async (tx) => {
      // 1. Шапка накладной
      const [hdr] = await tx.execute(
        `INSERT INTO prikhod_zapchasti
           (postavshik_id, data_prikhoda, nomer_nakl, summa_obshaya, kommentariy, sozdatel_id)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [postavshik_id, data_prikhoda, nomer_nakl || null,
         summa_obshaya, kommentariy || null, req.user.id]
      );
      const prikhod = hdr[0];

      // 2. Позиции + увеличение остатка на складе
      for (const p of pozitsii) {
        await tx.execute(
          `INSERT INTO prikhod_zapchasti_pozitsii
             (prikhod_id, zapchast_id, kolichestvo, tsena_za_edinicu)
           VALUES (?, ?, ?, ?)`,
          [prikhod.id, p.zapchast_id, Number(p.kolichestvo), Number(p.tsena_za_edinicu)]
        );

        await tx.execute(
          `UPDATE zapchast
             SET ostatok_na_sklade = COALESCE(ostatok_na_sklade, 0) + ?
           WHERE id = ?`,
          [Number(p.kolichestvo), p.zapchast_id]
        );
      }

      // 3. Audit-log
      await tx.execute(
        `INSERT INTO finansoviy_log
           (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
         VALUES (?, 'PRIKHOD_ZAPCHASTI', 'prikhod_zapchasti', ?, ?, ?)`,
        [req.user.id, prikhod.id, summa_obshaya,
         `Принята накладная № ${nomer_nakl || prikhod.id} от поставщика #${postavshik_id}`]
      );

      return prikhod;
    });

    res.status(201).json(result);
  } catch (e) {
    console.error('[receipts] POST error:', e);
    res.status(500).json({ error: 'Ошибка создания накладной: ' + e.message });
  }
});

/* ----------- DELETE /parts/receipts/:id ----------- */
router.delete('/:id', authRequired, requireFinanceWrite, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    await pool.transaction(async (tx) => {
      const [hdr] = await tx.execute(
        'SELECT id, summa_obshaya, nomer_nakl FROM prikhod_zapchasti WHERE id = ?',
        [id]
      );
      if (!hdr.length) {
        const err = new Error('Накладная не найдена');
        err.code = 'NOT_FOUND';
        throw err;
      }

      // Возвращаем остатки на склад в обратную сторону
      const [pozitsii] = await tx.execute(
        'SELECT zapchast_id, kolichestvo FROM prikhod_zapchasti_pozitsii WHERE prikhod_id = ?',
        [id]
      );
      for (const p of pozitsii) {
        await tx.execute(
          `UPDATE zapchast
             SET ostatok_na_sklade = GREATEST(0, COALESCE(ostatok_na_sklade,0) - ?)
           WHERE id = ?`,
          [p.kolichestvo, p.zapchast_id]
        );
      }

      await tx.execute('DELETE FROM prikhod_zapchasti WHERE id = ?', [id]);  // CASCADE

      await tx.execute(
        `INSERT INTO finansoviy_log
           (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
         VALUES (?, 'OTMENA_PRIKHODA', 'prikhod_zapchasti', ?, ?, ?)`,
        [req.user.id, id, Number(hdr[0].summa_obshaya),
         `Удалена накладная № ${hdr[0].nomer_nakl || id}`]
      );
    });

    res.json({ ok: true, deleted_id: id });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    console.error('[receipts] DELETE error:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
