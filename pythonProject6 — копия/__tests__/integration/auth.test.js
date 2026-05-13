/**
 * Carvix — интеграционные тесты модуля авторизации (/api/auth/*).
 *
 * Тесты используют supertest и заглушённый pool (см. helpers/mockDb.js).
 * Проверяем:
 *   • справочники: GET /roles, GET /podrazdeleniya;
 *   • вход: POST /login (нет полей / неизвестный логин / неверный пароль / OK);
 *   • регистрация: POST /register (валидация / занятый логин / OK);
 *   • профиль: GET /me (без токена / с токеном).
 */

jest.mock('../../db', () => require('../helpers/mockDb'));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mockDb = require('../helpers/mockDb');
const makeApp = require('../helpers/makeApp');
const { tokenFor, ROLES } = require('../helpers/auth');

const app = makeApp({ withAuth: true, withFinance: false });

beforeEach(() => mockDb.__reset());

/* =============================================================
   GET /api/auth/roles
   ============================================================= */
describe('GET /api/auth/roles', () => {
  it('возвращает массив ролей из таблицы rol', async () => {
    mockDb.__when(/SELECT id, nazvanie FROM rol/i, [
      { id: 1, nazvanie: 'Пользователь' },
      { id: 5, nazvanie: 'Директор' },
    ]);

    const r = await request(app).get('/api/auth/roles').expect(200);
    expect(r.body).toEqual([
      { id: 1, nazvanie: 'Пользователь' },
      { id: 5, nazvanie: 'Директор' },
    ]);
  });

  it('возвращает 500 при ошибке БД', async () => {
    mockDb.__when(/SELECT id, nazvanie FROM rol/i, () => {
      throw new Error('connection refused');
    });
    const r = await request(app).get('/api/auth/roles').expect(500);
    expect(r.body.error).toMatch(/Ошибка получения ролей/);
  });
});

/* =============================================================
   GET /api/auth/podrazdeleniya
   ============================================================= */
describe('GET /api/auth/podrazdeleniya', () => {
  it('возвращает список подразделений отсортированный по названию', async () => {
    mockDb.__when(/FROM podrazdelenie ORDER BY nazvanie/i, [
      { id: 1, nazvanie: 'Главное управление' },
      { id: 2, nazvanie: 'Северный филиал' },
    ]);
    const r = await request(app).get('/api/auth/podrazdeleniya').expect(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0].nazvanie).toBe('Главное управление');
  });
});

/* =============================================================
   POST /api/auth/login
   ============================================================= */
describe('POST /api/auth/login', () => {
  it('400 если не указаны логин или пароль', async () => {
    const r = await request(app).post('/api/auth/login').send({}).expect(400);
    expect(r.body.error).toMatch(/Введите логин и пароль/);
  });

  it('401 если пользователь не найден', async () => {
    mockDb.__when(/FROM sotrudnik s/i, []);
    const r = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ghost', password: '12345678' })
      .expect(401);
    expect(r.body.error).toMatch(/Неверный логин или пароль/);
  });

  it('401 если пароль не совпадает', async () => {
    const hash = await bcrypt.hash('correct-password', 4);
    mockDb.__when(/FROM sotrudnik s/i, [
      { id: 1, fio: 'Иванов', login: 'ivanov', parol_hash: hash,
        rol_id: 5, rol_nazvanie: 'Директор',
        podrazdelenie_id: 1, podrazdelenie_nazvanie: 'ГУ' },
    ]);

    const r = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ivanov', password: 'wrong-password' })
      .expect(401);

    expect(r.body.error).toMatch(/Неверный логин или пароль/);
  });

  it('200 + token + user при правильных кредах; токен подписан JWT_SECRET', async () => {
    const hash = await bcrypt.hash('password', 4);
    mockDb.__when(/FROM sotrudnik s/i, [
      { id: 1, fio: 'Иванов', login: 'ivanov', parol_hash: hash,
        rol_id: 5, rol_nazvanie: 'Директор',
        podrazdelenie_id: 1, podrazdelenie_nazvanie: 'ГУ' },
    ]);

    const r = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ivanov', password: 'password' })
      .expect(200);

    expect(r.body.token).toEqual(expect.any(String));
    expect(r.body.user).toMatchObject({
      id: 1, fio: 'Иванов', login: 'ivanov', rol_nazvanie: 'Директор',
    });
    // парол_хеш НЕ должен утечь
    expect(r.body.user.parol_hash).toBeUndefined();

    const decoded = jwt.verify(r.body.token, process.env.JWT_SECRET);
    expect(decoded).toMatchObject({
      id: 1, login: 'ivanov', rol_nazvanie: 'Директор',
    });
  });
});

/* =============================================================
   POST /api/auth/register
   ============================================================= */
describe('POST /api/auth/register', () => {
  it('400, если не заполнены все поля', async () => {
    const r = await request(app)
      .post('/api/auth/register')
      .send({ fio: 'Иван', login: 'novyi' })
      .expect(400);
    expect(r.body.error).toMatch(/Заполните все поля/);
  });

  it('400, если пароль короче 6 символов', async () => {
    const r = await request(app)
      .post('/api/auth/register')
      .send({ fio: 'Иван', login: 'novyi', password: '123' })
      .expect(400);
    expect(r.body.error).toMatch(/не менее 6 символов/);
  });

  it('409, если логин уже занят', async () => {
    mockDb.__when(/SELECT id FROM sotrudnik WHERE login = \? LIMIT 1/i, [{ id: 7 }]);
    const r = await request(app)
      .post('/api/auth/register')
      .send({ fio: 'Иван', login: 'ivanov', password: 'password' })
      .expect(409);
    expect(r.body.error).toMatch(/Логин уже занят/);
  });

  it('201 при успешной регистрации, выдаёт токен и пишет в sotrudnik', async () => {
    const newUserId = 42;
    mockDb
      // 1) проверка занятости логина — никого нет
      .__when(/SELECT id FROM sotrudnik WHERE login = \? LIMIT 1/i, [])
      // 2) роль "Пользователь"
      .__when(/FROM rol WHERE nazvanie = 'Пользователь'/i, [{ id: 1 }])
      // 3) подразделение "Главное управление"
      .__when(/FROM podrazdelenie WHERE nazvanie = 'Главное управление'/i, [{ id: 1 }])
      // 4) INSERT INTO sotrudnik RETURNING id
      .__when(/INSERT INTO sotrudnik/i, [{ id: newUserId }])
      // 5) SELECT user после INSERT
      .__when(/SELECT s\.id, s\.fio, s\.login, s\.rol_id/i, [{
        id: newUserId, fio: 'Иван Новый', login: 'novyi', rol_id: 1,
        rol_nazvanie: 'Пользователь',
        podrazdelenie_id: 1, podrazdelenie_nazvanie: 'Главное управление',
      }]);

    const r = await request(app)
      .post('/api/auth/register')
      .send({ fio: 'Иван Новый', login: 'novyi', password: 'password' })
      .expect(201);

    expect(r.body.token).toEqual(expect.any(String));
    expect(r.body.user.id).toBe(newUserId);
    expect(r.body.user.rol_nazvanie).toBe('Пользователь');

    // Проверяем, что INSERT действительно был
    expect(mockDb.__find(/INSERT INTO sotrudnik/i)).toBeTruthy();
  });
});

/* =============================================================
   GET /api/auth/me
   ============================================================= */
describe('GET /api/auth/me', () => {
  it('401 без токена', async () => {
    const r = await request(app).get('/api/auth/me').expect(401);
    expect(r.body.error).toMatch(/Требуется авторизация/);
  });

  it('200 с токеном; данные подгружаются по req.user.id', async () => {
    mockDb.__when(/FROM sotrudnik s\s+JOIN rol/i, [{
      id: 1, fio: 'Иванов', login: 'ivanov', rol_id: 5, rol_nazvanie: 'Директор',
      podrazdelenie_id: 1, podrazdelenie_nazvanie: 'ГУ',
    }]);
    const token = tokenFor(ROLES.DIRECTOR, { id: 1 });
    const r = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(r.body.fio).toBe('Иванов');
    const call = mockDb.__find(/FROM sotrudnik s\s+JOIN rol/i);
    expect(call.params).toEqual([1]);
  });

  it('404, если пользователь из токена удалён из БД', async () => {
    mockDb.__when(/FROM sotrudnik s\s+JOIN rol/i, []);
    const token = tokenFor(ROLES.DIRECTOR, { id: 999 });
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
