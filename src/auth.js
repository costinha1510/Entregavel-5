const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');

const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-drivego-password', 12);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
    `);
    this.getStatement = database.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
    this.setStatement = database.prepare(`
      INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
    `);
    this.destroyStatement = database.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStatement = database.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.cleanupStatement = database.prepare('DELETE FROM sessions WHERE expires <= ?');
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (error) { callback(error); }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).valueOf() : Date.now() + SESSION_MAX_AGE;
      this.setStatement.run(sid, JSON.stringify(sess), expires);
      this.cleanupStatement.run(Date.now());
      callback(null);
    } catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    try { this.destroyStatement.run(sid); callback(null); }
    catch (error) { callback(error); }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).valueOf() : Date.now() + SESSION_MAX_AGE;
      this.touchStatement.run(expires, sid);
      callback(null);
    } catch (error) { callback(error); }
  }
}

async function ensureAdminUser(database) {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;
  const name = (process.env.ADMIN_NAME || 'Administrador').trim();
  if (!email || !password) throw new Error('Configure ADMIN_EMAIL e ADMIN_PASSWORD para criar o administrador inicial.');
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new Error('ADMIN_EMAIL precisa conter um endereço de e-mail válido.');
  if (!name || name.length > 120) throw new Error('ADMIN_NAME precisa ter entre 1 e 120 caracteres.');
  const passwordBytes = Buffer.byteLength(password, 'utf8');
  if (passwordBytes < 12 || passwordBytes > 72) {
    throw new Error('ADMIN_PASSWORD precisa ter entre 12 e 72 bytes para atender aos limites seguros do bcrypt.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  database.prepare(`
    INSERT INTO users (name, email, password_hash, role, status)
    VALUES (?, ?, ?, 'admin', 'approved')
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash,
      role = 'admin',
      status = 'approved'
  `).run(name, email, passwordHash);
  console.log(`Administrador configurado para ${email}.`);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function createSessionMiddleware(database) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Configure SESSION_SECRET com pelo menos 32 bytes aleatórios.');
  }
  const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.WEBSITE_SITE_NAME);
  return session({
    name: 'drivego.sid',
    secret,
    store: new SQLiteSessionStore(database),
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    },
  });
}

function csrfProtection(request, response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  const expected = Buffer.from(request.session?.csrfToken || '');
  const supplied = Buffer.from(request.get('x-csrf-token') || '');
  if (!expected.length || expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return response.status(403).json({ error: 'A solicitação expirou. Atualize a página e tente novamente.', code: 'csrf_invalid' });
  }
  next();
}

function createAuthenticationMiddleware(database) {
  return (request, response, next) => {
    const userId = request.session?.userId;
    if (!userId) return unauthenticated(request, response);
    const user = database.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(userId);
    if (!user) {
      request.session.destroy(() => {});
      return unauthenticated(request, response);
    }
    if (user.status !== 'approved') {
      request.session.destroy(() => {});
      const code = `account_${user.status}`;
      const message = user.status === 'pending'
        ? 'Seu cadastro aguarda aprovação do administrador.'
        : 'Seu cadastro foi rejeitado. Entre em contato com o suporte.';
      if (request.originalUrl.split('?')[0].startsWith('/api/')) {
        response.set('Cache-Control', 'no-store');
        return response.status(403).json({ error: message, code });
      }
      return response.redirect(302, `/login.html?status=${encodeURIComponent(user.status)}`);
    }
    request.user = user;
    next();
  };
}

function unauthenticated(request, response) {
  if (request.originalUrl.split('?')[0].startsWith('/api/')) {
    response.set('Cache-Control', 'no-store');
    return response.status(401).json({ error: 'Autenticação necessária.', code: 'unauthenticated' });
  }
  const returnTo = encodeURIComponent(request.originalUrl.startsWith('/') && !request.originalUrl.startsWith('//') ? request.originalUrl : '/');
  return response.redirect(302, `/login.html?next=${returnTo}`);
}

function requireAdministrator(request, response, next) {
  if (request.user?.role === 'admin') return next();
  if (request.originalUrl.split('?')[0].startsWith('/api/')) {
    return response.status(403).json({ error: 'Acesso restrito ao administrador.', code: 'forbidden' });
  }
  response.redirect(302, '/login.html?status=forbidden');
}

function createAuthRouter(database) {
  const router = express.Router();
  const authenticate = createAuthenticationMiddleware(database);

  router.get('/csrf-token', (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (!request.session.csrfToken) request.session.csrfToken = crypto.randomBytes(32).toString('hex');
    response.json({ token: request.session.csrfToken });
  });

  router.post('/register', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    const email = normalizeEmail(request.body?.email);
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const confirmation = typeof request.body?.confirmPassword === 'string' ? request.body.confirmPassword : '';
    if (name.length < 2 || name.length > 120) return response.status(400).json({ error: 'Informe seu nome completo (2 a 120 caracteres).' });
    if (!EMAIL_PATTERN.test(email) || email.length > 254) return response.status(400).json({ error: 'Informe um e-mail válido.' });
    const passwordBytes = Buffer.byteLength(password, 'utf8');
    if (passwordBytes < 12 || passwordBytes > 72) return response.status(400).json({ error: 'A senha deve ter entre 12 e 72 bytes.' });
    if (password !== confirmation) return response.status(400).json({ error: 'As senhas não coincidem.' });
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const result = database.prepare(`
        INSERT INTO users (name, email, password_hash, role, status)
        VALUES (?, ?, ?, 'user', 'pending')
      `).run(name, email, passwordHash);
      response.status(201).json({ id: Number(result.lastInsertRowid), status: 'pending', message: 'Cadastro recebido. Aguarde a aprovação do administrador.' });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: users.email')) {
        return response.status(409).json({ error: 'Este e-mail já possui um cadastro.' });
      }
      response.status(500).json({ error: 'Não foi possível concluir o cadastro.' });
    }
  });

  router.post('/login', async (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    try {
      const email = normalizeEmail(request.body?.email);
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const passwordBytes = Buffer.byteLength(password, 'utf8');
      const bucket = crypto.createHmac('sha256', process.env.SESSION_SECRET)
        .update(`${email.slice(0, 254)}\0${request.ip || request.socket.remoteAddress || ''}`)
        .digest('hex');
      const now = Date.now();
      database.prepare('DELETE FROM auth_attempts WHERE attempted_at < ?').run(now - 24 * 60 * 60 * 1000);
      const attempts = database.prepare('SELECT COUNT(*) AS total FROM auth_attempts WHERE bucket = ? AND attempted_at > ?')
        .get(bucket, now - LOGIN_WINDOW).total;
      if (attempts >= LOGIN_ATTEMPT_LIMIT) {
        return response.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.', code: 'rate_limited' });
      }
      const user = passwordBytes <= 72 && EMAIL_PATTERN.test(email) && email.length <= 254
        ? database.prepare('SELECT id, name, email, password_hash, role, status FROM users WHERE email = ?').get(email)
        : null;
      const validPassword = await bcrypt.compare(passwordBytes <= 72 ? password : '', user?.password_hash || DUMMY_PASSWORD_HASH);
      if (!user || !validPassword) {
        database.prepare('INSERT INTO auth_attempts (bucket, attempted_at) VALUES (?, ?)').run(bucket, now);
        return response.status(401).json({ error: 'E-mail ou senha incorretos.', code: 'invalid_credentials' });
      }
      if (user.status !== 'approved') {
        const pending = user.status === 'pending';
        return response.status(403).json({
          error: pending ? 'Seu cadastro aguarda aprovação do administrador.' : 'Seu cadastro foi rejeitado. Entre em contato com o suporte.',
          code: pending ? 'account_pending' : 'account_rejected',
        });
      }
      database.prepare('DELETE FROM auth_attempts WHERE bucket = ?').run(bucket);
      request.session.regenerate((error) => {
        if (error) return next(error);
        request.session.userId = user.id;
        request.session.csrfToken = crypto.randomBytes(32).toString('hex');
        request.session.save((saveError) => {
          if (saveError) return next(saveError);
          response.json({ redirect: '/' });
        });
      });
    } catch (error) { next(error); }
  });

  router.get('/me', authenticate, (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json(request.user);
  });

  router.post('/logout', authenticate, (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie('drivego.sid', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || Boolean(process.env.WEBSITE_SITE_NAME),
        sameSite: 'lax',
        path: '/',
      });
      response.status(204).end();
    });
  });

  return router;
}

function createAdminRouter(database) {
  const router = express.Router();
  router.get('/users', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json(database.prepare('SELECT id, name, email, role, status, created_at FROM users ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC').all());
  });
  router.patch('/users/:id/status', (request, response) => {
    const userId = Number(request.params.id);
    const status = request.body?.status;
    if (!Number.isSafeInteger(userId) || userId < 1) return response.status(400).json({ error: 'Usuário inválido.' });
    if (!['approved', 'rejected'].includes(status)) return response.status(400).json({ error: 'Status inválido.' });
    const result = database.prepare(`
      UPDATE users SET status = ? WHERE id = ? AND role = 'user' AND status = 'pending'
    `).run(status, userId);
    if (result.changes !== 1) return response.status(404).json({ error: 'Cadastro pendente não encontrado.' });
    response.json({ id: userId, status });
  });
  return router;
}

module.exports = {
  createAdminRouter,
  createAuthRouter,
  createAuthenticationMiddleware,
  createSessionMiddleware,
  csrfProtection,
  ensureAdminUser,
  requireAdministrator,
};
