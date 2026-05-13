/**
 * /api/transport — управление транспортными средствами.
 *
 * Доступно ВСЕМ авторизованным пользователям (включая Пользователя),
 * чтобы новый сотрудник мог самостоятельно завести своё ТС и сразу
 * создать на него заявку на ремонт.
 *
 * Эндпоинты:
 *   GET    /api/transport             — список ТС (с RBAC-фильтрацией по подразделению)
 *   GET    /api/transport/:id         — карточка одного ТС
 *   POST   /api/transport             — создать ТС (Пользователь — только в своё подразделение)
 *   PATCH  /api/transport/:id         — обновить ТС (probeg, состояние, и т.п.)
 *   DELETE /api/transport/:id         — удалить (только Директор/Гл. механик)
 *
 *   GET    /api/transport/dict/marki        — справочник марок
 *   GET    /api/transport/dict/modeli       — модели (опционально ?marka_id=)
 *   POST   /api/transport/dict/marki        — добавить марку (find-or-create)
 *   POST   /api/transport/dict/modeli       — добавить модель (find-or-create по marka_id+nazvanie)
 *   GET    /api/transport/dict/podrazdeleniya — подразделения (для селектов)
 *
 * RBAC:
 *   • Пользователь видит ТОЛЬКО ТС, которые он сам создал (sozdatel_id = req.user.id).
 *   • Механик видит все ТС (read-only) — нужно для контекста ремонтов.
 *   • Диспетчер/Главный механик/Директор/Аналитик — все ТС автопарка.
 *   • Удалять: Директор/Главный механик — любые; обычный пользователь — только свои.
 *   • Защита: нельзя удалить ТС, если на него уже есть заявки.
 */

const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

const ROLE_READ_ALL = ['Директор', 'Аналитик', 'Главный механик', 'Диспетчер', 'Механик'];
const ROLE_DELETE  = ['Директор', 'Главный механик'];

/* ---------- helpers ---------- */
function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v, max = 255) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s.slice(0, max);
}

async function audit(sotrudnikId, deystviye, obekt, obekt_id, summa = null, opisanie = null) {
  try {
    await pool.execute(
      `INSERT INTO finansoviy_log (sotrudnik_id, deystviye, obekt, obekt_id, summa, opisanie)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sotrudnikId, deystviye, obekt, obekt_id, summa, opisanie]
    );
  } catch (_) { /* аудит не должен ломать основной поток */ }
}

/* ---------------------------------------------------------------
   Справочники: марки, модели, подразделения
   --------------------------------------------------------------- */

router.get('/dict/marki', async (_req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, nazvanie FROM marka ORDER BY nazvanie'
  );
  res.json(rows);
});

router.get('/dict/modeli', async (req, res) => {
  const markaId = intOrNull(req.query.marka_id);
  let sql = `
    SELECT m.id, m.nazvanie, m.marka_id, mk.nazvanie AS marka
    FROM model m
    JOIN marka mk ON mk.id = m.marka_id
  `;
  const params = [];
  if (markaId) {
    sql += ' WHERE m.marka_id = ?';
    params.push(markaId);
  }
  sql += ' ORDER BY mk.nazvanie, m.nazvanie';
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
});

router.get('/dict/podrazdeleniya', async (_req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, nazvanie FROM podrazdelenie ORDER BY nazvanie'
  );
  res.json(rows);
});

router.post('/dict/marki', async (req, res) => {
  const nazvanie = strOrNull(req.body?.nazvanie);
  if (!nazvanie) return res.status(400).json({ error: 'nazvanie обязательно' });

  const [exist] = await pool.execute(
    'SELECT id, nazvanie FROM marka WHERE LOWER(nazvanie) = LOWER(?) LIMIT 1',
    [nazvanie]
  );
  if (exist.length) return res.json({ ...exist[0], created: false });

  const [ins] = await pool.execute(
    'INSERT INTO marka (nazvanie) VALUES (?) RETURNING id',
    [nazvanie]
  );
  res.status(201).json({ id: ins[0].id, nazvanie, created: true });
});

router.post('/dict/modeli', async (req, res) => {
  const marka_id = intOrNull(req.body?.marka_id);
  const nazvanie = strOrNull(req.body?.nazvanie);
  if (!marka_id || !nazvanie) {
    return res.status(400).json({ error: 'marka_id и nazvanie обязательны' });
  }

  const [m] = await pool.execute('SELECT id FROM marka WHERE id = ? LIMIT 1', [marka_id]);
  if (!m.length) return res.status(400).json({ error: 'Марка не найдена' });

  const [exist] = await pool.execute(
    'SELECT id, nazvanie, marka_id FROM model WHERE marka_id = ? AND LOWER(nazvanie) = LOWER(?) LIMIT 1',
    [marka_id, nazvanie]
  );
  if (exist.length) return res.json({ ...exist[0], created: false });

  const [ins] = await pool.execute(
    'INSERT INTO model (marka_id, nazvanie) VALUES (?, ?) RETURNING id',
    [marka_id, nazvanie]
  );
  res.status(201).json({ id: ins[0].id, marka_id, nazvanie, created: true });
});

/* ---------------------------------------------------------------
   GET /api/transport — список ТС
   --------------------------------------------------------------- */
router.get('/', async (req, res) => {
  const role = req.user.rol_nazvanie;
  const params = [];
  let where = '';

  // Пользователь — видит только то, что сам создал.
  if (!ROLE_READ_ALL.includes(role)) {
    where = 'WHERE ts.sozdatel_id = ?';
    params.push(req.user.id);
  }

  // Опциональный фильтр по подразделению (для админских ролей)
  const pd = intOrNull(req.query.podrazdelenie_id);
  if (pd && ROLE_READ_ALL.includes(role)) {
    where = where ? `${where} AND ts.podrazdelenie_id = ?` : 'WHERE ts.podrazdelenie_id = ?';
    params.push(pd);
  }

  const [rows] = await pool.execute(
    `
    SELECT
      ts.id,
      ts.gos_nomer,
      ts.invent_nomer,
      ts.probeg,
      ts.data_vypuska,
      ts.tekuschee_sostoyanie,
      ts.podrazdelenie_id,
      ts.sozdatel_id,
      pd.nazvanie AS podrazdelenie,
      m.id        AS model_id,
      m.nazvanie  AS model,
      mk.id       AS marka_id,
      mk.nazvanie AS marka,
      sz.fio      AS sozdatel_fio,
      (SELECT COUNT(*) FROM zayavka z WHERE z.ts_id = ts.id) AS kolichestvo_zayavok
    FROM transportnoe_sredstvo ts
    JOIN model m  ON m.id = ts.model_id
    JOIN marka mk ON mk.id = m.marka_id
    JOIN podrazdelenie pd ON pd.id = ts.podrazdelenie_id
    LEFT JOIN sotrudnik sz ON sz.id = ts.sozdatel_id
    ${where}
    ORDER BY ts.id DESC
    `,
    params
  );
  res.json({ items: rows, total: rows.length });
});

/* ---------------------------------------------------------------
   GET /api/transport/:id
   --------------------------------------------------------------- */
router.get('/:id', async (req, res) => {
  const id = intOrNull(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const [rows] = await pool.execute(
    `
    SELECT ts.*, m.nazvanie AS model, mk.id AS marka_id, mk.nazvanie AS marka,
           pd.nazvanie AS podrazdelenie, sz.fio AS sozdatel_fio
    FROM transportnoe_sredstvo ts
    JOIN model m  ON m.id = ts.model_id
    JOIN marka mk ON mk.id = m.marka_id
    JOIN podrazdelenie pd ON pd.id = ts.podrazdelenie_id
    LEFT JOIN sotrudnik sz ON sz.id = ts.sozdatel_id
    WHERE ts.id = ?
    `,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });

  const ts = rows[0];
  // Пользователь видит только то, что сам создал.
  if (!ROLE_READ_ALL.includes(req.user.rol_nazvanie)
      && ts.sozdatel_id !== req.user.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(ts);
});

/* ---------------------------------------------------------------
   POST /api/transport — создать ТС
   --------------------------------------------------------------- */
router.post('/', async (req, res) => {
  const gos_nomer    = strOrNull(req.body?.gos_nomer, 50);
  const invent_nomer = strOrNull(req.body?.invent_nomer, 50);
  const model_id     = intOrNull(req.body?.model_id);
  const probeg       = intOrNull(req.body?.probeg);
  const data_vypuska = strOrNull(req.body?.data_vypuska, 10);
  const sostoyanie   = strOrNull(req.body?.tekuschee_sostoyanie, 100) || 'В строю';
  let podrazdelenie_id = intOrNull(req.body?.podrazdelenie_id);

  if (!gos_nomer || !invent_nomer || !model_id) {
    return res.status(400).json({ error: 'gos_nomer, invent_nomer и model_id обязательны' });
  }

  // RBAC: Пользователь — только в своё подразделение.
  // Если podrazdelenie_id не пришло в JWT (старый токен) — читаем из БД.
  let userPdId = req.user.podrazdelenie_id;
  if (!userPdId) {
    const [u] = await pool.execute(
      'SELECT podrazdelenie_id FROM sotrudnik WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    userPdId = u[0]?.podrazdelenie_id ?? null;
  }
  if (!ROLE_READ_ALL.includes(req.user.rol_nazvanie)) {
    podrazdelenie_id = userPdId;
  } else if (!podrazdelenie_id) {
    podrazdelenie_id = userPdId;
  }
  if (!podrazdelenie_id) {
    return res.status(400).json({ error: 'У вашего аккаунта не указано подразделение' });
  }

  // Валидация связей
  const [m] = await pool.execute('SELECT id FROM model WHERE id = ? LIMIT 1', [model_id]);
  if (!m.length) return res.status(400).json({ error: 'Модель не найдена' });

  const [pd] = await pool.execute('SELECT id FROM podrazdelenie WHERE id = ? LIMIT 1', [podrazdelenie_id]);
  if (!pd.length) return res.status(400).json({ error: 'Подразделение не найдено' });

  // Уникальность гос-номера в системе (мягкая проверка — предупреждение через 409)
  const [dup] = await pool.execute(
    'SELECT id FROM transportnoe_sredstvo WHERE LOWER(gos_nomer) = LOWER(?) LIMIT 1',
    [gos_nomer]
  );
  if (dup.length) {
    return res.status(409).json({ error: 'Транспортное средство с таким гос-номером уже существует' });
  }

  const [ins] = await pool.execute(
    `INSERT INTO transportnoe_sredstvo
       (gos_nomer, invent_nomer, model_id, podrazdelenie_id, probeg, data_vypuska, tekuschee_sostoyanie, sozdatel_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [gos_nomer, invent_nomer, model_id, podrazdelenie_id, probeg, data_vypuska, sostoyanie, req.user.id]
  );
  const newId = ins[0].id;
  await audit(req.user.id, 'create', 'transportnoe_sredstvo', newId, null, gos_nomer);
  res.status(201).json({ id: newId, gos_nomer });
});

/* ---------------------------------------------------------------
   PATCH /api/transport/:id — обновление полей
   --------------------------------------------------------------- */
router.patch('/:id', async (req, res) => {
  const id = intOrNull(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const [rows] = await pool.execute(
    'SELECT id, podrazdelenie_id, sozdatel_id FROM transportnoe_sredstvo WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });

  // RBAC: обычный Пользователь может править только свои ТС.
  if (!ROLE_READ_ALL.includes(req.user.rol_nazvanie)
      && rows[0].sozdatel_id !== req.user.id) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const sets = [];
  const params = [];
  const allowed = ['probeg', 'tekuschee_sostoyanie', 'invent_nomer', 'data_vypuska'];
  for (const f of allowed) {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f} = ?`);
      params.push(req.body[f] === '' ? null : req.body[f]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'нет полей для обновления' });

  params.push(id);
  await pool.execute(
    `UPDATE transportnoe_sredstvo SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
  await audit(req.user.id, 'update', 'transportnoe_sredstvo', id);
  res.json({ id, updated: true });
});

/* ---------------------------------------------------------------
   DELETE /api/transport/:id
   • Директор/Главный механик — могут удалить любое ТС
   • Обычные роли (включая Пользователя) — только своё (sozdatel_id = id)
   • В обоих случаях: 409 если на ТС уже есть заявки.
   --------------------------------------------------------------- */
router.delete('/:id', async (req, res) => {
  const id = intOrNull(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  // Сначала достаём ТС, чтобы понять — это «своё» или «чужое»
  const [tsRows] = await pool.execute(
    'SELECT id, sozdatel_id FROM transportnoe_sredstvo WHERE id = ? LIMIT 1',
    [id]
  );
  if (!tsRows.length) return res.status(404).json({ error: 'not found' });

  const isAdmin = ROLE_DELETE.includes(req.user.rol_nazvanie);
  const isOwner = tsRows[0].sozdatel_id === req.user.id;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // Защита: не даём удалять, если есть заявки
  const [used] = await pool.execute('SELECT COUNT(*)::int AS n FROM zayavka WHERE ts_id = ?', [id]);
  if (used[0]?.n > 0) {
    return res.status(409).json({ error: 'Нельзя удалить — есть заявки на это ТС' });
  }

  const [r] = await pool.execute(
    'DELETE FROM transportnoe_sredstvo WHERE id = ? RETURNING id',
    [id]
  );
  if (!r.length) return res.status(404).json({ error: 'not found' });
  await audit(req.user.id, 'delete', 'transportnoe_sredstvo', id);
  res.json({ id, deleted: true });
});

module.exports = router;
