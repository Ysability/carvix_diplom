/**
 * Carvix — отчёты и KPI-дашборд.
 *
 *   GET /api/finance/reports/tco             TCO по всем машинам
 *   GET /api/finance/reports/tco/:tsId       детальный TCO + ремонты + прочее
 *   GET /api/finance/reports/dashboard       KPI для дашборда руководителя
 */

const express = require('express');
const pool = require('../../db');
const { authRequired } = require('../../middleware/auth');
const { requireFinanceRead } = require('../../middleware/rbac');
const { autoForecast } = require('../../services/forecast');

const router = express.Router();

/* ----------------------------------------------------------------- */
/*  GET /reports/tco                                                 */
/* ----------------------------------------------------------------- */
router.get('/tco', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const { podrazdelenie_id, sort = 'tco_desc', limit = 100 } = req.query;

    const where = [];
    const params = [];
    if (podrazdelenie_id) {
      params.push(podrazdelenie_id);
      where.push(`v.podrazdelenie_nazvanie = (SELECT nazvanie FROM podrazdelenie WHERE id = $${params.length})`);
    }

    const orderMap = {
      tco_desc:    'tco_obshchee DESC',
      tco_asc:     'tco_obshchee ASC',
      remontov:    'kolvo_remontov DESC',
      gos_nomer:   'gos_nomer ASC',
    };
    const orderBy = orderMap[sort] || orderMap.tco_desc;
    const lim = Math.min(parseInt(limit, 10) || 100, 500);

    const sql = `
      SELECT
        v.ts_id, v.gos_nomer, v.invent_nomer,
        v.marka_nazvanie, v.model_nazvanie,
        v.podrazdelenie_nazvanie,
        v.kolvo_zayavok, v.kolvo_remontov,
        v.itogo_rabot, v.itogo_zapchastey, v.itogo_prochee,
        v.tco_obshchee
      FROM v_tco_ts v
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${orderBy}
      LIMIT ${lim}
    `;
    const r = await pool.pool.query(sql, params);

    const totals = r.rows.reduce(
      (acc, row) => ({
        tco:        acc.tco        + Number(row.tco_obshchee),
        rabot:      acc.rabot      + Number(row.itogo_rabot),
        zapchastey: acc.zapchastey + Number(row.itogo_zapchastey),
        prochee:    acc.prochee    + Number(row.itogo_prochee),
      }),
      { tco: 0, rabot: 0, zapchastey: 0, prochee: 0 }
    );

    res.json({ items: r.rows, totals });
  } catch (e) {
    console.error('[reports/tco] error:', e);
    res.status(500).json({ error: 'Ошибка отчёта TCO' });
  }
});

/* ----------------------------------------------------------------- */
/*  GET /reports/tco/:tsId — детальный отчёт                         */
/* ----------------------------------------------------------------- */
router.get('/tco/:tsId', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const tsId = parseInt(req.params.tsId, 10);
    if (!tsId) return res.status(400).json({ error: 'Неверный tsId' });

    const [summary] = await pool.execute(
      `SELECT * FROM v_tco_ts WHERE ts_id = ?`,
      [tsId]
    );
    if (!summary.length) return res.status(404).json({ error: 'ТС не найдено' });

    const [remonty] = await pool.execute(
      `SELECT r.id, r.zayavka_id, r.data_nachala, r.data_okonchaniya,
              r.stoimost_rabot, r.stoimost_zapchastey,
              (r.stoimost_rabot + r.stoimost_zapchastey) AS itogo,
              tr.nazvanie AS tip_remonta, tr.kategoriya,
              s.fio AS mekhanik
         FROM remont r
         JOIN zayavka z      ON z.id = r.zayavka_id
         JOIN tip_remonta tr ON tr.id = z.tip_remonta_id
         LEFT JOIN sotrudnik s ON s.id = r.mekhanik_id
        WHERE z.ts_id = ?
        ORDER BY r.data_nachala DESC NULLS LAST`,
      [tsId]
    );

    const [prochee] = await pool.execute(
      `SELECT id, data, kategoriya, summa, opisanie
         FROM prochiy_raskhod
        WHERE ts_id = ?
        ORDER BY data DESC`,
      [tsId]
    );

    res.json({
      summary: summary[0],
      remonty,
      prochiy_raskhod: prochee,
    });
  } catch (e) {
    console.error('[reports/tco/:id] error:', e);
    res.status(500).json({ error: 'Ошибка детального TCO' });
  }
});

/* ----------------------------------------------------------------- */
/*  GET /reports/dashboard                                           */
/* ----------------------------------------------------------------- */
router.get('/dashboard', authRequired, requireFinanceRead, async (req, res) => {
  try {
    // Период по умолчанию — последние 12 месяцев. Можно фильтровать через ?god=
    const god = parseInt(req.query.god, 10) || new Date().getFullYear();

    const queries = await Promise.all([
      // 1. Расходы по месяцам (динамика за год)
      pool.pool.query(
        `SELECT mesyats,
                SUM(CASE WHEN kategoriya='remont'    THEN fakt_summa ELSE 0 END) AS remont,
                SUM(CASE WHEN kategoriya='zapchasti' THEN fakt_summa ELSE 0 END) AS zapchasti,
                SUM(CASE WHEN kategoriya='topliv'    THEN fakt_summa ELSE 0 END) AS topliv,
                SUM(CASE WHEN kategoriya NOT IN ('remont','zapchasti','topliv')
                         THEN fakt_summa ELSE 0 END)                              AS prochee,
                SUM(fakt_summa)                                                   AS total
           FROM v_fakt_po_podrazdeleniyu
          WHERE god = $1
          GROUP BY mesyats
          ORDER BY mesyats`,
        [god]
      ),

      // 2. Структура затрат за год (для pie/donut)
      pool.pool.query(
        `SELECT kategoriya, SUM(fakt_summa) AS summa
           FROM v_fakt_po_podrazdeleniyu
          WHERE god = $1
          GROUP BY kategoriya
          ORDER BY summa DESC`,
        [god]
      ),

      // 3. Топ-5 машин по TCO
      pool.pool.query(
        `SELECT ts_id, gos_nomer, marka_nazvanie, model_nazvanie,
                podrazdelenie_nazvanie, tco_obshchee, kolvo_remontov
           FROM v_tco_ts
          ORDER BY tco_obshchee DESC
          LIMIT 5`
      ),

      // 4. Сводный план/факт за год (по всем месяцам и категориям)
      pool.pool.query(
        `SELECT
           SUM(plan_summa)              AS plan,
           SUM(fakt_summa)              AS fakt,
           SUM(plan_summa - fakt_summa) AS otklonenie
         FROM v_byudzhet_plan_fakt
         WHERE god = $1`,
        [god]
      ),

      // 5. Доля плановых vs внеплановых ремонтов
      pool.pool.query(
        `SELECT tr.kategoriya AS tip, COUNT(*)::int AS kolvo,
                COALESCE(SUM(r.stoimost_rabot + r.stoimost_zapchastey), 0) AS summa
           FROM remont r
           JOIN zayavka z      ON z.id = r.zayavka_id
           JOIN tip_remonta tr ON tr.id = z.tip_remonta_id
          WHERE EXTRACT(YEAR FROM r.data_okonchaniya) = $1
          GROUP BY tr.kategoriya`,
        [god]
      ),

      // 6. Расходы за текущий и предыдущий месяц (для KPI-карточек)
      pool.pool.query(
        `SELECT
           SUM(CASE WHEN god=$1 AND mesyats=$2     THEN fakt_summa ELSE 0 END) AS tek_mesyats,
           SUM(CASE WHEN god=$1 AND mesyats=$2 - 1 THEN fakt_summa ELSE 0 END) AS pred_mesyats
         FROM v_fakt_po_podrazdeleniyu
         WHERE god=$1`,
        [god, new Date().getMonth() + 1]
      ),
    ]);

    const [dyn, struct, topTs, planFakt, planVneplan, kpi] = queries;

    // Заполняем все 12 месяцев нулями где данных нет
    const dynamics = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const row = dyn.rows.find((r) => r.mesyats === m);
      return row || {
        mesyats: m, remont: '0', zapchasti: '0', topliv: '0', prochee: '0', total: '0',
      };
    });

    const tek = Number(kpi.rows[0]?.tek_mesyats || 0);
    const pred = Number(kpi.rows[0]?.pred_mesyats || 0);
    const delta_pct = pred ? Math.round(((tek - pred) / pred) * 1000) / 10 : null;

    res.json({
      god,
      kpi: {
        tek_mesyats: tek,
        pred_mesyats: pred,
        delta_pct,
        plan_god: Number(planFakt.rows[0]?.plan || 0),
        fakt_god: Number(planFakt.rows[0]?.fakt || 0),
        otklonenie_god: Number(planFakt.rows[0]?.otklonenie || 0),
      },
      dynamics,
      struktura: struct.rows.map((r) => ({
        kategoriya: r.kategoriya,
        summa: Number(r.summa),
      })),
      top_ts: topTs.rows.map((r) => ({
        ts_id: r.ts_id,
        gos_nomer: r.gos_nomer,
        marka: r.marka_nazvanie,
        model: r.model_nazvanie,
        podrazdelenie: r.podrazdelenie_nazvanie,
        tco: Number(r.tco_obshchee),
        kolvo_remontov: r.kolvo_remontov,
      })),
      plan_vs_vneplan: planVneplan.rows.map((r) => ({
        tip: r.tip,
        kolvo: r.kolvo,
        summa: Number(r.summa),
      })),
    });
  } catch (e) {
    console.error('[reports/dashboard] error:', e);
    res.status(500).json({ error: 'Ошибка дашборда' });
  }
});

/* ----------------------------------------------------------------- */
/*  GET /reports/analyst-dashboard                                   */
/*  Расширенная аналитика: загрузка механиков, средний срок ремонта, */
/*  тренды по подразделениям, статистика по типам ремонта.           */
/* ----------------------------------------------------------------- */
router.get('/analyst-dashboard', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const god = parseInt(req.query.god, 10) || new Date().getFullYear();

    const queries = await Promise.all([
      // 1. Загрузка механиков: активные + за 30 дней
      pool.pool.query(
        `SELECT s.id, s.fio, pd.nazvanie AS podrazdelenie,
                CAST(COALESCE(SUM(CASE WHEN r.data_okonchaniya IS NULL THEN 1 ELSE 0 END), 0) AS INT) AS aktivnyh,
                CAST(COALESCE(SUM(CASE WHEN r.data_okonchaniya >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END), 0) AS INT) AS za_30_dney,
                CAST(COUNT(r.id) AS INT) AS vsego
           FROM sotrudnik s
           JOIN rol rl          ON rl.id = s.rol_id
           JOIN podrazdelenie pd ON pd.id = s.podrazdelenie_id
           LEFT JOIN remont r   ON r.mekhanik_id = s.id
          WHERE rl.nazvanie = 'Механик'
          GROUP BY s.id, s.fio, pd.nazvanie
          ORDER BY aktivnyh DESC, s.fio`
      ),

      // 2. Средний срок ремонта (дней) по месяцам за год
      pool.pool.query(
        `SELECT EXTRACT(MONTH FROM r.data_okonchaniya)::int AS mesyats,
                ROUND(AVG(EXTRACT(EPOCH FROM (r.data_okonchaniya - r.data_nachala)) / 86400), 1) AS avg_days,
                COUNT(*)::int AS kolvo
           FROM remont r
          WHERE r.data_okonchaniya IS NOT NULL
            AND r.data_nachala IS NOT NULL
            AND EXTRACT(YEAR FROM r.data_okonchaniya) = $1
          GROUP BY mesyats
          ORDER BY mesyats`,
        [god]
      ),

      // 3. Расходы по подразделениям за год (тренд)
      pool.pool.query(
        `SELECT pd.nazvanie AS podrazdelenie,
                EXTRACT(MONTH FROM pr.data)::int AS mesyats,
                COALESCE(SUM(pr.summa), 0) AS summa
           FROM prochiy_raskhod pr
           JOIN transportnoe_sredstvo ts ON ts.id = pr.ts_id
           JOIN podrazdelenie pd ON pd.id = ts.podrazdelenie_id
          WHERE EXTRACT(YEAR FROM pr.data) = $1
          GROUP BY pd.nazvanie, mesyats
          ORDER BY pd.nazvanie, mesyats`,
        [god]
      ),

      // 4. Статистика по типам ремонта за год
      pool.pool.query(
        `SELECT tr.nazvanie AS tip, tr.kategoriya,
                COUNT(*)::int AS kolvo,
                COALESCE(SUM(r.stoimost_rabot + r.stoimost_zapchastey), 0) AS summa,
                ROUND(AVG(CASE WHEN r.data_nachala IS NOT NULL AND r.data_okonchaniya IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (r.data_okonchaniya - r.data_nachala)) / 86400 END), 1) AS avg_days
           FROM remont r
           JOIN zayavka z      ON z.id = r.zayavka_id
           JOIN tip_remonta tr ON tr.id = z.tip_remonta_id
          WHERE EXTRACT(YEAR FROM COALESCE(r.data_okonchaniya, r.data_nachala, NOW())) = $1
          GROUP BY tr.nazvanie, tr.kategoriya
          ORDER BY summa DESC`,
        [god]
      ),

      // 5. Заявки по статусам (общая сводка)
      pool.pool.query(
        `SELECT st.nazvanie AS status, COUNT(*)::int AS kolvo
           FROM zayavka z
           JOIN status st ON st.id = z.status_id
          GROUP BY st.nazvanie
          ORDER BY kolvo DESC`
      ),

      // 6. Динамика ремонтов: стоимость завершённых по месяцам + количество
      pool.pool.query(
        `SELECT EXTRACT(MONTH FROM r.data_okonchaniya)::int AS mesyats,
                COALESCE(SUM(r.stoimost_rabot), 0) AS rabot,
                COALESCE(SUM(r.stoimost_zapchastey), 0) AS zapchastey,
                COUNT(*)::int AS kolvo
           FROM remont r
          WHERE r.data_okonchaniya IS NOT NULL
            AND EXTRACT(YEAR FROM r.data_okonchaniya) = $1
          GROUP BY mesyats
          ORDER BY mesyats`,
        [god]
      ),
    ]);

    const [mekh, avgRepair, divTrends, tipStats, statusStats, repairDyn] = queries;

    res.json({
      god,
      mekhaniki: mekh.rows,
      avg_repair_by_month: avgRepair.rows,
      division_trends: divTrends.rows,
      tip_stats: tipStats.rows,
      status_summary: statusStats.rows,
      repair_dynamics: repairDyn.rows,
    });
  } catch (e) {
    console.error('[reports/analyst-dashboard] error:', e);
    res.status(500).json({ error: 'Ошибка аналитического дашборда' });
  }
});

/* ----------------------------------------------------------------- */
/*  GET /reports/forecast                                            */
/*                                                                   */
/*    Прогноз расходов на N месяцев вперёд по методу Holt-Winters    */
/*    (тройное экспоненциальное сглаживание с сезонностью).          */
/*                                                                   */
/*    Параметры:                                                     */
/*      • horizon=12              — на сколько месяцев предсказать;  */
/*      • kategoriya=topliv       — фильтр по категории расходов;    */
/*      • podrazdelenie_id=1      — фильтр по подразделению;         */
/*      • years_back=3            — глубина истории (по умолч. 3 года). */
/*                                                                   */
/*    Возвращает:                                                    */
/*      {                                                            */
/*        history: [{ god, mesyats, summa }],                        */
/*        forecast: [{ year, mesyats, point, lower, upper }],        */
/*        method: 'holt-winters' | 'linear-trend' | 'mean',          */
/*        rmse, level, trend                                         */
/*      }                                                            */
/* ----------------------------------------------------------------- */
router.get('/forecast', authRequired, requireFinanceRead, async (req, res) => {
  try {
    const horizon         = Math.max(1, Math.min(24, parseInt(req.query.horizon, 10) || 12));
    const yearsBack       = Math.max(1, Math.min(10, parseInt(req.query.years_back, 10) || 3));
    const kategoriya      = (req.query.kategoriya || '').trim();
    const podrazdelenieId = parseInt(req.query.podrazdelenie_id, 10) || null;

    const minGod = new Date().getFullYear() - yearsBack;

    const where = ['v.god >= $1'];
    const params = [minGod];
    if (kategoriya) {
      params.push(kategoriya);
      where.push(`v.kategoriya = $${params.length}`);
    }
    if (podrazdelenieId) {
      params.push(podrazdelenieId);
      where.push(`v.podrazdelenie_id = $${params.length}`);
    }

    const sql = `
      SELECT v.god, v.mesyats, COALESCE(SUM(v.fakt_summa), 0)::numeric AS summa
        FROM v_fakt_po_podrazdeleniyu v
       WHERE ${where.join(' AND ')}
       GROUP BY v.god, v.mesyats
       ORDER BY v.god ASC, v.mesyats ASC
    `;
    const r = await pool.pool.query(sql, params);

    // Достраиваем нулями пропущенные месяцы, чтобы серия была равномерной
    const series = buildContinuousSeries(r.rows, minGod);

    if (series.points.length === 0) {
      return res.json({
        history: [], forecast: [], method: 'no-data',
        rmse: 0, level: 0, trend: 0,
        params: { horizon, kategoriya, podrazdelenie_id: podrazdelenieId, years_back: yearsBack },
      });
    }

    const y = series.points.map((p) => Number(p.summa));
    const result = autoForecast(y, { horizon });

    // Прикладываем (god, mesyats) к точкам прогноза
    const lastPoint = series.points[series.points.length - 1];
    const forecastDated = result.forecast.map((f, i) => {
      const m0 = lastPoint.mesyats + f.step;
      const yearsAdd = Math.floor((m0 - 1) / 12);
      const month = ((m0 - 1) % 12) + 1;
      return {
        ...f,
        god: lastPoint.god + yearsAdd,
        mesyats: month,
      };
    });

    res.json({
      history: series.points,
      forecast: forecastDated,
      method: result.method,
      rmse:  result.rmse  ?? null,
      level: result.level ?? null,
      trend: result.trend ?? null,
      params: { horizon, kategoriya, podrazdelenie_id: podrazdelenieId, years_back: yearsBack },
    });
  } catch (e) {
    console.error('[reports/forecast] error:', e);
    res.status(500).json({ error: 'Ошибка прогноза: ' + e.message });
  }
});

/**
 * Превращает разреженный набор {god, mesyats, summa} в непрерывную серию
 * месяцев от первого месяца с данными до текущего, заполняя пропуски нулями.
 */
function buildContinuousSeries(rows, minGod) {
  if (!rows.length) return { points: [] };

  const map = new Map();
  for (const r of rows) {
    const key = `${r.god}-${r.mesyats}`;
    map.set(key, Number(r.summa));
  }

  // Берём от самой ранней (god, mesyats) с данными до самой поздней
  const sorted = rows.slice().sort((a, b) => a.god - b.god || a.mesyats - b.mesyats);
  const first = sorted[0];
  const last  = sorted[sorted.length - 1];

  const points = [];
  let g = first.god, m = first.mesyats;
  while (g < last.god || (g === last.god && m <= last.mesyats)) {
    points.push({
      god: g,
      mesyats: m,
      summa: map.get(`${g}-${m}`) ?? 0,
    });
    m++;
    if (m > 12) { m = 1; g++; }
  }
  return { points };
}

module.exports = router;
