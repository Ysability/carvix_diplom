/**
 * Carvix — Rate limiting middleware.
 *
 *  • loginLimiter  — 5 попыток за 15 мин на /api/auth/login
 *  • apiLimiter   — 100 запросов за 15 мин на все /api/*
 */

const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Слишком много попыток входа. Попробуйте через 15 минут.',
    });
  },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Превышен лимит запросов. Попробуйте через 15 минут.',
    });
  },
});

module.exports = { loginLimiter, apiLimiter };
