const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/auth/roles
router.get('/roles', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nazvanie FROM rol ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения ролей' });
  }
});

// GET /api/auth/podrazdeleniya
router.get('/podrazdeleniya', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nazvanie FROM podrazdelenie ORDER BY nazvanie ASC'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка получения подразделений' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { fio, login, password } = req.body || {};

    if (!fio || !login || !password) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    if (String(password).length < 6) {
      return res
        .status(400)
        .json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    const [exists] = await pool.execute(
      'SELECT id FROM sotrudnik WHERE login = ? LIMIT 1',
      [login]
    );
    if (exists.length) {
      return res.status(409).json({ error: 'Логин уже занят' });
    }

    // По умолчанию: роль "Пользователь", подразделение "Главное управление"
    const [[defRol]] = await pool.execute(
      "SELECT id FROM rol WHERE nazvanie = 'Пользователь' LIMIT 1"
    );
    const [[defPodr]] = await pool.execute(
      "SELECT id FROM podrazdelenie WHERE nazvanie = 'Главное управление' LIMIT 1"
    );
    if (!defRol || !defPodr) {
      return res
        .status(500)
        .json({ error: 'Не настроены роли/подразделения по умолчанию' });
    }
    const rol_id = defRol.id;
    const podrazdelenie_id = defPodr.id;

    const hash = await bcrypt.hash(password, 10);
    const [inserted] = await pool.execute(
      `INSERT INTO sotrudnik (fio, login, parol_hash, rol_id, podrazdelenie_id)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
      [fio, login, hash, rol_id, podrazdelenie_id]
    );

    const userId = inserted[0].id;
    const [rows] = await pool.execute(
      `SELECT s.id, s.fio, s.login, s.rol_id, r.nazvanie AS rol_nazvanie,
              s.podrazdelenie_id, p.nazvanie AS podrazdelenie_nazvanie
         FROM sotrudnik s
         JOIN rol r ON r.id = s.rol_id
         JOIN podrazdelenie p ON p.id = s.podrazdelenie_id
        WHERE s.id = ?`,
      [userId]
    );
    const user = rows[0];

    const token = jwt.sign(
      {
        id: user.id,
        login: user.login,
        rol_id: user.rol_id,
        rol_nazvanie: user.rol_nazvanie,
        podrazdelenie_id: user.podrazdelenie_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    const [rows] = await pool.execute(
      `SELECT s.id, s.fio, s.login, s.parol_hash, s.rol_id, r.nazvanie AS rol_nazvanie,
              s.podrazdelenie_id, p.nazvanie AS podrazdelenie_nazvanie
         FROM sotrudnik s
         JOIN rol r ON r.id = s.rol_id
         JOIN podrazdelenie p ON p.id = s.podrazdelenie_id
        WHERE s.login = ?
        LIMIT 1`,
      [login]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.parol_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    delete user.parol_hash;

    const token = jwt.sign(
      {
        id: user.id,
        login: user.login,
        rol_id: user.rol_id,
        rol_nazvanie: user.rol_nazvanie,
        podrazdelenie_id: user.podrazdelenie_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// GET /api/auth/me
router.get('/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.id, s.fio, s.login, s.rol_id, r.nazvanie AS rol_nazvanie,
              s.podrazdelenie_id, p.nazvanie AS podrazdelenie_nazvanie
         FROM sotrudnik s
         JOIN rol r ON r.id = s.rol_id
         JOIN podrazdelenie p ON p.id = s.podrazdelenie_id
        WHERE s.id = ?`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найден' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

module.exports = router;
