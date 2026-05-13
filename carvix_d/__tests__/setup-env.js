/**
 * Carvix — инициализация окружения перед запуском тестов.
 *
 * Этот файл выполняется один раз ПЕРЕД импортом тестируемого кода
 * (см. jest.config.js → setupFiles). Он гарантирует, что:
 *   • JWT_SECRET определён (его читает middleware/auth и routes/auth);
 *   • DATABASE_URL не указывает на боевую БД;
 *   • dotenv не подменит наши значения боевыми из .env-файла.
 */

// Запрещаем dotenv подгружать .env (там может быть production-БД)
process.env.DOTENV_DISABLE = '1';
const dotenvOriginal = require('dotenv');
const realConfig = dotenvOriginal.config.bind(dotenvOriginal);
dotenvOriginal.config = (opts = {}) => {
  if (process.env.DOTENV_DISABLE === '1') {
    return { parsed: {} }; // no-op
  }
  return realConfig(opts);
};

process.env.NODE_ENV = 'test';

// Глушим console.error в тестах — серверные роутеры логируют пойманные
// исключения, что захламляет вывод. Сами тесты проверяют HTTP-коды и тела
// ответов, а не stdout.
const originalError = console.error;
console.error = (...args) => {
  if (process.env.CARVIX_TEST_VERBOSE === '1') originalError(...args);
};

process.env.JWT_SECRET = 'carvix-test-secret-key';
process.env.JWT_EXPIRES_IN = '1h';
process.env.DATABASE_URL = '';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5432';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'carvix_test';
