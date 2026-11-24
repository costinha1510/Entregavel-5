const express = require('express');
const path = require('node:path');
const { createDatabase } = require('./src/database');
const { createApiRouter } = require('./src/api');
const { createAuthRouter, createSessionMiddleware, ensureAdminUser, requireAuthentication } = require('./src/auth');

const app = express();
const port = process.env.PORT || 3000;
const publicDirectory = path.join(__dirname, 'public');
const database = createDatabase();

app.disable('x-powered-by');
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.WEBSITE_SITE_NAME);
if (isProduction) app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(createSessionMiddleware(database));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.get('/login.html', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.sendFile(path.join(publicDirectory, 'login.html'));
});
app.get('/css/styles.css', (_request, response) => response.sendFile(path.join(publicDirectory, 'css', 'styles.css')));
app.use('/api/auth', createAuthRouter(database));
app.use('/api/auth', requireAuthentication);
app.use('/api', requireAuthentication, createApiRouter(database));
app.use(requireAuthentication);
app.use(express.static(publicDirectory));

app.use((_request, response) => {
  response.status(404).sendFile(path.join(publicDirectory, '404.html'));
});

ensureAdminUser(database).then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`DriveGo disponivel na porta ${port}`);
  });
}).catch((error) => {
  console.error(`Falha ao configurar autenticação: ${error.message}`);
  process.exitCode = 1;
});
