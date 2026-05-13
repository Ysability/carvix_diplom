/**
 * Carvix — API заявок на ремонт.
 *
 * Контракт ролей:
 *   • Пользователь — создаёт заявки (только на ТС своего подразделения),
 *                    видит только свои заявки.
 *   • Диспетчер    — видит все заявки, назначает механика, использует
 *                    режим «Автонаводка» (auto-assign), меняет статусы.
 *   • Механик      — видит только заявки, на которые он назначен
 *                    (через свой ремонт), стартует и закрывает ремонт.
 *   • Гл. механик / Директор / Аналитик — полный read-доступ.
 *
 * Все write-операции пишут запись в finansoviy_log (универсальный аудит).
 */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const {
  requireZayavkaCreate,
  requireDispetcher,
} = require('../middleware/rbac');

const router = express.Router();

// ──────────────────────────────────────────────────────────────────
// Хелперы
// ──────────────────────────────────────────────────────────────────

async function findStatusId(name) {
  const [rows] = await pool.execute(
    'SELECT id FROM status WHERE nazvanie = ? LIMIT 1',
    [name]
  );
  return rows[0]?.id || null;
}

async function logAction(tx, sotrudnikId, tipOp, obyektId, summa, kommentariy) {
  await tx.execute(
    `INSERT INTO finansoviy_log
       (sotrudnik_id, tip_operatsii, obyekt_tablitsa, obyekt_id, summa, kommentariy)
     VALUES (?, ?, 'zayavka', ?, ?, ?)`,
    [sotrudnikId, tipOp, obyektId, summa ?? null, kommentariy || null]
  );
}

// ──────────────────────────────────────────────────────────────────
// Справочники для форм
// ──────────────────────────────────────────────────────────────────

// GET /api/zayavki/dict/statusy
router.get('/dict/statusy', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nazvanie FROM status ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения статусов' });
  }
});

// GET /api/zayavki/dict/tipy-remonta
router.get('/dict/tipy-remonta', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nazvanie, kategoriya FROM tip_remonta ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения типов ремонта' });
  }
});

// GET /api/zayavki/dict/ts — список ТС, доступных пользователю.
// Пользователь — только своё подразделение, остальные — все.
router.get('/dict/ts', authRequired, async (req, res) => {
  try {
    const role = req.user.rol_nazvanie;
    const params = [];
    let where = '';
    if (role === 'Пользователь') {
      where = 'WHERE ts.podrazdelenie_id = ?';
      params.push(req.user.podrazdelenie_id);
    }
    const [rows] = await pool.execute(
      `SELECT ts.id, ts.gos_nomer, ts.invent_nomer, ts.tekuschee_sostoyanie,
              ma.nazvanie AS marka, mo.nazvanie AS model,
              pd.nazvanie AS podrazdelenie
         FROM transportnoe_sredstvo ts
         JOIN model         mo ON mo.id = ts.model_id
         JOIN marka         ma ON ma.id = mo.marka_id
         JOIN podrazdelenie pd ON pd.id = ts.podrazdelenie_id
         ${where}
         ORDER BY ts.gos_nomer`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения списка ТС' });
  }
});

// GET /api/zayavki/dispetcher/mekhaniki
// Список механиков с метрикой загрузки. Используется в форме назначения
// и в кнопке «Автонаводка».
router.get(
  '/dispetcher/mekhaniki',
  authRequired,
  requireDispetcher,
  async (req, res) => {
    try {
      const podrazdelenieId = req.query.podrazdelenie_id
        ? Number(req.query.podrazdelenie_id)
        : null;

      const params = [];
      let podrFilter = '';
      if (podrazdelenieId) {
        podrFilter = 'AND s.podrazdelenie_id = ?';
        params.push(podrazdelenieId);
      }

      // Активная нагрузка = открытые ремонты (data_okonchaniya IS NULL)
      const [rows] = await pool.execute(
        `SELECT s.id, s.fio, s.podrazdelenie_id,
                pd.nazvanie AS podrazdelenie,
                COALESCE(load.aktivnyh, 0)::INT AS aktivnyh_remontov,
                COALESCE(load.za_30_dney, 0)::INT AS remontov_za_30_dney
           FROM sotrudnik s
           JOIN rol r           ON r.id  = s.rol_id
           JOIN podrazdelenie pd ON pd.id = s.podrazdelenie_id
           LEFT JOIN (
             SELECT mekhanik_id,
                    SUM(CASE WHEN data_okonchaniya IS NULL THEN 1 ELSE 0 END) AS aktivnyh,
                    SUM(CASE WHEN data_okonchaniya >= NOW() - INTERVAL '30 days'
                             THEN 1 ELSE 0 END) AS za_30_dney
               FROM remont
              GROUP BY mekhanik_id
           ) load ON load.mekhanik_id = s.id
          WHERE r.nazvanie = 'Механик' ${podrFilter}
          ORDER BY aktivnyh_remontov ASC, remontov_za_30_dney ASC, s.fio`,
        params
      );
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка получения списка механиков' });
    }
  }
);

// ──────────────────────────────────────────────────────────────────
// Список и детали
// ──────────────────────────────────────────────────────────────────

/**
 * GET /api/zayavki
 *
 * Фильтры:
 *   ?status=<id>            — фильтр по статусу
 *   ?ts_id=<id>             — фильтр по ТС
 *   ?podrazdelenie_id=<id>  — фильтр по подразделению ТС
 *   ?mine=1                 — только заявки, в которых я создатель
 *                             ИЛИ механик (для механика — назначенные)
 *   ?limit=<n>              — лимит (по умолчанию 100, максимум 500)
 *
 * Видимость по ролям:
 *   • Пользователь — всегда mine=1 (force).
 *   • Механик      — всегда mine=1 (force, через назначенный ремонт).
 *   • Все остальные — без принудительной фильтрации.
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const role = req.user.rol_nazvanie;
    const userId = req.user.id;

    // Принудительная фильтрация по ролям-владельцам
    const forceMine =
      role === 'Пользователь' || role === 'Механик';

    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const where = [];
    const params = [];

    if (req.query.status) {
      where.push('z.status_id = ?');
      params.push(Number(req.query.status));
    }
    if (req.query.ts_id) {
      where.push('z.ts_id = ?');
      params.push(Number(req.query.ts_id));
    }
    if (req.query.podrazdelenie_id) {
      where.push('ts.podrazdelenie_id = ?');
      params.push(Number(req.query.podrazdelenie_id));
    }

    if (forceMine || req.query.mine === '1') {
      if (role === 'Механик') {
        // Заявки, на которых назначен я через ремонт
        where.push(
          'EXISTS (SELECT 1 FROM remont r2 WHERE r2.zayavka_id = z.id AND r2.mekhanik_id = ?)'
        );
        params.push(userId);
      } else {
        // Заявки, которые создал я
        where.push('z.sozdatel_id = ?');
        params.push(userId);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT z.id, z.data_sozdaniya, z.opisanie, z.prioritet, z.data_rezhima,
              z.status_id, st.nazvanie AS status,
              z.tip_remonta_id, tr.nazvanie AS tip_remonta,
              z.ts_id, ts.gos_nomer, ts.invent_nomer,
              ma.nazvanie AS marka, mo.nazvanie AS model,
              ts.podrazdelenie_id, pd.nazvanie AS podrazdelenie,
              z.sozdatel_id, s.fio AS sozdatel_fio,
              r.id AS remont_id,
              r.mekhanik_id,
              ms.fio AS mekhanik_fio,
              r.data_nachala, r.data_okonchaniya
         FROM zayavka z
         JOIN status              st ON st.id = z.status_id
         JOIN tip_remonta         tr ON tr.id = z.tip_remonta_id
         JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
         JOIN model               mo ON mo.id = ts.model_id
         JOIN marka               ma ON ma.id = mo.marka_id
         JOIN podrazdelenie       pd ON pd.id = ts.podrazdelenie_id
         JOIN sotrudnik           s  ON s.id = z.sozdatel_id
         LEFT JOIN remont         r  ON r.zayavka_id = z.id
         LEFT JOIN sotrudnik      ms ON ms.id = r.mekhanik_id
         ${whereSql}
         ORDER BY z.data_sozdaniya DESC, z.id DESC
         LIMIT ${limit}`,
      params
    );

    res.json({ items: rows, total: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения заявок' });
  }
});

// GET /api/zayavki/:id — детали заявки + ремонт + использованные запчасти
router.get('/:id', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Некорректный id' });
    }

    const [rows] = await pool.execute(
      `SELECT z.id, z.data_sozdaniya, z.opisanie, z.prioritet, z.data_rezhima,
              z.status_id, st.nazvanie AS status,
              z.tip_remonta_id, tr.nazvanie AS tip_remonta,
              z.ts_id, ts.gos_nomer, ts.invent_nomer,
              ma.nazvanie AS marka, mo.nazvanie AS model,
              ts.podrazdelenie_id, pd.nazvanie AS podrazdelenie,
              z.sozdatel_id, s.fio AS sozdatel_fio,
              r.id AS remont_id,
              r.mekhanik_id, ms.fio AS mekhanik_fio,
              r.data_nachala, r.data_okonchaniya,
              r.stoimost_rabot, r.stoimost_zapchastey,
              r.kommentariy AS remont_kommentariy, r.itog
         FROM zayavka z
         JOIN status              st ON st.id = z.status_id
         JOIN tip_remonta         tr ON tr.id = z.tip_remonta_id
         JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
         JOIN model               mo ON mo.id = ts.model_id
         JOIN marka               ma ON ma.id = mo.marka_id
         JOIN podrazdelenie       pd ON pd.id = ts.podrazdelenie_id
         JOIN sotrudnik           s  ON s.id = z.sozdatel_id
         LEFT JOIN remont         r  ON r.zayavka_id = z.id
         LEFT JOIN sotrudnik      ms ON ms.id = r.mekhanik_id
        WHERE z.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' });

    const z = rows[0];

    // Доступ для Пользователя/Механика — только если он связан с заявкой
    const role = req.user.rol_nazvanie;
    if (role === 'Пользователь' && z.sozdatel_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    if (role === 'Механик' && z.mekhanik_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    res.json(z);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения заявки' });
  }
});

// ──────────────────────────────────────────────────────────────────
// Создание заявки (Пользователь / Диспетчер / Гл.мех / Директор)
// ──────────────────────────────────────────────────────────────────

router.post('/', authRequired, requireZayavkaCreate, async (req, res) => {
  try {
    const { ts_id, tip_remonta_id, opisanie, prioritet } = req.body || {};
    if (!ts_id || !tip_remonta_id) {
      return res
        .status(400)
        .json({ error: 'Укажите ТС и тип ремонта' });
    }
    const prio = prioritet ? Number(prioritet) : 3;
    if (!Number.isFinite(prio) || prio < 1 || prio > 5) {
      return res.status(400).json({ error: 'prioritet 1..5' });
    }

    // Пользователь может создавать заявки только на ТС своего подразделения
    if (req.user.rol_nazvanie === 'Пользователь') {
      const [[ts]] = await pool.execute(
        'SELECT podrazdelenie_id FROM transportnoe_sredstvo WHERE id = ?',
        [Number(ts_id)]
      );
      if (!ts) return res.status(400).json({ error: 'ТС не найдено' });
      if (ts.podrazdelenie_id !== req.user.podrazdelenie_id) {
        return res
          .status(403)
          .json({ error: 'Можно создавать заявки только на ТС своего подразделения' });
      }
    }

    const novayaId = await findStatusId('Новая');
    if (!novayaId) {
      return res
        .status(500)
        .json({ error: 'Статус "Новая" отсутствует в справочнике' });
    }

    const id = await pool.transaction(async (tx) => {
      const [ins] = await tx.execute(
        `INSERT INTO zayavka
           (data_sozdaniya, sozdatel_id, ts_id, tip_remonta_id, opisanie,
            status_id, prioritet, data_rezhima)
         VALUES (NOW(), ?, ?, ?, ?, ?, ?, NULL)
         RETURNING id`,
        [
          req.user.id,
          Number(ts_id),
          Number(tip_remonta_id),
          opisanie || null,
          novayaId,
          prio,
        ]
      );
      const newId = ins[0].id;
      await logAction(tx, req.user.id, 'create', newId, null, opisanie || null);
      return newId;
    });

    res.status(201).json({ id, status: 'Новая' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка создания заявки' });
  }
});

// ──────────────────────────────────────────────────────────────────
// Назначение механика (вручную)
// ──────────────────────────────────────────────────────────────────

router.patch(
  '/:id/assign',
  authRequired,
  requireDispetcher,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const mekhanikId = Number(req.body?.mekhanik_id);
      if (!Number.isFinite(id) || !Number.isFinite(mekhanikId)) {
        return res.status(400).json({ error: 'id и mekhanik_id обязательны' });
      }

      const result = await pool.transaction(async (tx) => {
        const [[z]] = await tx.execute(
          `SELECT z.id, z.status_id, st.nazvanie AS status
             FROM zayavka z
             JOIN status st ON st.id = z.status_id
            WHERE z.id = ?`,
          [id]
        );
        if (!z) return { code: 404, body: { error: 'Заявка не найдена' } };
        if (z.status === 'Выполнена' || z.status === 'Отклонена') {
          return {
            code: 400,
            body: { error: 'Нельзя назначать механика на завершённую заявку' },
          };
        }

        // Проверяем, что назначаемый — реально Механик
        const [[m]] = await tx.execute(
          `SELECT s.id, s.fio, r.nazvanie AS rol
             FROM sotrudnik s JOIN rol r ON r.id = s.rol_id
            WHERE s.id = ?`,
          [mekhanikId]
        );
        if (!m) return { code: 404, body: { error: 'Сотрудник не найден' } };
        if (m.rol !== 'Механик' && m.rol !== 'Главный механик') {
          return {
            code: 400,
            body: { error: 'Назначить можно только Механика или Главного механика' },
          };
        }

        // Главный механик в подразделении (если есть) — берём первого
        const [[gm]] = await tx.execute(
          `SELECT s.id FROM sotrudnik s
             JOIN rol r ON r.id = s.rol_id
            WHERE r.nazvanie = 'Главный механик'
            LIMIT 1`
        );

        // Если ремонт уже создан — обновляем механика, иначе создаём
        const [existing] = await tx.execute(
          'SELECT id FROM remont WHERE zayavka_id = ? LIMIT 1',
          [id]
        );
        let remontId;
        if (existing.length) {
          remontId = existing[0].id;
          await tx.execute(
            'UPDATE remont SET mekhanik_id = ? WHERE id = ?',
            [mekhanikId, remontId]
          );
        } else {
          const [r] = await tx.execute(
            `INSERT INTO remont
               (zayavka_id, mekhanik_id, glavniy_mekhanik_id,
                stoimost_rabot, stoimost_zapchastey)
             VALUES (?, ?, ?, 0, 0)
             RETURNING id`,
            [id, mekhanikId, gm?.id || null]
          );
          remontId = r[0].id;
        }

        // Статус → "В работе"
        const vRabote = await findStatusId('В работе');
        if (vRabote) {
          await tx.execute(
            'UPDATE zayavka SET status_id = ? WHERE id = ?',
            [vRabote, id]
          );
        }

        await logAction(
          tx,
          req.user.id,
          'assign',
          id,
          null,
          `Механик: ${m.fio} (id=${mekhanikId})`
        );

        return {
          code: 200,
          body: { id, remont_id: remontId, mekhanik_id: mekhanikId, status: 'В работе' },
        };
      });

      return res.status(result.code).json(result.body);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка назначения механика' });
    }
  }
);

// ──────────────────────────────────────────────────────────────────
// АВТОНАВОДКА — назначить наименее загруженного свободного механика
// ──────────────────────────────────────────────────────────────────

/**
 * POST /api/zayavki/:id/auto-assign
 *
 * Алгоритм:
 *   1. Берём подразделение ТС из заявки.
 *   2. Среди роли «Механик» приоритетно ищем тех, кто
 *      закреплён за тем же подразделением — это «локальные» механики.
 *      Если таких нет — расширяем поиск на всех механиков.
 *   3. Внутри пула сортируем по: aktivnyh_remontov ASC,
 *      remontov_za_30_dney ASC, fio ASC. Берём первого.
 *   4. Делегируем логику /assign.
 */
router.post(
  '/:id/auto-assign',
  authRequired,
  requireDispetcher,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Некорректный id заявки' });
      }

      const result = await pool.transaction(async (tx) => {
        // 1. Заявка + подразделение ТС
        const [[z]] = await tx.execute(
          `SELECT z.id, z.status_id, st.nazvanie AS status,
                  ts.podrazdelenie_id, pd.nazvanie AS podrazdelenie
             FROM zayavka z
             JOIN status              st ON st.id = z.status_id
             JOIN transportnoe_sredstvo ts ON ts.id = z.ts_id
             JOIN podrazdelenie       pd ON pd.id = ts.podrazdelenie_id
            WHERE z.id = ?`,
          [id]
        );
        if (!z) return { code: 404, body: { error: 'Заявка не найдена' } };
        if (z.status === 'Выполнена' || z.status === 'Отклонена') {
          return {
            code: 400,
            body: { error: 'Заявка завершена — автонаводка невозможна' },
          };
        }

        // 2. Кандидаты: сперва — механики из того же подразделения
        async function fetchCandidates(podrFilter, params) {
          const [rows] = await tx.execute(
            `SELECT s.id, s.fio, s.podrazdelenie_id,
                    pd.nazvanie AS podrazdelenie,
                    COALESCE(load.aktivnyh, 0)::INT      AS aktivnyh_remontov,
                    COALESCE(load.za_30_dney, 0)::INT    AS remontov_za_30_dney
               FROM sotrudnik s
               JOIN rol r            ON r.id  = s.rol_id
               JOIN podrazdelenie pd ON pd.id = s.podrazdelenie_id
               LEFT JOIN (
                 SELECT mekhanik_id,
                        SUM(CASE WHEN data_okonchaniya IS NULL THEN 1 ELSE 0 END) AS aktivnyh,
                        SUM(CASE WHEN data_okonchaniya >= NOW() - INTERVAL '30 days'
                                 THEN 1 ELSE 0 END) AS za_30_dney
                   FROM remont
                  GROUP BY mekhanik_id
               ) load ON load.mekhanik_id = s.id
              WHERE r.nazvanie = 'Механик' ${podrFilter}
              ORDER BY aktivnyh_remontov ASC,
                       remontov_za_30_dney ASC,
                       s.fio ASC
              LIMIT 1`,
            params
          );
          return rows[0] || null;
        }

        let kandidat = await fetchCandidates(
          'AND s.podrazdelenie_id = ?',
          [z.podrazdelenie_id]
        );
        let scope = 'local';
        if (!kandidat) {
          kandidat = await fetchCandidates('', []);
          scope = 'global';
        }
        if (!kandidat) {
          return {
            code: 409,
            body: { error: 'Нет ни одного механика в системе' },
          };
        }

        // 3. Назначаем
        const [[gm]] = await tx.execute(
          `SELECT id FROM sotrudnik s
             JOIN rol r ON r.id = s.rol_id
            WHERE r.nazvanie = 'Главный механик'
            LIMIT 1`
        );
        const [existing] = await tx.execute(
          'SELECT id FROM remont WHERE zayavka_id = ? LIMIT 1',
          [id]
        );
        let remontId;
        if (existing.length) {
          remontId = existing[0].id;
          await tx.execute(
            'UPDATE remont SET mekhanik_id = ? WHERE id = ?',
            [kandidat.id, remontId]
          );
        } else {
          const [r] = await tx.execute(
            `INSERT INTO remont (zayavka_id, mekhanik_id, glavniy_mekhanik_id,
                                 stoimost_rabot, stoimost_zapchastey)
             VALUES (?, ?, ?, 0, 0)
             RETURNING id`,
            [id, kandidat.id, gm?.id || null]
          );
          remontId = r[0].id;
        }

        const vRabote = await findStatusId('В работе');
        if (vRabote) {
          await tx.execute(
            'UPDATE zayavka SET status_id = ? WHERE id = ?',
            [vRabote, id]
          );
        }

        await logAction(
          tx,
          req.user.id,
          'auto-assign',
          id,
          null,
          `Авто: ${kandidat.fio} (нагрузка ${kandidat.aktivnyh_remontov}, ${scope})`
        );

        return {
          code: 200,
          body: {
            id,
            remont_id: remontId,
            mekhanik: {
              id: kandidat.id,
              fio: kandidat.fio,
              podrazdelenie: kandidat.podrazdelenie,
              aktivnyh_remontov: kandidat.aktivnyh_remontov,
              remontov_za_30_dney: kandidat.remontov_za_30_dney,
            },
            scope, // 'local' | 'global'
            status: 'В работе',
          },
        };
      });

      return res.status(result.code).json(result.body);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка автонаводки' });
    }
  }
);

// ──────────────────────────────────────────────────────────────────
// Смена статуса (отклонить / на согласовании / ожидание запчастей)
// ──────────────────────────────────────────────────────────────────

router.patch(
  '/:id/status',
  authRequired,
  requireDispetcher,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status_id = Number(req.body?.status_id);
      const kommentariy = req.body?.kommentariy || null;
      if (!Number.isFinite(id) || !Number.isFinite(status_id)) {
        return res.status(400).json({ error: 'id и status_id обязательны' });
      }

      const result = await pool.transaction(async (tx) => {
        const [[z]] = await tx.execute(
          'SELECT id FROM zayavka WHERE id = ?',
          [id]
        );
        if (!z) return { code: 404, body: { error: 'Заявка не найдена' } };

        const [[st]] = await tx.execute(
          'SELECT id, nazvanie FROM status WHERE id = ?',
          [status_id]
        );
        if (!st) return { code: 400, body: { error: 'Несуществующий статус' } };

        await tx.execute(
          'UPDATE zayavka SET status_id = ? WHERE id = ?',
          [status_id, id]
        );
        await logAction(
          tx,
          req.user.id,
          'status',
          id,
          null,
          `→ ${st.nazvanie}${kommentariy ? `: ${kommentariy}` : ''}`
        );
        return { code: 200, body: { id, status_id, status: st.nazvanie } };
      });

      return res.status(result.code).json(result.body);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка смены статуса' });
    }
  }
);

module.exports = router;
