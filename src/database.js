const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createDatabase() {
  const defaultPath = process.env.WEBSITE_SITE_NAME
    ? '/home/data/drivego.sqlite'
    : path.join(__dirname, '..', 'data', 'drivego.sqlite');
  const databasePath = path.resolve(process.env.DRIVEGO_DB_PATH || defaultPath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  console.log(`SQLite database: ${databasePath}`);

  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER NOT NULL,
      plate TEXT NOT NULL UNIQUE COLLATE NOCASE,
      category TEXT NOT NULL,
      daily_rate REAL NOT NULL CHECK (daily_rate >= 0),
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'maintenance')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      document TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rentals (
      id INTEGER PRIMARY KEY,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      daily_rate REAL NOT NULL CHECK (daily_rate >= 0),
      status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'active', 'completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (end_date >= start_date)
    );
    CREATE INDEX IF NOT EXISTS rentals_vehicle_dates ON rentals(vehicle_id, start_date, end_date, status);
    CREATE INDEX IF NOT EXISTS rentals_client ON rentals(client_id);
  `);

  const userTable = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  const userColumns = userTable ? new Set(database.prepare('PRAGMA table_info(users)').all().map((column) => column.name)) : new Set();
  const createUsers = () => database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (!userTable) {
    createUsers();
  } else if (!userColumns.has('name') || !userColumns.has('status') || !userTable.sql.includes("'user'")) {
    const nameExpression = userColumns.has('name') ? 'COALESCE(name, email)' : 'email';
    const roleExpression = userColumns.has('role') ? "CASE WHEN role = 'admin' THEN 'admin' ELSE 'user' END" : "'admin'";
    const statusExpression = userColumns.has('status')
      ? "CASE WHEN status IN ('pending', 'approved', 'rejected') THEN status ELSE 'approved' END"
      : "'approved'";
    const createdExpression = userColumns.has('created_at') ? 'created_at' : 'CURRENT_TIMESTAMP';
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec('ALTER TABLE users RENAME TO users_legacy;');
      createUsers();
      database.exec(`
        INSERT INTO users (id, name, email, password_hash, role, status, created_at)
        SELECT id, ${nameExpression}, email, password_hash, ${roleExpression}, ${statusExpression}, ${createdExpression}
        FROM users_legacy;
        DROP TABLE users_legacy;
      `);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_attempts (
      bucket TEXT NOT NULL,
      attempted_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_attempts_window ON auth_attempts(bucket, attempted_at);
  `);
  return database;
}

module.exports = { createDatabase };
