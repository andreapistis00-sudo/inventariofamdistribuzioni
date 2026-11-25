import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { hashPassword, verifyPassword, newToken } from './src/auth.js';
import * as L from './src/logic.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const db = openDb(process.env.DB_FILE || join(ROOT, 'barberia.db'));

// ---------- Routing minimale ----------
const routes = [];
const route = (method, path, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, ...opts });
};

function currentUser(req) {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  return db.prepare('SELECT u.id, u.name, u.phone, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(m[1]) || null;
}

const publicUser = (u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role });
const normPhone = (p) => String(p || '').replace(/[\s.\-()]/g, '');

// ---------- Autenticazione ----------
route('POST', '/api/register', ({ body }) => {
  const name = String(body.name || '').trim();
  const phone = normPhone(body.phone);
  const password = String(body.password || '');
  if (name.length < 2) throw new L.AppError(400, 'Inserisci nome e cognome');
  if (!/^\+?\d{6,15}$/.test(phone)) throw new L.AppError(400, 'Numero di telefono non valido');
  if (password.length < 6) throw new L.AppError(400, 'La password deve avere almeno 6 caratteri');
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new L.AppError(409, 'Esiste già un account con questo numero');
  const r = db.prepare("INSERT INTO users(name, phone, password_hash, role, created_at) VALUES (?, ?, ?, 'client', ?)")
    .run(name, phone, hashPassword(password), Date.now());
  const token = newToken();
  db.prepare('INSERT INTO sessions(token, user_id, created_at) VALUES (?, ?, ?)').run(token, r.lastInsertRowid, Date.now());
  return { token, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) };
}, { auth: false });

route('POST', '/api/login', ({ body }) => {
  const login = String(body.phone || '').trim();
  const u = db.prepare('SELECT * FROM users WHERE phone = ? OR phone = ?').get(login, normPhone(login));
  if (!u || !verifyPassword(String(body.password || ''), u.password_hash)) throw new L.AppError(401, 'Credenziali non valide');
  const token = newToken();
  db.prepare('INSERT INTO sessions(token, user_id, created_at) VALUES (?, ?, ?)').run(token, u.id, Date.now());
  return { token, user: publicUser(u) };
}, { auth: false });

route('POST', '/api/logout', ({ req }) => {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
  return { ok: true };
});

route('GET', '/api/me', ({ user }) => ({ user: publicUser(user) }));

route('POST', '/api/password', ({ user, body }) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(String(body.oldPassword || ''), u.password_hash)) throw new L.AppError(400, 'Password attuale errata');
  if (String(body.newPassword || '').length < 6) throw new L.AppError(400, 'La nuova password deve avere almeno 6 caratteri');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.newPassword), u.id);
  return { ok: true };
});

// ---------- Informazioni pubbliche ----------
route('GET', '/api/config', () => {
  const s = L.getSettings(db);
  return {
    shopName: s.shopName, hours: s.hours, slotMinutes: s.slotMinutes, cancelLimitHours: s.cancelLimitHours,
    offerHoldMinutes: s.offerHoldMinutes, recurringWeeksAhead: s.recurringWeeksAhead, bookingDaysAhead: s.bookingDaysAhead,
    barbers: L.activeBarbers(db), weekdays: L.WEEKDAYS, today: L.todayStr(),
    weekdaySlots: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, L.slotTimesForWeekday(db, d)])),
  };
}, { auth: false });

route('GET', '/api/calendar', ({ query }) => L.calendar(db, query.get('days')), { auth: false });
route('GET', '/api/slots', ({ query, user }) => L.daySlots(db, query.get('date'), user?.id), { auth: 'optional' });

// ---------- Cliente ----------
route('POST', '/api/bookings', ({ user, body }) =>
  L.createBooking(db, { userId: user.id, barberId: body.barberId, date: body.date, time: body.time }));
route('GET', '/api/my/bookings', ({ user }) => L.userBookings(db, user.id));
route('DELETE', '/api/bookings/:id', ({ user, params }) =>
  L.cancelBooking(db, { bookingId: params.id, userId: user.id, isAdmin: user.role === 'admin' }));

route('POST', '/api/waitlist', ({ user, body }) =>
  L.addToWaitlist(db, { userId: user.id, date: body.date, barberId: body.barberId, timeFrom: body.timeFrom, timeTo: body.timeTo }));
route('GET', '/api/my/waitlist', ({ user }) => L.userWaitlist(db, user.id));
route('DELETE', '/api/waitlist/:id', ({ user, params }) =>
  L.removeFromWaitlist(db, { id: params.id, userId: user.id, isAdmin: user.role === 'admin' }));

route('GET', '/api/my/offers', ({ user }) => L.userOffers(db, user.id));
route('POST', '/api/offers/:id/accept', ({ user, params }) => L.acceptOffer(db, { holdId: params.id, userId: user.id }));
route('POST', '/api/offers/:id/decline', ({ user, params }) => L.declineOffer(db, { holdId: params.id, userId: user.id }));

route('POST', '/api/recurring', ({ user, body }) =>
  L.createRecurring(db, { userId: user.id, barberId: body.barberId, flexible: body.flexible !== false, weekday: body.weekday, time: body.time }));
route('GET', '/api/my/recurring', ({ user }) => L.userRecurring(db, user.id));
route('DELETE', '/api/recurring/:id', ({ user, params }) =>
  L.cancelRecurring(db, { id: params.id, userId: user.id, isAdmin: user.role === 'admin' }));

route('GET', '/api/my/notifications', ({ user }) =>
  db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id));
route('POST', '/api/my/notifications/read', ({ user }) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(user.id);
  return { ok: true };
});

// ---------- Gestore ----------
const admin = { admin: true };
route('GET', '/api/admin/agenda', ({ query }) => L.adminAgenda(db, query.get('date')), admin);
route('GET', '/api/admin/settings', () => L.getSettings(db), admin);
route('PUT', '/api/admin/settings', ({ body }) => L.updateSettings(db, body), admin);

route('GET', '/api/admin/barbers', () => db.prepare('SELECT * FROM barbers ORDER BY id').all(), admin);
route('PUT', '/api/admin/barbers/:id', ({ params, body }) => {
  const name = String(body.name || '').trim();
  if (!name || name.length > 40) throw new L.AppError(400, 'Nome non valido');
  db.prepare('UPDATE barbers SET name = ? WHERE id = ?').run(name, Number(params.id));
  return db.prepare('SELECT * FROM barbers WHERE id = ?').get(Number(params.id));
}, admin);

route('GET', '/api/admin/closures', () =>
  db.prepare('SELECT * FROM closures WHERE date >= ? ORDER BY date').all(L.todayStr()), admin);
route('POST', '/api/admin/closures', ({ body }) => L.addClosure(db, body), admin);
route('DELETE', '/api/admin/closures/:date', ({ params }) => {
  db.prepare('DELETE FROM closures WHERE date = ?').run(params.date);
  L.generateRecurring(db);
  return { ok: true };
}, admin);

route('POST', '/api/admin/bookings', ({ user, body }) => {
  const guestName = String(body.guestName || '').trim();
  if (!guestName) throw new L.AppError(400, 'Inserisci il nome del cliente');
  return L.createBooking(db, { userId: user.id, barberId: body.barberId, date: body.date, time: body.time, source: 'admin', guestName, isAdmin: true });
}, admin);

route('GET', '/api/admin/recurring', () => db.prepare(`
  SELECT r.*, u.name AS user_name, u.phone AS user_phone, br.name AS barber_name FROM recurring r
  JOIN users u ON u.id = r.user_id LEFT JOIN barbers br ON br.id = r.barber_id
  WHERE r.active = 1 ORDER BY r.weekday, r.time`).all(), admin);

route('GET', '/api/admin/clients', () => db.prepare(`
  SELECT u.id, u.name, u.phone, u.created_at,
    (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status = 'active') AS bookings
  FROM users u WHERE u.role = 'client' ORDER BY u.name`).all(), admin);

// ---------- Server HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1e5) throw new L.AppError(413, 'Richiesta troppo grande');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new L.AppError(400, 'JSON non valido'); }
}

async function serveStatic(req, res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    const data = await readFile(join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new L.AppError(404, 'Risorsa non trovata');
    const m = r.re.exec(url.pathname);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const user = currentUser(req);
    if (r.auth !== false && r.auth !== 'optional' && !user) throw new L.AppError(401, 'Accesso richiesto');
    if (r.admin && user.role !== 'admin') throw new L.AppError(403, 'Riservato al gestore');
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    L.tx(db, () => L.expireHolds(db));
    send(res, 200, await r.handler({ req, params, query: url.searchParams, body, user }));
  } catch (e) {
    if (e instanceof L.AppError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Errore interno del server' });
  }
});

// Manutenzione periodica: scadenza delle offerte della coda e tagli settimanali
setInterval(() => { try { L.tx(db, () => L.expireHolds(db)); } catch (e) { console.error(e); } }, 60_000).unref();
setInterval(() => { try { L.generateRecurring(db); } catch (e) { console.error(e); } }, 60 * 60_000).unref();
L.generateRecurring(db);

server.listen(PORT, () => console.log(`Barberia in ascolto su http://localhost:${PORT}`));
