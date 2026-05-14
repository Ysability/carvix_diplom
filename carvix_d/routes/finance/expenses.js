/**
 * Carvix — реестр всех расходов автопарка.
 *
 *   GET    /api/finance/expenses        список с фильтрами и пагинацией
 *   POST   /api/finance/expenses        добавить прочий расход
 *   DELETE /api/finance/expenses/:id    удалить прочий расход
 *
 * Реестр объединяет три источника:
 *   1. remont.stoimost_rabot       (категория «remont»)
 *   2. remont.stoimost_zapchastey  (категория «zapchasti»)
 *   3. prochiy_raskhod             (топливо, страховка, налоги, мойка...)
 */

const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const pool = require('../../db');
const { authRequired } = require('../../middleware/auth');
const { requireFinanceRead, requireFinanceWrite } = require('../../middleware/rbac');
const { handleResult, v } = require('../../middleware/validate');
const { body } = require('express-validator');

const router = express.Router();

// CSV-импорт: до 2 МБ, в памяти
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const ALLOWED_KATEGORIY = [
  'remont', 'zapchasti', 'topliv', 'strakhovka', 'nalog', 'moyka', 'prochee',
];

// Унифицированная подзапрос-витрина (CTE)
const UNIFIED_CTE = `
  SELECT
    'remont_rabot' AS source,
    r.id::text     AS source_id,
    r.data_okonchaniya::date AS data,
    'remont'       AS kategoriya,
    r.stoimost_rabot AS summa,
    ts.id          AS ts_id,
    ts.gos_nomer,
    ts.podrazdelenie_id,
    pd.nazvanie    AS podrazdelenie_nazvanie,
    'Стоимость работ ремонта №' || r.id AS opisanie
  FROM remont r
  JOIN zayavka z                ON z.id = r.zayavka_id
  JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
  JOIN podrazdelenie pd         ON pd.id = ts.podrazdelenie_id
  WHERE r.data_okonchaniya IS NOT NULL AND r.stoimost_rabot > 0

  UNION ALL

  SELECT
    'remont_zapchasti' AS source,
    r.id::text         AS source_id,
    r.data_okonchaniya::date,
    'zapchasti',
    r.stoimost_zapchastey,
    ts.id, ts.gos_nomer,
    ts.podrazdelenie_id, pd.nazvanie,
    'Стоимость запчастей ремонта №' || r.id
  FROM remont r
  JOIN zayavka z                ON z.id = r.zayavka_id
  JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
  JOIN podrazdelenie pd         ON pd.id = ts.podrazdelenie_id
  WHERE r.data_okonchaniya IS NOT NULL AND r.stoimost_zapchastey > 0

  UNION ALL

  SELECT
    'prochiy' AS source,
    pr.id::text,
    pr.data,
    pr.kategoriya,
    pr.summa,
    pr.ts_id,
    ts.gos_nomer,
    COALESCE(pr.podrazdelenie_id, ts.podrazdelenie_id) AS podrazdelenie_id,
    pd.nazvanie,
    pr.opisanie
  FROM prochiy_raskhod pr
  LEFT JOIN transportnoe_sredstvo ts ON ts.id = pr.ts_id
  LEFT JOIN podrazdelenie pd ON pd.id = COALESCE(pr.podrazdelenie_id, ts.podrazdelenie_id)
`;

/* ----------------------------------------------------------------- */
/*  GET /api/finance/expenses                                        */
/* ----------------------------------------------------------------- */
router.get('/', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const {
      from, to,
      podrazdelenie_id,
      kategoriya,
      ts_id,
      source,                       // remont_rabot | remont_zapchasti | prochiy | all
      limit = 50,
      offset = 0,
    } = req.query;

    const where = [];
    const params = [];

    if (from) { params.push(from); where.push(`x.data >= $${params.length}::date`); }
    if (to)   { params.push(to);   where.push(`x.data <= $${params.length}::date`); }
    if (podrazdelenie_id) { params.push(podrazdelenie_id); where.push(`x.podrazdelenie_id = $${params.length}`); }
    if (kategoriya)       { params.push(kategoriya);       where.push(`x.kategoriya = $${params.length}`); }
    if (ts_id)            { params.push(ts_id);            where.push(`x.ts_id = $${params.length}`); }
    if (source && source !== 'all') {
      params.push(source);
      where.push(`x.source = $${params.length}`);
    }
    if (req.query.q) {
      const q = `%${req.query.q.trim()}%`;
      params.push(q, q, q);
      where.push(`(x.gos_nomer ILIKE $${params.length - 2} OR x.opisanie ILIKE $${params.length - 1} OR x.podrazdelenie_nazvanie ILIKE $${params.length})`);
    }

    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const lim = Math.min(parseInt(limit, 10) || 50, 500);
    const off = parseInt(offset, 10) || 0;

    const dataSQL = `
      SELECT * FROM (${UNIFIED_CTE}) x
      ${whereSQL}
      ORDER BY x.data DESC, x.summa DESC
      LIMIT ${lim} OFFSET ${off}
    `;
    const totalSQL = `
      SELECT COUNT(*)::int AS total, COALESCE(SUM(x.summa), 0)::numeric AS total_summa
      FROM (${UNIFIED_CTE}) x
      ${whereSQL}
    `;

    const [{ rows: items }, { rows: agg }] = await Promise.all([
      pool.pool.query(dataSQL, params),
      pool.pool.query(totalSQL, params),
    ]);

    res.json({
      items,
      total: agg[0].total,
      total_summa: Number(agg[0].total_summa),
      limit: lim,
      offset: off,
    });
  } catch (e) {
    console.error('[expenses] GET error:', e);
    res.status(500).json({ error: 'Ошибка получения расходов' });
  }
});

/* ----------------------------------------------------------------- */
/*  POST /api/finance/expenses                                       */
/*    создаёт запись в prochiy_raskhod                               */
/* ----------------------------------------------------------------- */
router.post('/', authRequired, requireFinanceWrite, [
  body('data').notEmpty().withMessage('Укажите дату').isISO8601().withMessage('Некорректная дата'),
  body('kategoriya').trim().notEmpty().withMessage('Укажите категорию').isIn(ALLOWED_KATEGORIY).withMessage('Недопустимая категория'),
  body('summa').isFloat({ min: 0 }).withMessage('Сумма должна быть числом ≥ 0'),
  body('ts_id').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Некорректный id ТС'),
  body('podrazdelenie_id').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Некорректный id подразделения'),
  body('opisanie').optional().trim().isLength({ max: 2000 }).withMessage('Описание слишком длинное'),
  handleResult,
], async (req, res) => {
  try {
    const { ts_id, podrazdelenie_id, data, kategoriya, summa, opisanie } = req.body;

    if (!data) return res.status(400).json({ error: 'Поле data обязательно' });
    if (!ALLOWED_KATEGORIY.includes(kategoriya))
      return res.status(400).json({ error: 'Недопустимая категория' });
    if (summa === undefined || isNaN(Number(summa)) || Number(summa) <= 0)
      return res.status(400).json({ error: 'Сумма должна быть числом > 0' });
    if (!ts_id && !podrazdelenie_id)
      return res.status(400).json({ error: 'Укажите ts_id или podrazdelenie_id' });

    const [rows] = await pool.execute(
      `INSERT INTO prochiy_raskhod (ts_id, podrazdelenie_id, data, kategoriya, summa, opisanie)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [ts_id || null, podrazdelenie_id || null, data, kategoriya, Number(summa), opisanie || null]
    );

    // лог
    await pool.execute(
      `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
       VALUES (?, 'DOBAVLEN_RASKHOD', 'prochiy_raskhod', ?, ?, ?)`,
      [req.user.id, rows[0].id, Number(summa),
       `Добавлен расход категории «${kategoriya}» (${rows[0].opisanie || 'без описания'})`]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[expenses] POST error:', e);
    res.status(500).json({ error: 'Ошибка добавления расхода' });
  }
});

/* ----------------------------------------------------------------- */
/*  PUT /api/finance/expenses/:id                                    */
/*    редактирует запись prochiy_raskhod (только этот источник)      */
/* ----------------------------------------------------------------- */
router.put('/:id', authRequired, requireFinanceWrite, [
  v.id,
  body('data').optional().isISO8601().withMessage('Некорректная дата'),
  body('kategoriya').optional().trim().isIn(ALLOWED_KATEGORIY).withMessage('Недопустимая категория'),
  body('summa').optional().isFloat({ min: 0 }).withMessage('Сумма должна быть числом ≥ 0'),
  body('ts_id').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Некорректный id ТС'),
  body('podrazdelenie_id').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Некорректный id подразделения'),
  body('opisanie').optional().trim().isLength({ max: 2000 }).withMessage('Описание слишком длинное'),
  handleResult,
], async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    const { data, kategoriya, summa, opisanie, podrazdelenie_id, ts_id } = req.body;

    if (kategoriya !== undefined && !ALLOWED_KATEGORIY.includes(kategoriya))
      return res.status(400).json({ error: 'Недопустимая категория' });
    if (summa !== undefined && (isNaN(Number(summa)) || Number(summa) <= 0))
      return res.status(400).json({ error: 'Сумма должна быть числом > 0' });

    const sets = [];
    const params = [];
    if (data !== undefined)              { params.push(data);                 sets.push(`data = ?`); }
    if (kategoriya !== undefined)        { params.push(kategoriya);           sets.push(`kategoriya = ?`); }
    if (summa !== undefined)             { params.push(Number(summa));        sets.push(`summa = ?`); }
    if (opisanie !== undefined)          { params.push(opisanie || null);     sets.push(`opisanie = ?`); }
    if (podrazdelenie_id !== undefined)  { params.push(podrazdelenie_id || null); sets.push(`podrazdelenie_id = ?`); }
    if (ts_id !== undefined)             { params.push(ts_id || null);        sets.push(`ts_id = ?`); }

    if (!sets.length) return res.status(400).json({ error: 'Нет изменений' });

    params.push(id);
    const [rows] = await pool.execute(
      `UPDATE prochiy_raskhod SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Расход не найден' });

    await pool.execute(
      `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
       VALUES (?, 'IZMENEN_RASKHOD', 'prochiy_raskhod', ?, ?, ?)`,
      [req.user.id, id, Number(rows[0].summa),
       `Изменён расход категории «${rows[0].kategoriya}»`]
    );

    res.json(rows[0]);
  } catch (e) {
    console.error('[expenses] PUT error:', e);
    res.status(500).json({ error: 'Ошибка обновления расхода' });
  }
});

/* ----------------------------------------------------------------- */
/*  POST /api/finance/expenses/import-csv                            */
/*    Массовый импорт расходов из CSV.                               */
/*    Заголовки (любой регистр, разделитель ; или ,):                */
/*      data, kategoriya, summa, gos_nomer?, podrazdelenie?, opisanie? */
/*                                                                   */
/*    Если указан gos_nomer — ищем ТС, иначе если podrazdelenie —   */
/*    ищем подразделение по названию.                                */
/*    Возвращает { inserted, skipped, errors: [{row, reason}] }     */
/* ----------------------------------------------------------------- */
router.post('/import-csv', authRequired, requireFinanceWrite, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен (поле file)' });

    const text = req.file.buffer.toString('utf8');
    let records;
    try {
      records = parse(text, {
        columns: header => header.map(h => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        delimiter: text.includes(';') && !text.split('\n')[0].includes(',') ? ';' : [',', ';'],
        relax_column_count: true,
      });
    } catch (parseErr) {
      return res.status(400).json({ error: 'Ошибка разбора CSV: ' + parseErr.message });
    }

    if (!records.length) return res.status(400).json({ error: 'CSV пустой' });

    // Подгружаем словари
    const [tsList] = await pool.execute('SELECT id, gos_nomer, podrazdelenie_id FROM transportnoe_sredstvo');
    const tsByPlate = new Map(tsList.map(t => [t.gos_nomer.toLowerCase().replace(/\s+/g, ''), t]));
    const [pdList] = await pool.execute('SELECT id, nazvanie FROM podrazdelenie');
    const pdByName = new Map(pdList.map(p => [p.nazvanie.toLowerCase(), p]));

    const errors = [];
    let inserted = 0;

    await pool.transaction(async (tx) => {
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + 2; // +1 заголовок, +1 чтобы с 1
        const data = row.data || row['дата'] || row['date'];
        const kategoriya = (row.kategoriya || row['категория'] || row['category'] || '').trim();
        const summaRaw = (row.summa || row['сумма'] || row['amount'] || '').toString().replace(',', '.').replace(/\s/g, '');
        const summa = Number(summaRaw);
        const plate = (row.gos_nomer || row['гос_номер'] || row['номер'] || '').toString().toLowerCase().replace(/\s+/g, '');
        const pdName = (row.podrazdelenie || row['подразделение'] || row['division'] || '').toString().toLowerCase().trim();
        const opisanie = row.opisanie || row['описание'] || row['description'] || null;

        if (!data) { errors.push({ row: rowNum, reason: 'Нет даты' }); continue; }
        if (!ALLOWED_KATEGORIY.includes(kategoriya)) {
          errors.push({ row: rowNum, reason: `Недопустимая категория «${kategoriya}»` });
          continue;
        }
        if (!Number.isFinite(summa) || summa <= 0) {
          errors.push({ row: rowNum, reason: `Некорректная сумма «${summaRaw}»` });
          continue;
        }

        let ts_id = null, podrazdelenie_id = null;
        if (plate) {
          const ts = tsByPlate.get(plate);
          if (!ts) { errors.push({ row: rowNum, reason: `Гос.номер «${plate}» не найден` }); continue; }
          ts_id = ts.id;
          podrazdelenie_id = ts.podrazdelenie_id;
        } else if (pdName) {
          const pd = pdByName.get(pdName);
          if (!pd) { errors.push({ row: rowNum, reason: `Подразделение «${pdName}» не найдено` }); continue; }
          podrazdelenie_id = pd.id;
        } else {
          errors.push({ row: rowNum, reason: 'Не указан ни gos_nomer, ни podrazdelenie' });
          continue;
        }

        try {
          await tx.execute(
            `INSERT INTO prochiy_raskhod (ts_id, podrazdelenie_id, data, kategoriya, summa, opisanie)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ts_id, podrazdelenie_id, data, kategoriya, summa, opisanie]
          );
          inserted++;
        } catch (insErr) {
          errors.push({ row: rowNum, reason: 'SQL: ' + insErr.message });
        }
      }

      await tx.execute(
        `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, summa, kommentariy)
         VALUES (?, 'IMPORT_CSV', 'prochiy_raskhod', NULL, ?)`,
        [req.user.id, `CSV-импорт расходов: добавлено ${inserted}, пропущено ${errors.length}`]
      );
    });

    res.json({ ok: true, inserted, skipped: errors.length, errors: errors.slice(0, 50) });
  } catch (e) {
    console.error('[expenses] import-csv error:', e);
    res.status(500).json({ error: 'Ошибка импорта CSV: ' + e.message });
  }
});

/* ----------------------------------------------------------------- */
/*  DELETE /api/finance/expenses/:id                                 */
/* ----------------------------------------------------------------- */
router.delete('/:id', authRequired, requireFinanceWrite, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    const [existing] = await pool.execute(
      'SELECT id, summa, kategoriya FROM prochiy_raskhod WHERE id = ?',
      [id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Не найдено' });

    await pool.execute('DELETE FROM prochiy_raskhod WHERE id = ?', [id]);

    await pool.execute(
      `INSERT INTO finansoviy_log (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
       VALUES (?, 'UDALEN_RASKHOD', 'prochiy_raskhod', ?, ?, ?)`,
      [req.user.id, id, Number(existing[0].summa),
       `Удалён расход категории «${existing[0].kategoriya}»`]
    );

    res.json({ ok: true, deleted_id: id });
  } catch (e) {
    console.error('[expenses] DELETE error:', e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
