const express = require('express');
const path = require('node:path');
const { createDatabase } = require('./src/database');
const { createApiRouter } = require('./src/api');

const app = express();
const port = process.env.PORT || 3000;
const publicDirectory = path.join(__dirname, 'public');
const database = createDatabase();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use('/api', createApiRouter(database));
app.use(express.static(publicDirectory));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.use((_request, response) => {
  response.status(404).sendFile(path.join(publicDirectory, '404.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`DriveGo disponivel na porta ${port}`);
});
