/**
 * Carvix — стартовый бутстрап БД.
 *
 * 1. Применяет schema.sql (CREATE TABLE IF NOT EXISTS …) — таблицы
 *    создаются автоматически при первом запуске на чистой БД (Render).
 * 2. Гарантирует наличие 6 базовых ролей и 4 подразделений.
 *
 * Демо-данные (12 сотрудников, машины, заявки …) — отдельно через
 * `npm run seed:demo`.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./db');

// Демо-логины: ВСЕ имеют пароль "password" в режиме SEED_DEMO
const DEMO_LOGINS = [
  'ivanov', 'petrov', 'sidorov', 'kuznetsov', 'morozova', 'volkova',
  'sokolov', 'lebedev', 'novikov', 'orlova', 'zaytsev', 'frolova',
];

const ROLES = [
  'Аналитик',
  'Диспетчер',
  'Механик',
  'Главный механик',
  'Директор',
  'Пользователь',
];

const DEFAULT_PODRAZDELENIYA = [
  'Главное управление',
  'Автопарк №1',
  'Автопарк №2',
  'Ремонтный цех',
];

async function applySchema() {
  const ddl = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const clean = ddl.trim();
  if (!clean) return;
  await pool.raw(clean);
}

async function ensureRows(table, items) {
  for (const name of items) {
    const [rows] = await pool.execute(
      `SELECT id FROM ${table} WHERE nazvanie = ? LIMIT 1`,
      [name]
    );
    if (rows.length === 0) {
      await pool.execute(`INSERT INTO ${table} (nazvanie) VALUES (?)`, [name]);
      const label = table === 'rol' ? 'роль' : 'подразделение';
      console.log(`[seed] Добавлено ${label}: ${name}`);
    }
  }
}

/**
 * Если SEED_DEMO=true и в БД нет ни одного сотрудника — автоматически
 * прогоняем полный seed_data.sql. Это позволяет на бесплатном плане Render
 * (без Shell) развернуть систему «из коробки» с готовыми тестовыми учётками.
 *
 * После первого успешного автозалива в БД появятся 12 сотрудников и при
 * следующем рестарте этот блок ничего не сделает (sotrudnik > 0).
 */
async function autoSeedDemoIfEmpty() {
  if (String(process.env.SEED_DEMO).toLowerCase() !== 'true') {
    return;
  }

  // Триггер: отсутствует канонический демо-юзер `ivanov`. Так мы корректно
  // обработаем три случая:
  //   1. Чистая БД                 → грузим демо.
  //   2. Только ручные регистрации → грузим демо (TRUNCATE очистит, но это
  //      демо-стенд диплома; реальных пользователей здесь не должно быть).
  //   3. Демо уже залито           → ничего не делаем.
  const [check] = await pool.execute(
    "SELECT 1 FROM sotrudnik WHERE login = 'ivanov' LIMIT 1"
  );
  if (check.length) {
    console.log('[seed] Демо-учётка ivanov найдена — автозалив пропущен.');
    return;
  }

  const sqlFile = path.join(__dirname, 'seed_data.sql');
  if (!fs.existsSync(sqlFile)) {
    console.warn('[seed] SEED_DEMO=true, но seed_data.sql не найден.');
    return;
  }

  console.log('[seed] Канонической демо-учётки нет → запускаю seed_data.sql …');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  await pool.raw(sql);
  console.log('[seed] Демо-данные успешно загружены. Логины: ivanov / petrov / volkova (пароль: password)');
}

/**
 * Сброс паролей демо-учёток к "password" при SEED_DEMO=true.
 *
 * Зачем: если в seed_data.sql случайно попал некорректный bcrypt-хэш,
 * после автозалива учётки существуют, но войти в них нельзя. Этот шаг
 * генерирует свежий валидный хэш через bcryptjs (что 100% совместимо с
 * compare-проверкой в /api/auth/login) и применяет его ко всем демо-юзерам.
 *
 * Безопасно: затрагивает ТОЛЬКО заранее известный список логинов
 * (ivanov, petrov, ...). На пользователей, зарегистрированных вручную,
 * никак не влияет.
 */
async function resetDemoPasswordsIfNeeded() {
  if (String(process.env.SEED_DEMO).toLowerCase() !== 'true') return;

  const newHash = bcrypt.hashSync('password', 10);
  const placeholders = DEMO_LOGINS.map(() => '?').join(', ');
  const [r] = await pool.execute(
    `UPDATE sotrudnik
        SET parol_hash = ?
      WHERE login IN (${placeholders})
      RETURNING login`,
    [newHash, ...DEMO_LOGINS]
  );
  if (r.length) {
    console.log(`[seed] Сброшены пароли демо-учёток к "password" (${r.length} шт.)`);
  }
}

async function migrateAvatarColumn() {
  try {
    await pool.raw(`
      ALTER TABLE sotrudnik ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512) DEFAULT NULL
    `);
  } catch (e) {
    // колонка уже существует — ок
  }
}

async function seed() {
  await applySchema();
  await migrateAvatarColumn();
  await ensureRows('rol', ROLES);
  await ensureRows('podrazdelenie', DEFAULT_PODRAZDELENIYA);
  await autoSeedDemoIfEmpty();
  await resetDemoPasswordsIfNeeded();
}

module.exports = seed;
