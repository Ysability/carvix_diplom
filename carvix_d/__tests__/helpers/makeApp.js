/**
 * Carvix — фабрика мини-Express-приложения для тестов.
 *
 * Возвращает экземпляр Express с подключёнными маршрутами /api/auth и
 * /api/finance, но БЕЗ запуска сервера (`listen`) и БЕЗ сидинга БД
 * (`require('./seed')` пропускается).
 *
 * ВАЖНО: до вызова makeApp() тестовый файл уже должен сделать
 *        jest.mock('../../db', () => require('../helpers/mockDb'));
 *        — иначе роутеры подхватят реальный pg-пул.
 *
 * Пример:
 *   const mockDb = require('../helpers/mockDb');
 *   jest.mock('../../db', () => require('../helpers/mockDb'));
 *
 *   const makeApp = require('../helpers/makeApp');
 *   const app = makeApp();
 *
 *   await request(app).get('/api/finance/_routes').expect(200);
 */

const express = require('express');

function makeApp({
  withAuth = true,
  withFinance = true,
  withZayavki = false,
  withRemonty = false,
  withTransport = false,
} = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  if (withAuth) {
    const authRoutes = require('../../routes/auth');
    app.use('/api/auth', authRoutes);
  }
  if (withFinance) {
    const financeRoutes = require('../../routes/finance');
    app.use('/api/finance', financeRoutes);
  }
  if (withZayavki) {
    const zayavkiRoutes = require('../../routes/zayavki');
    app.use('/api/zayavki', zayavkiRoutes);
  }
  if (withRemonty) {
    const remontyRoutes = require('../../routes/remonty');
    app.use('/api/remonty', remontyRoutes);
  }
  if (withTransport) {
    const transportRoutes = require('../../routes/transport');
    app.use('/api/transport', transportRoutes);
  }

  app.get('/health', (_, res) => res.json({ ok: true }));

  // 404 fallthrough в JSON, чтобы supertest не падал на text/html
  app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

  return app;
}

module.exports = makeApp;
