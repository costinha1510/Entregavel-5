const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');

const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-drivego-password', 12);

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
  if (process.env.AZURE_AUTH_ENABLED === 'true') return;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Configure ADMIN_EMAIL e ADMIN_PASSWORD antes de iniciar a aplicação.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL precisa conter um endereço de e-mail válido.');
  }
  const passwordBytes = Buffer.byteLength(password, 'utf8');
  if (passwordBytes < 12 || passwordBytes > 72) {
    throw new Error('ADMIN_PASSWORD precisa ter entre 12 e 72 bytes para atender aos limites seguros do bcrypt.');
  }
  const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    database.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, passwordHash);
    console.log(`Conta administradora inicial criada para ${email}.`);
  }
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

function createAuthRouter(database) {
  const router = express.Router();
  router.get('/callback', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    try {
      if (process.env.AZURE_AUTH_ENABLED !== 'true' || !process.env.WEBSITE_SITE_NAME) {
        return response.status(503).send('Autenticação Azure não está configurada.');
      }
      const encodedPrincipal = request.get('x-ms-client-principal');
      if (!encodedPrincipal) return response.status(401).send('A Azure não confirmou sua identidade.');
      const principal = JSON.parse(Buffer.from(encodedPrincipal, 'base64').toString('utf8'));
      const claims = principal.claims || [];
      const claim = (...types) => claims.find((item) => types.includes(item.typ))?.val;
      const email = (claim('email', 'preferred_username', 'emails', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress') || '').trim().toLowerCase();
      const objectId = claim('oid', 'sub', 'http://schemas.microsoft.com/identity/claims/objectidentifier');
      if (!email || !objectId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return response.status(401).send('A Azure não retornou um email e identificador válidos.');
      }
      let user = database.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
      if (!user) {
        const result = database.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, `azure:${objectId}`);
        user = { id: Number(result.lastInsertRowid), email };
      }
      request.session.regenerate((error) => {
        if (error) return next(error);
        request.session.userId = user.id;
        request.session.userEmail = user.email;
        request.session.save((saveError) => {
          if (saveError) return next(saveError);
          const nextPath = request.query.next;
          response.redirect(typeof nextPath === 'string' && nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/');
        });
      });
    } catch (error) { next(error); }
  });

  router.post('/login', async (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (process.env.AZURE_AUTH_ENABLED === 'true') {
      return response.status(410).json({ error: 'Use a autenticação Microsoft Entra.' });
    }
    try {
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!email || !password || Buffer.byteLength(password, 'utf8') > 72) {
        return response.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }
      const user = database.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
      const validPassword = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
      if (!user || !validPassword) {
        return response.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }
      request.session.regenerate((error) => {
        if (error) return next(error);
        request.session.userId = user.id;
        request.session.userEmail = user.email;
        request.session.save((saveError) => {
          if (saveError) return next(saveError);
          response.json({ redirect: '/' });
        });
      });
    } catch (error) { next(error); }
  });

  router.post('/logout', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (!request.session.userId) return response.status(401).json({ error: 'Sessão não autenticada.' });
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

function requireAuthentication(request, response, next) {
  if (request.session?.userId) return next();
  if (request.originalUrl.split('?')[0].startsWith('/api/')) {
    response.set('Cache-Control', 'no-store');
    return response.status(401).json({ error: 'Autenticação necessária.' });
  }
  const returnTo = encodeURIComponent(request.originalUrl.startsWith('/') && !request.originalUrl.startsWith('//') ? request.originalUrl : '/');
  response.redirect(302, `/login.html?next=${returnTo}`);
}

module.exports = { createAuthRouter, createSessionMiddleware, ensureAdminUser, requireAuthentication };
