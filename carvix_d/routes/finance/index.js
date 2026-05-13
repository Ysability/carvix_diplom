/**
 * Carvix — финансовый модуль (агрегатор подмаршрутов).
 *
 * Подключается в server.js одной строкой:
 *   app.use('/api/finance', require('./routes/finance'));
 */

const express = require('express');

const expenses = require('./expenses');
const budgets = require('./budgets');
const reports = require('./reports');
const partsReceipts = require('./parts-receipts');
const audit = require('./audit');
const exportsRouter = require('./exports');

const router = express.Router();

router.use('/expenses',       expenses);
router.use('/budgets',        budgets);
router.use('/reports',        reports);
router.use('/parts/receipts', partsReceipts);
router.use('/audit-log',      audit);
router.use('/exports',        exportsRouter);

// Список зарегистрированных эндпоинтов (полезно для отладки/документации)
router.get('/_routes', (_, res) => {
  res.json({
    expenses:        ['GET /', 'POST /', 'PUT /:id', 'DELETE /:id', 'POST /import-csv'],
    budgets:         ['GET /', 'GET /plan-fakt', 'POST /', 'POST /bulk',
                      'POST /copy-from-prev-year', 'PUT /:id', 'DELETE /:id'],
    reports:         ['GET /tco', 'GET /tco/:tsId', 'GET /dashboard'],
    parts_receipts:  ['GET /', 'GET /:id', 'POST /', 'DELETE /:id'],
    audit_log:       ['GET /'],
    exports:         ['GET /excel/tco', 'GET /excel/expenses', 'GET /excel/budgets',
                      'GET /pdf/receipt/:id', 'GET /pdf/monthly/:pdId/:god/:m',
                      'GET /pdf/writeoff/:remontId', 'POST /email'],
  });
});

module.exports = router;
