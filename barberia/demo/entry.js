// Demo: l'app gira interamente nel browser. Le chiamate /api/* sono servite localmente
// dallo stesso codice del server (src/routes.js + src/logic.js) su un database sql.js.
import { openDb } from '../src/db.js';
import { createApi } from '../src/routes.js';
import * as L from '../src/logic.js';
import { hashPassword } from './auth-browser.js';

const KEY = 'barberia-demo-db-v1';
let db, api;

function save() {
  try {
    const bytes = db.db.export();
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    localStorage.setItem(KEY, btoa(s));
  } catch { /* archiviazione non disponibile: la demo resta in memoria */ }
}

function load() {
  try {
    const b64 = localStorage.getItem(KEY);
    if (!b64) return null;
    const s = atob(b64);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  } catch { return null; }
}

function seed() {
  const add = (name, phone) => Number(db.prepare("INSERT INTO users(name, phone, password_hash, role, created_at) VALUES (?, ?, ?, 'client', ?)")
    .run(name, phone, hashPassword('demo123'), Date.now()).lastInsertRowid);
  db.prepare("UPDATE barbers SET name = 'Marco' WHERE id = 1").run();
  db.prepare("UPDATE barbers SET name = 'Davide' WHERE id = 2").run();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'shopName'").run(JSON.stringify('Barberia Demo'));
  const mario = add('Mario Rossi', '3331234567');
  const others = [add('Luca Bianchi', '3332222222'), add('Giorgio Verdi', '3333333333'), add('Paolo Neri', '3334444444'), add('Andrea Galli', '3335555555')];
  // Riempi i prossimi giorni di apertura con alcune prenotazioni realistiche
  const cal = L.calendar(db, 10).filter((d) => d.open);
  let k = 0;
  for (const [i, day] of cal.slice(0, 4).entries()) {
    const times = L.slotTimesForDate(db, day.date);
    for (const [j, t] of times.entries()) {
      if ((j * 7 + i * 3) % 5 > (i === 0 ? 3 : 1)) continue;
      for (const barberId of [1, 2]) {
        if ((j + barberId + i) % 3 === 0) continue;
        try { L.createBooking(db, { userId: others[k++ % others.length], barberId, date: day.date, time: t }); } catch { /* orario passato */ }
      }
    }
  }
  try { L.createRecurring(db, { userId: mario, barberId: 1, flexible: true, weekday: L.weekdayOf(cal[2].date), time: '18:00' }); } catch { /* ignora */ }
  try { L.addToWaitlist(db, { userId: others[0], date: cal[1].date }); } catch { /* ignora */ }
  L.notify(db, mario, 'Benvenuto nella demo! Prova a prenotare, metterti in coda o attivare il taglio settimanale.');
}

globalThis.__demoReady = (async () => {
  globalThis.__SQL = await globalThis.initSqlJs();
  globalThis.__DEMO_SAVED = load();
  db = openDb(':memory:');
  if (!globalThis.__DEMO_SAVED) seed();
  L.generateRecurring(db);
  api = createApi(db);
  save();
  setInterval(() => { try { L.tx(db, () => L.expireHolds(db)); save(); } catch { /* ignora */ } }, 30000);
})();

globalThis.__demoReset = () => { try { localStorage.removeItem(KEY); localStorage.removeItem('token'); } catch { /* ignora */ } location.reload(); };

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  await globalThis.__demoReady;
  const method = (init.method || 'GET').toUpperCase();
  const r = await api.handle({
    method, pathname: url.pathname, query: url.searchParams,
    body: init.body ? JSON.parse(init.body) : {},
    authorization: init.headers?.Authorization || init.headers?.authorization,
  });
  if (method !== 'GET') save();
  return new Response(JSON.stringify(r.data), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

document.getElementById('demo-reset')?.addEventListener('click', () => globalThis.__demoReset());
