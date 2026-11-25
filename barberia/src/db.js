import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';

// Orari predefiniti: chiave = giorno della settimana (0 = domenica ... 6 = sabato)
export const DEFAULT_HOURS = {
  0: [],
  1: [],
  2: [['08:00', '13:00'], ['15:00', '20:00']],
  3: [['08:00', '13:00'], ['15:00', '20:00']],
  4: [['08:00', '13:00'], ['15:00', '20:00']],
  5: [['08:00', '13:00'], ['15:00', '20:00']],
  6: [['08:00', '13:00'], ['15:00', '20:00']],
};

export const DEFAULT_SETTINGS = {
  hours: DEFAULT_HOURS,
  slotMinutes: 30, // durata di un taglio
  cancelLimitHours: 3, // non si può disdire a meno di N ore
  offerHoldMinutes: 30, // tempo per accettare un posto liberato (coda)
  recurringWeeksAhead: 4, // settimane prenotate in anticipo per il taglio settimanale
  bookingDaysAhead: 60, // fino a quanti giorni in avanti si può prenotare
  shopName: 'Barberia',
};

export function openDb(file = 'barberia.db') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS barbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS closures (
      date TEXT PRIMARY KEY,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      barber_id INTEGER REFERENCES barbers(id),
      flexible INTEGER NOT NULL DEFAULT 1,
      weekday INTEGER NOT NULL,
      time TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_skips (
      recurring_id INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      reason TEXT,
      PRIMARY KEY (recurring_id, date)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      barber_id INTEGER NOT NULL REFERENCES barbers(id),
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'manual',
      recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
      guest_name TEXT,
      created_at INTEGER NOT NULL,
      cancelled_at INTEGER
    );
    -- Regola: un blocco orario prenotato è bloccato per tutti gli altri.
    CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_unique
      ON bookings(barber_id, date, time) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      barber_id INTEGER REFERENCES barbers(id),
      time_from TEXT,
      time_to TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at INTEGER NOT NULL
    );

    -- Posto liberato riservato temporaneamente al primo cliente in coda
    CREATE TABLE IF NOT EXISTS holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barber_id INTEGER NOT NULL REFERENCES barbers(id),
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      waitlist_id INTEGER REFERENCES waitlist(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS holds_slot_unique
      ON holds(barber_id, date, time) WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);

  // Valori iniziali
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, JSON.stringify(v));

  const barberCount = db.prepare('SELECT COUNT(*) AS n FROM barbers').get().n;
  if (barberCount === 0) {
    db.prepare('INSERT INTO barbers(name) VALUES (?)').run('Postazione 1');
    db.prepare('INSERT INTO barbers(name) VALUES (?)').run('Postazione 2');
  }

  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (!admin) {
    const pwd = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare(
      "INSERT INTO users(name, phone, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)"
    ).run('Gestore', 'admin', hashPassword(pwd), Date.now());
  }

  return db;
}
