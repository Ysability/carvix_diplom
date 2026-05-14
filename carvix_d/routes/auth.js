const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { handleResult } = require('../middleware/validate');
const { body } = require('express-validator');

const router = express.Router();

// Multer для загрузки аватарок
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only images allowed'), ok);
  },
}).single('avatar');

const USER_SELECT = `
  SELECT s.id, s.fio, s.login, s.rol_id, r.nazvanie AS rol_nazvanie,
         s.podrazdelenie_id, p.nazvanie AS podrazdelenie_nazvanie,
         s.avatar_url
    FROM sotrudnik s
    JOIN rol r ON r.id = s.rol_id
    JOIN podrazdelenie p ON p.id = s.podrazdelenie_id`;

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
    const fioTrim = String(fio).trim();
    const fioParts = fioTrim.split(/\s+/).filter(Boolean);
    if (fioParts.length < 2) {
      return res.status(400).json({ error: 'Введите полное ФИО (минимум 2 слова)' });
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
      USER_SELECT + ' WHERE s.id = ?',
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
              s.podrazdelenie_id, p.nazvanie AS podrazdelenie_nazvanie, s.avatar_url
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
      USER_SELECT + ' WHERE s.id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найден' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// PUT /api/auth/profile — обновление ФИО и/или пароля
router.put('/profile', authRequired, [
  body('fio').optional().trim().notEmpty().withMessage('ФИО не может быть пустым').isLength({ max: 255 }),
  body('new_password').optional().isLength({ min: 6 }).withMessage('Новый пароль минимум 6 символов'),
  body('old_password').custom((value, { req }) => {
    if (req.body.new_password && !value) {
      throw new Error('Введите текущий пароль');
    }
    return true;
  }),
  handleResult,
], async (req, res) => {
  try {
    const { fio, old_password, new_password } = req.body || {};
    const userId = req.user.id;

    // Если меняют пароль — проверяем старый
    if (new_password) {
      if (!old_password) {
        return res.status(400).json({ error: 'Введите текущий пароль' });
      }
      if (String(new_password).length < 6) {
        return res.status(400).json({ error: 'Новый пароль должен быть не менее 6 символов' });
      }

      const [userRows] = await pool.execute(
        'SELECT parol_hash FROM sotrudnik WHERE id = ?',
        [userId]
      );
      if (!userRows.length) return res.status(404).json({ error: 'Пользователь не найден' });

      const ok = await bcrypt.compare(old_password, userRows[0].parol_hash);
      if (!ok) {
        return res.status(403).json({ error: 'Неверный текущий пароль' });
      }

      const hash = await bcrypt.hash(new_password, 10);
      await pool.execute('UPDATE sotrudnik SET parol_hash = ? WHERE id = ?', [hash, userId]);
    }

    // Если меняют ФИО
    if (fio && String(fio).trim()) {
      const parts = String(fio).trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        return res.status(400).json({ error: 'Введите полное ФИО (минимум 2 слова)' });
      }
      await pool.execute('UPDATE sotrudnik SET fio = ? WHERE id = ?', [String(fio).trim(), userId]);
    }

    // Возвращаем обновлённые данные
    const [rows] = await pool.execute(
      USER_SELECT + ' WHERE s.id = ?',
      [userId]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

// POST /api/auth/avatar — загрузка аватарки
router.post('/avatar', authRequired, (req, res) => {
  uploadAvatar(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не выбран' });
    }
    try {
      const userId = req.user.id;
      // Удаляем старый аватар с диска
      const [old] = await pool.execute('SELECT avatar_url FROM sotrudnik WHERE id = ?', [userId]);
      if (old[0]?.avatar_url) {
        const oldPath = path.join(__dirname, '..', old[0].avatar_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const avatarUrl = '/uploads/avatars/' + req.file.filename;
      await pool.execute('UPDATE sotrudnik SET avatar_url = ? WHERE id = ?', [avatarUrl, userId]);
      const [rows] = await pool.execute(USER_SELECT + ' WHERE s.id = ?', [userId]);
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка сохранения аватарки' });
    }
  });
});

// DELETE /api/auth/avatar — удаление аватарки
router.delete('/avatar', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const [old] = await pool.execute('SELECT avatar_url FROM sotrudnik WHERE id = ?', [userId]);
    if (old[0]?.avatar_url) {
      const oldPath = path.join(__dirname, '..', old[0].avatar_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    await pool.execute('UPDATE sotrudnik SET avatar_url = NULL WHERE id = ?', [userId]);
    const [rows] = await pool.execute(USER_SELECT + ' WHERE s.id = ?', [userId]);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка удаления аватарки' });
  }
});

module.exports = router;
