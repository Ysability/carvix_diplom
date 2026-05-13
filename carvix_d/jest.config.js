/**
 * Carvix — конфигурация Jest для дипломного проекта.
 *
 * Особенности:
 *   • тесты лежат в каталоге __tests__ (стандарт Jest);
 *   • покрытие собирается с роутов и middleware (бизнес-код);
 *   • покрытие хранится в coverage/ (gitignored);
 *   • setup-файл готовит env-переменные перед каждым тестом.
 */

module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/__tests__/**/*.test.js',
  ],
  setupFiles: ['<rootDir>/__tests__/setup-env.js'],
  collectCoverageFrom: [
    'middleware/**/*.js',
    'routes/**/*.js',
    'db.js',
    '!routes/finance/exports.js', // чисто Excel/PDF-генерация — отдельные тесты не пишем
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  verbose: true,
  testTimeout: 10_000,
  // Не загружаем настоящий `dotenv` — JWT_SECRET зададим в setup-env.js
  clearMocks: true,
  resetModules: false,
};
