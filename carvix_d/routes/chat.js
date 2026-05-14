/**
 * Carvix — API чата заявки (между механиком и создателем/диспетчером).
 */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// GET /api/zayavki/:id/chat
router.get('/', authRequired, async (req, res) => {
  try {
    const zayavkaId = Number(req.params.id);
    if (!Number.isFinite(zayavkaId)) {
      return res.status(400).json({ error: 'Некорректный id заявки' });
    }

    // Проверка доступа: участники заявки, механик, диспетчер, руководство
    const [[z]] = await pool.execute(
      `SELECT z.id, z.sozdatel_id, r.mekhanik_id
         FROM zayavka z
         LEFT JOIN remont r ON r.zayavka_id = z.id
        WHERE z.id = ?`,
      [zayavkaId]
    );
    if (!z) return res.status(404).json({ error: 'Заявка не найдена' });

    const role = req.user.rol_nazvanie;
    const canRead = (
      z.sozdatel_id === req.user.id ||
      z.mekhanik_id === req.user.id ||
      ['Диспетчер', 'Главный механик', 'Директор', 'Аналитик'].includes(role)
    );
    if (!canRead) return res.status(403).json({ error: 'Нет доступа к чату' });

    const [rows] = await pool.execute(
      `SELECT s.id, s.tekst, s.data_sozdaniya,
              a.fio AS avtor_fio, a.id AS avtor_id
         FROM zayavka_soobshenie s
         JOIN sotrudnik a ON a.id = s.avtor_id
        WHERE s.zayavka_id = ?
        ORDER BY s.data_sozdaniya ASC`,
      [zayavkaId]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения сообщений' });
  }
});

// POST /api/zayavki/:id/chat
router.post('/', authRequired, async (req, res) => {
  try {
    const zayavkaId = Number(req.params.id);
    if (!Number.isFinite(zayavkaId)) {
      return res.status(400).json({ error: 'Некорректный id заявки' });
    }
    const tekst = String(req.body?.tekst || '').trim();
    if (!tekst) {
      return res.status(400).json({ error: 'Введите текст сообщения' });
    }
    if (tekst.length > 2000) {
      return res.status(400).json({ error: 'Сообщение слишком длинное (макс. 2000 символов)' });
    }

    const [[z]] = await pool.execute(
      `SELECT z.id, z.sozdatel_id, r.mekhanik_id
         FROM zayavka z
         LEFT JOIN remont r ON r.zayavka_id = z.id
        WHERE z.id = ?`,
      [zayavkaId]
    );
    if (!z) return res.status(404).json({ error: 'Заявка не найдена' });

    const role = req.user.rol_nazvanie;
    const canWrite = (
      z.sozdatel_id === req.user.id ||
      z.mekhanik_id === req.user.id ||
      ['Диспетчер', 'Главный механик', 'Директор', 'Аналитик'].includes(role)
    );
    if (!canWrite) return res.status(403).json({ error: 'Нет прав на отправку сообщений' });

    const [result] = await pool.execute(
      `INSERT INTO zayavka_soobshenie (zayavka_id, avtor_id, tekst)
       VALUES (?, ?, ?)`,
      [zayavkaId, req.user.id, tekst]
    );

    const [rows] = await pool.execute(
      `SELECT s.id, s.tekst, s.data_sozdaniya,
              a.fio AS avtor_fio, a.id AS avtor_id
         FROM zayavka_soobshenie s
         JOIN sotrudnik a ON a.id = s.avtor_id
        WHERE s.id = ?`,
      [result.insertId]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка отправки сообщения' });
  }
});

module.exports = router;
