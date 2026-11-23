#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function inspectDatabase(database) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  const records = Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get().count
  ]));
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error(`Falha na verificação de integridade: ${JSON.stringify(integrity)}`);
  }
  return { records, integrity: 'ok' };
}

async function main() {
  if (typeof backup !== 'function') {
    throw new Error('A API sqlite.backup requer Node.js 22.16 ou superior.');
  }

  const source = path.resolve(process.env.DRIVEGO_DB_PATH || path.join(__dirname, '..', 'data', 'drivego.sqlite'));
  const defaultName = `drivego-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const destination = path.resolve(process.argv[2] || path.join(__dirname, '..', 'backups', defaultName));
  if (source === destination) throw new Error('Origem e destino não podem ser o mesmo arquivo.');

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) throw new Error(`O destino já existe; nenhum arquivo foi sobrescrito: ${destination}`);

  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  const sourceDb = new DatabaseSync(source, { readOnly: true });

  try {
    await backup(sourceDb, temporary);
    const backupDb = new DatabaseSync(temporary, { readOnly: true });
    let inspection;
    try {
      inspection = inspectDatabase(backupDb);
    } finally {
      backupDb.close();
    }

    // link() publishes the completed file atomically and fails if the target exists.
    fs.linkSync(temporary, destination);
    fs.unlinkSync(temporary);

    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(destination)) hash.update(chunk);
    console.log(JSON.stringify({
      backup: destination,
      sha256: hash.digest('hex'),
      ...inspection
    }, null, 2));
  } finally {
    sourceDb.close();
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

main().catch((error) => {
  console.error(`Backup não concluído: ${error.message}`);
  process.exitCode = 1;
});
