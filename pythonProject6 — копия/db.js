/**
 * Carvix — пул подключений к PostgreSQL.
 *
 * Сохраняем mysql2-совместимый API:
 *   const pool = require('./db');
 *   const [rows] = await pool.execute('SELECT * FROM x WHERE id = ?', [id]);
 *
 * Внутри переписываем `?`-плейсхолдеры в PG-формат `$1, $2, …`.
 * Это позволяет не менять весь код роутов/сидера.
 */

const { Pool } = require('pg');
require('dotenv').config();

// SSL: при подключении через DATABASE_URL (Render, Heroku, Neon, Supabase…)
// почти всегда требуется SSL. Локальный PG (DB_HOST=127.0.0.1) — без SSL.
const useSSL =
  !!process.env.DATABASE_URL || process.env.PGSSL === 'true';

const ssl = useSSL ? { rejectUnauthorized: false } : false;

const pgPool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl })
  : new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'carvix',
      ssl,
    });

pgPool.on('error', (err) => {
  console.error('[db] Неожиданная ошибка pg-пула:', err.message);
});

/**
 * Транслирует «?» в «$1, $2, …» и возвращает [rows, fields]
 * — формат, к которому привык остальной код (mysql2/promise).
 */
async function execute(sql, params = []) {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pgPool.query(text, params);
  return [result.rows, result.fields];
}

async function query(sql, params) {
  return execute(sql, params);
}

/** Прямой вызов pg-клиента (для DDL и многократных стейтментов). */
async function raw(sql, params) {
  return pgPool.query(sql, params);
}

/**
 * Транзакция. Внутри fn(tx) использовать tx.execute(...) — точно так же,
 * как обычный pool.execute. При ошибке — автоматический ROLLBACK.
 *
 * Пример:
 *   const id = await transaction(async (tx) => {
 *     const [r1] = await tx.execute('INSERT INTO ... RETURNING id', [...]);
 *     await tx.execute('UPDATE ... WHERE id = ?', [r1[0].id]);
 *     return r1[0].id;
 *   });
 */
async function transaction(fn) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      execute: async (sql, params = []) => {
        let i = 0;
        const text = sql.replace(/\?/g, () => `$${++i}`);
        const r = await client.query(text, params);
        return [r.rows, r.fields];
      },
      raw: (sql, params) => client.query(sql, params),
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  execute,
  query,
  raw,
  transaction,
  end: () => pgPool.end(),
  pool: pgPool,
};
