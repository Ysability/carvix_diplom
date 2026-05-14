require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const seed = require('./seed');
const authRoutes = require('./routes/auth');
const financeRoutes = require('./routes/finance');
const zayavkiRoutes = require('./routes/zayavki');
const remontyRoutes = require('./routes/remonty');
const transportRoutes = require('./routes/transport');
const { loginLimiter, apiLimiter } = require('./middleware/rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

const app = express();
const PORT = process.env.PORT || 3000;

const fs = require('fs');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Папка для загруженных аватарок
const uploadsDir = path.join(__dirname, 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/zayavki', zayavkiRoutes);
app.use('/api/remonty', remontyRoutes);
app.use('/api/transport', transportRoutes);

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Carvix API Docs',
}));

app.get('/health', (_, res) => res.json({ ok: true }));

(async () => {
  try {
    await seed();
    app.listen(PORT, () => {
      console.log(`\n  Carvix запущен:  http://localhost:${PORT}\n`);
    });
  } catch (e) {
    console.error('Не удалось инициализировать приложение:', e);
    process.exit(1);
  }
})();
