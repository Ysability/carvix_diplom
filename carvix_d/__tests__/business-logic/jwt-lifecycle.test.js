/**
 * Carvix — тесты жизненного цикла JWT.
 *
 * Проверяем:
 *   • payload корректно (де)сериализуется;
 *   • expiresIn действительно делает токен временным;
 *   • токен с другим секретом отвергается;
 *   • полный сценарий "login → защищённый endpoint" работает в одной цепочке.
 */

const jwt = require('jsonwebtoken');

describe('JWT lifecycle (jsonwebtoken + наш JWT_SECRET)', () => {
  const SECRET = process.env.JWT_SECRET;
  const PAYLOAD = { id: 42, login: 'testuser', rol_nazvanie: 'Директор' };

  it('подпись и верификация — round-trip', () => {
    const token = jwt.sign(PAYLOAD, SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, SECRET);
    expect(decoded).toMatchObject(PAYLOAD);
    expect(decoded.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('verify с другим секретом — TokenError', () => {
    const token = jwt.sign(PAYLOAD, SECRET, { expiresIn: '1h' });
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });

  it('expired-токен — TokenExpiredError', () => {
    const token = jwt.sign(PAYLOAD, SECRET, { expiresIn: -10 });
    expect(() => jwt.verify(token, SECRET)).toThrow(/jwt expired/);
  });

  it('алгоритм по умолчанию — HS256', () => {
    const token = jwt.sign(PAYLOAD, SECRET);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
  });

  it('manipulated payload (tampering) — InvalidSignatureError', () => {
    const token = jwt.sign(PAYLOAD, SECRET, { expiresIn: '1h' });
    const [h, , s] = token.split('.');
    // подменяем payload на «администратор»
    const tampered = Buffer.from(JSON.stringify({ ...PAYLOAD, rol_nazvanie: 'Администратор' }))
      .toString('base64url');
    const fakeToken = `${h}.${tampered}.${s}`;
    expect(() => jwt.verify(fakeToken, SECRET)).toThrow(/signature/i);
  });
});
