/**
 * Carvix — заливка полного набора демо-данных (seed_data.sql).
 *
 * Запуск:    npm run seed:demo
 * Локально:  достаточно поднять PostgreSQL и иметь корректный .env.
 * На Render: можно выполнить из shell сервиса:
 *              node seed-demo.js
 *
 * !!! TRUNCATE: скрипт ОЧИЩАЕТ ВСЕ ТАБЛИЦЫ перед заливкой.
 */

const fs = require('fs');
const path = require('path');
const pool = require('./db');

(async () => {
  const sqlFile = path.join(__dirname, 'seed_data.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error('[seed-demo] Не найден seed_data.sql');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlFile, 'utf8');

  console.log('[seed-demo] Применяю seed_data.sql …');
  try {
    await pool.raw(sql);
    console.log('[seed-demo] Готово. Демо-данные загружены.');
    console.log('[seed-demo] Тестовые логины: ivanov / petrov / morozova … (пароль: password)');
  } catch (e) {
    console.error('[seed-demo] Ошибка:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
