const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createDatabase() {
  const defaultPath = process.env.WEBSITE_SITE_NAME
    ? path.join(process.env.HOME || '/home', 'data', 'drivego.sqlite')
    : path.join(__dirname, '..', 'data', 'drivego.sqlite');
  const databasePath = process.env.DRIVEGO_DB_PATH || defaultPath;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

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
  return database;
}

module.exports = { createDatabase };
