// Regole di business della barberia.
// Tutte le date sono stringhe "YYYY-MM-DD" e gli orari "HH:MM" nell'ora locale del negozio.
process.env.TZ = process.env.BARBER_TZ || 'Europe/Rome';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Orologio (sostituibile nei test) ----------
let clock = () => Date.now();
export function setClock(fn) { clock = fn; }
export const now = () => clock();

// ---------- Utilità per date e orari ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

export function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
export const isTime = (s) => typeof s === 'string' && TIME_RE.test(s);

export function slotEpoch(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
}
export function toDateStr(dt) {
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
export const todayStr = () => toDateStr(new Date(now()));
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}
export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function formatDate(date) {
  const [y, m, d] = date.split('-');
  return `${WEEKDAYS[weekdayOf(date)].toLowerCase()} ${d}/${m}/${y}`;
}

// ---------- Impostazioni ----------
export function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = JSON.parse(r.value);
  return out;
}
export const getSetting = (db, key) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : undefined;
};

export function validateHours(hours) {
  if (!hours || typeof hours !== 'object') throw new AppError(400, 'Orari non validi');
  const clean = {};
  for (let wd = 0; wd < 7; wd++) {
    const list = hours[wd] ?? hours[String(wd)] ?? [];
    if (!Array.isArray(list)) throw new AppError(400, `Orari non validi per ${WEEKDAYS[wd]}`);
    const intervals = list.map((iv) => {
      if (!Array.isArray(iv) || !isTime(iv[0]) || !isTime(iv[1])) throw new AppError(400, `Fascia oraria non valida per ${WEEKDAYS[wd]}`);
      if (toMin(iv[0]) >= toMin(iv[1])) throw new AppError(400, `${WEEKDAYS[wd]}: l'orario di fine deve essere dopo l'inizio`);
      return [iv[0], iv[1]];
    }).sort((a, b) => toMin(a[0]) - toMin(b[0]));
    for (let i = 1; i < intervals.length; i++) {
      if (toMin(intervals[i][0]) < toMin(intervals[i - 1][1])) throw new AppError(400, `${WEEKDAYS[wd]}: le fasce orarie si sovrappongono`);
    }
    clean[wd] = intervals;
  }
  return clean;
}

export function updateSettings(db, patch) {
  const allowed = {
    hours: (v) => validateHours(v),
    slotMinutes: (v) => { if (![15, 20, 30, 45, 60].includes(Number(v))) throw new AppError(400, 'Durata taglio non valida'); return Number(v); },
    cancelLimitHours: (v) => { const n = Number(v); if (!(n >= 0 && n <= 72)) throw new AppError(400, 'Limite disdetta non valido'); return n; },
    offerHoldMinutes: (v) => { const n = Number(v); if (!(n >= 5 && n <= 1440)) throw new AppError(400, 'Tempo di riserva non valido'); return n; },
    recurringWeeksAhead: (v) => { const n = Number(v); if (!(Number.isInteger(n) && n >= 1 && n <= 12)) throw new AppError(400, 'Settimane in anticipo non valide'); return n; },
    bookingDaysAhead: (v) => { const n = Number(v); if (!(Number.isInteger(n) && n >= 1 && n <= 365)) throw new AppError(400, 'Giorni prenotabili non validi'); return n; },
    shopName: (v) => { const s = String(v || '').trim(); if (!s || s.length > 60) throw new AppError(400, 'Nome negozio non valido'); return s; },
  };
  const upd = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch || {})) {
    if (!allowed[k]) continue;
    upd.run(k, JSON.stringify(allowed[k](v)));
  }
  generateRecurring(db);
  return getSettings(db);
}

// ---------- Calendario ----------
export function isClosed(db, date) {
  return !!db.prepare('SELECT 1 FROM closures WHERE date = ?').get(date);
}

/** Orari di inizio dei tagli per un giorno della settimana secondo gli orari di lavoro. */
export function slotTimesForWeekday(db, weekday) {
  const hours = getSetting(db, 'hours');
  const step = getSetting(db, 'slotMinutes');
  const out = [];
  for (const [start, end] of hours[weekday] || []) {
    for (let t = toMin(start); t + step <= toMin(end); t += step) out.push(fromMin(t));
  }
  return out;
}

export function slotTimesForDate(db, date) {
  if (isClosed(db, date)) return [];
  return slotTimesForWeekday(db, weekdayOf(date));
}

export const activeBarbers = (db) => db.prepare('SELECT id, name FROM barbers WHERE active = 1 ORDER BY id').all();

/** Stato di ogni blocco per ogni postazione in una data. */
export function daySlots(db, date, viewerId = null) {
  if (!isDate(date)) throw new AppError(400, 'Data non valida');
  const times = slotTimesForDate(db, date);
  const booked = db.prepare("SELECT barber_id, time, user_id FROM bookings WHERE date = ? AND status = 'active'").all(date);
  const holds = db.prepare("SELECT barber_id, time, user_id, id, expires_at FROM holds WHERE date = ? AND status = 'pending'").all(date);
  const t = now();
  return activeBarbers(db).map((b) => ({
    barberId: b.id,
    barberName: b.name,
    slots: times.map((time) => {
      const bk = booked.find((x) => x.barber_id === b.id && x.time === time);
      const hd = holds.find((x) => x.barber_id === b.id && x.time === time);
      let status = 'free';
      if (bk) status = viewerId && bk.user_id === viewerId ? 'mine' : 'booked';
      else if (hd) status = viewerId && hd.user_id === viewerId ? 'offered' : 'held';
      else if (slotEpoch(date, time) <= t) status = 'past';
      return { time, status, ...(status === 'offered' ? { holdId: hd.id, expiresAt: hd.expires_at } : {}) };
    }),
  }));
}

export function calendar(db, days) {
  const max = getSetting(db, 'bookingDaysAhead');
  const n = Math.min(Number(days) || 21, max + 1);
  const start = todayStr();
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    const closure = db.prepare('SELECT reason FROM closures WHERE date = ?').get(date);
    const slots = daySlots(db, date);
    const total = slots.reduce((s, b) => s + b.slots.filter((x) => x.status !== 'past').length, 0);
    const free = slots.reduce((s, b) => s + b.slots.filter((x) => x.status === 'free').length, 0);
    out.push({ date, weekday: weekdayOf(date), open: total > 0 || slots.some((b) => b.slots.length), closedReason: closure?.reason ?? null, free, total });
  }
  return out;
}

// ---------- Notifiche ----------
export function notify(db, userId, message) {
  db.prepare('INSERT INTO notifications(user_id, message, created_at) VALUES (?, ?, ?)').run(userId, message, now());
}

// ---------- Transazioni ----------
let txDepth = 0;
export function tx(db, fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    db.exec('COMMIT');
    return r;
  } catch (e) {
    txDepth--;
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Prenotazioni ----------
export function createBooking(db, { userId, barberId, date, time, source = 'manual', recurringId = null, guestName = null, isAdmin = false }) {
  return tx(db, () => {
    expireHolds(db);
    if (!isDate(date) || !isTime(time)) throw new AppError(400, 'Data o orario non validi');
    barberId = Number(barberId);
    const barber = db.prepare('SELECT id, name FROM barbers WHERE id = ? AND active = 1').get(barberId);
    if (!barber) throw new AppError(400, 'Postazione non valida');
    if (!slotTimesForDate(db, date).includes(time)) throw new AppError(400, 'Orario fuori dagli orari di apertura');
    if (slotEpoch(date, time) <= now()) throw new AppError(400, 'Non puoi prenotare un orario già passato');
    const maxDate = addDays(todayStr(), getSetting(db, 'bookingDaysAhead'));
    if (!isAdmin && date > maxDate) throw new AppError(400, 'Data troppo lontana per prenotare');

    const taken = db.prepare("SELECT 1 FROM bookings WHERE barber_id = ? AND date = ? AND time = ? AND status = 'active'").get(barberId, date, time);
    if (taken) throw new AppError(409, 'Questo orario è già prenotato');

    const hold = db.prepare("SELECT * FROM holds WHERE barber_id = ? AND date = ? AND time = ? AND status = 'pending'").get(barberId, date, time);
    if (hold && hold.user_id !== userId) throw new AppError(409, 'Questo posto è riservato a un cliente in coda');

    if (!guestName) {
      const clash = db.prepare("SELECT 1 FROM bookings WHERE user_id = ? AND date = ? AND time = ? AND status = 'active'").get(userId, date, time);
      if (clash) throw new AppError(409, 'Hai già un appuntamento a quest\'ora');
    }

    if (hold) {
      db.prepare("UPDATE holds SET status = 'accepted' WHERE id = ?").run(hold.id);
      if (hold.waitlist_id) db.prepare("UPDATE waitlist SET status = 'fulfilled' WHERE id = ?").run(hold.waitlist_id);
      source = 'waitlist';
    }

    try {
      const r = db.prepare(
        'INSERT INTO bookings(user_id, barber_id, date, time, source, recurring_id, guest_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(userId, barberId, date, time, source, recurringId, guestName, now());
      return getBooking(db, Number(r.lastInsertRowid));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new AppError(409, 'Questo orario è già prenotato');
      throw e;
    }
  });
}

export function getBooking(db, id) {
  return db.prepare(`
    SELECT b.*, br.name AS barber_name, u.name AS user_name, u.phone AS user_phone
    FROM bookings b JOIN barbers br ON br.id = b.barber_id JOIN users u ON u.id = b.user_id
    WHERE b.id = ?`).get(id);
}

export function canCancel(db, booking) {
  const limitMs = getSetting(db, 'cancelLimitHours') * 3600 * 1000;
  return booking.status === 'active' && slotEpoch(booking.date, booking.time) - now() >= limitMs;
}

export function cancelBooking(db, { bookingId, userId, isAdmin = false }) {
  return tx(db, () => {
    const b = getBooking(db, Number(bookingId));
    if (!b || (!isAdmin && b.user_id !== userId)) throw new AppError(404, 'Prenotazione non trovata');
    if (b.status !== 'active') throw new AppError(400, 'Prenotazione già annullata');
    if (!isAdmin && !canCancel(db, b)) {
      const h = getSetting(db, 'cancelLimitHours');
      throw new AppError(403, `Non puoi disdire a meno di ${h} ore dall'appuntamento. Contatta la barberia.`);
    }
    db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(now(), b.id);
    if (isAdmin && b.user_id !== userId && !b.guest_name) {
      notify(db, b.user_id, `La barberia ha annullato il tuo appuntamento di ${formatDate(b.date)} alle ${b.time} con ${b.barber_name}.`);
    }
    releaseSlot(db, b.barber_id, b.date, b.time);
    return { ok: true };
  });
}

export function userBookings(db, userId) {
  const rows = db.prepare(`
    SELECT b.*, br.name AS barber_name FROM bookings b JOIN barbers br ON br.id = b.barber_id
    WHERE b.user_id = ? AND b.status = 'active' ORDER BY b.date, b.time`).all(userId);
  const t = now();
  return rows.map((b) => ({ ...b, past: slotEpoch(b.date, b.time) <= t, canCancel: canCancel(db, b) }));
}

// ---------- Coda (lista d'attesa) ----------
export function addToWaitlist(db, { userId, date, barberId = null, timeFrom = null, timeTo = null }) {
  return tx(db, () => {
    if (!isDate(date)) throw new AppError(400, 'Data non valida');
    if (date < todayStr()) throw new AppError(400, 'Data già passata');
    if (barberId) {
      barberId = Number(barberId);
      if (!db.prepare('SELECT 1 FROM barbers WHERE id = ? AND active = 1').get(barberId)) throw new AppError(400, 'Postazione non valida');
    } else barberId = null;
    timeFrom = timeFrom || null;
    timeTo = timeTo || null;
    if ((timeFrom && !isTime(timeFrom)) || (timeTo && !isTime(timeTo))) throw new AppError(400, 'Fascia oraria non valida');
    if (timeFrom && timeTo && timeFrom > timeTo) throw new AppError(400, 'Fascia oraria non valida');
    const times = slotTimesForDate(db, date).filter((t) => (!timeFrom || t >= timeFrom) && (!timeTo || t <= timeTo) && slotEpoch(date, t) > now());
    if (!times.length) throw new AppError(400, 'Nessun orario di apertura disponibile in quella fascia');
    const dup = db.prepare("SELECT 1 FROM waitlist WHERE user_id = ? AND date = ? AND status IN ('waiting','offered')").get(userId, date);
    if (dup) throw new AppError(409, 'Sei già in coda per questo giorno');
    const r = db.prepare('INSERT INTO waitlist(user_id, date, barber_id, time_from, time_to, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, date, barberId, timeFrom, timeTo, now());
    const id = Number(r.lastInsertRowid);
    const position = db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE date = ? AND status IN ('waiting','offered') AND id <= ?").get(date, id).n;
    return { id, position };
  });
}

export function removeFromWaitlist(db, { id, userId, isAdmin = false }) {
  return tx(db, () => {
    const w = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(Number(id));
    if (!w || (!isAdmin && w.user_id !== userId)) throw new AppError(404, 'Richiesta non trovata');
    db.prepare("UPDATE waitlist SET status = 'cancelled' WHERE id = ?").run(w.id);
    const holds = db.prepare("SELECT * FROM holds WHERE waitlist_id = ? AND status = 'pending'").all(w.id);
    for (const h of holds) {
      db.prepare("UPDATE holds SET status = 'declined' WHERE id = ?").run(h.id);
      releaseSlot(db, h.barber_id, h.date, h.time);
    }
    return { ok: true };
  });
}

export function userWaitlist(db, userId) {
  return db.prepare(`
    SELECT w.*, br.name AS barber_name,
      (SELECT COUNT(*) FROM waitlist w2 WHERE w2.date = w.date AND w2.status IN ('waiting','offered') AND w2.id <= w.id) AS position
    FROM waitlist w LEFT JOIN barbers br ON br.id = w.barber_id
    WHERE w.user_id = ? AND w.status IN ('waiting','offered') AND w.date >= ?
    ORDER BY w.date`).all(userId, todayStr());
}

/**
 * Un posto si è liberato: lo si offre al primo cliente in coda compatibile.
 * Il posto resta riservato a lui per `offerHoldMinutes`, poi passa al successivo.
 */
export function releaseSlot(db, barberId, date, time) {
  const slotT = slotEpoch(date, time);
  if (slotT <= now()) return null;
  if (!slotTimesForDate(db, date).includes(time)) return null;
  if (db.prepare("SELECT 1 FROM bookings WHERE barber_id = ? AND date = ? AND time = ? AND status = 'active'").get(barberId, date, time)) return null;
  if (db.prepare("SELECT 1 FROM holds WHERE barber_id = ? AND date = ? AND time = ? AND status = 'pending'").get(barberId, date, time)) return null;

  const candidates = db.prepare(`
    SELECT * FROM waitlist
    WHERE status = 'waiting' AND date = ?
      AND (barber_id IS NULL OR barber_id = ?)
      AND (time_from IS NULL OR time_from <= ?)
      AND (time_to IS NULL OR time_to >= ?)
    ORDER BY created_at, id`).all(date, barberId, time, time);

  for (const w of candidates) {
    const busy = db.prepare("SELECT 1 FROM bookings WHERE user_id = ? AND date = ? AND time = ? AND status = 'active'").get(w.user_id, date, time);
    if (busy) continue;
    const alreadyRefused = db.prepare("SELECT 1 FROM holds WHERE user_id = ? AND barber_id = ? AND date = ? AND time = ? AND status IN ('declined','expired')").get(w.user_id, barberId, date, time);
    if (alreadyRefused) continue;
    const expires = Math.min(now() + getSetting(db, 'offerHoldMinutes') * 60000, slotT);
    const r = db.prepare('INSERT INTO holds(barber_id, date, time, user_id, waitlist_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(barberId, date, time, w.user_id, w.id, expires, now());
    db.prepare("UPDATE waitlist SET status = 'offered' WHERE id = ?").run(w.id);
    const barber = db.prepare('SELECT name FROM barbers WHERE id = ?').get(barberId);
    const until = new Date(expires);
    notify(db, w.user_id, `Si è liberato un posto! ${formatDate(date)} alle ${time} con ${barber.name}. Hai tempo fino alle ${fromMin(until.getHours() * 60 + until.getMinutes())} per accettarlo.`);
    return Number(r.lastInsertRowid);
  }
  return null;
}

export function expireHolds(db) {
  const expired = db.prepare("SELECT * FROM holds WHERE status = 'pending' AND expires_at <= ?").all(now());
  for (const h of expired) {
    db.prepare("UPDATE holds SET status = 'expired' WHERE id = ?").run(h.id);
    if (h.waitlist_id) db.prepare("UPDATE waitlist SET status = 'waiting' WHERE id = ? AND status = 'offered'").run(h.waitlist_id);
    notify(db, h.user_id, `L'offerta per ${formatDate(h.date)} alle ${h.time} è scaduta ed è passata al cliente successivo. Resti in coda.`);
    releaseSlot(db, h.barber_id, h.date, h.time);
  }
  return expired.length;
}

export function userOffers(db, userId) {
  return db.prepare(`
    SELECT h.*, br.name AS barber_name FROM holds h JOIN barbers br ON br.id = h.barber_id
    WHERE h.user_id = ? AND h.status = 'pending' AND h.expires_at > ? ORDER BY h.date, h.time`).all(userId, now());
}

export function acceptOffer(db, { holdId, userId }) {
  return tx(db, () => {
    expireHolds(db);
    const h = db.prepare('SELECT * FROM holds WHERE id = ?').get(Number(holdId));
    if (!h || h.user_id !== userId) throw new AppError(404, 'Offerta non trovata');
    if (h.status !== 'pending') throw new AppError(410, 'Offerta scaduta o non più valida');
    return createBooking(db, { userId, barberId: h.barber_id, date: h.date, time: h.time, source: 'waitlist' });
  });
}

export function declineOffer(db, { holdId, userId }) {
  return tx(db, () => {
    const h = db.prepare('SELECT * FROM holds WHERE id = ?').get(Number(holdId));
    if (!h || h.user_id !== userId) throw new AppError(404, 'Offerta non trovata');
    if (h.status !== 'pending') throw new AppError(410, 'Offerta non più valida');
    db.prepare("UPDATE holds SET status = 'declined' WHERE id = ?").run(h.id);
    if (h.waitlist_id) db.prepare("UPDATE waitlist SET status = 'waiting' WHERE id = ? AND status = 'offered'").run(h.waitlist_id);
    releaseSlot(db, h.barber_id, h.date, h.time);
    return { ok: true };
  });
}

// ---------- Taglio settimanale automatico ----------
export function createRecurring(db, { userId, barberId = null, flexible = true, weekday, time }) {
  return tx(db, () => {
    weekday = Number(weekday);
    if (!(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) throw new AppError(400, 'Giorno non valido');
    if (!isTime(time)) throw new AppError(400, 'Orario non valido');
    if (!slotTimesForWeekday(db, weekday).includes(time)) throw new AppError(400, `La barberia non lavora ${WEEKDAYS[weekday].toLowerCase()} alle ${time}`);
    if (barberId) {
      barberId = Number(barberId);
      if (!db.prepare('SELECT 1 FROM barbers WHERE id = ? AND active = 1').get(barberId)) throw new AppError(400, 'Postazione non valida');
    } else barberId = null;
    const dup = db.prepare('SELECT 1 FROM recurring WHERE user_id = ? AND weekday = ? AND time = ? AND active = 1').get(userId, weekday, time);
    if (dup) throw new AppError(409, 'Hai già un taglio settimanale in questo giorno e orario');
    const r = db.prepare('INSERT INTO recurring(user_id, barber_id, flexible, weekday, time, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, barberId, flexible ? 1 : 0, weekday, time, now());
    const id = Number(r.lastInsertRowid);
    const result = generateRecurring(db, id, { silent: true });
    return { id, ...result };
  });
}

/** Prenota automaticamente le prossime settimane per i tagli settimanali attivi. */
export function generateRecurring(db, onlyId = null, { silent = false } = {}) {
  return tx(db, () => {
    const weeks = getSetting(db, 'recurringWeeksAhead');
    const rules = onlyId
      ? db.prepare('SELECT * FROM recurring WHERE id = ? AND active = 1').all(onlyId)
      : db.prepare('SELECT * FROM recurring WHERE active = 1').all();
    const booked = [];
    const skipped = [];
    const today = todayStr();
    for (const rule of rules) {
      const first = addDays(today, (rule.weekday - weekdayOf(today) + 7) % 7);
      for (let k = 0; k < weeks; k++) {
        const date = addDays(first, 7 * k);
        if (slotEpoch(date, rule.time) <= now()) continue;
        if (db.prepare('SELECT 1 FROM bookings WHERE recurring_id = ? AND date = ?').get(rule.id, date)) continue;
        if (db.prepare('SELECT 1 FROM recurring_skips WHERE recurring_id = ? AND date = ?').get(rule.id, date)) continue;

        let reason = null;
        if (!slotTimesForDate(db, date).includes(rule.time)) {
          reason = 'barberia chiusa a quell\'ora';
        } else {
          const all = activeBarbers(db).map((b) => b.id);
          const order = rule.barber_id
            ? [rule.barber_id, ...(rule.flexible ? all.filter((id) => id !== rule.barber_id) : [])]
            : all;
          let done = null;
          for (const barberId of order) {
            try {
              done = createBooking(db, { userId: rule.user_id, barberId, date, time: rule.time, source: 'recurring', recurringId: rule.id });
              break;
            } catch (e) {
              if (!(e instanceof AppError)) throw e;
              reason = e.message;
            }
          }
          if (done) {
            booked.push({ date, time: rule.time, barber: done.barber_name });
            if (!silent) notify(db, rule.user_id, `Taglio settimanale prenotato: ${formatDate(date)} alle ${rule.time} con ${done.barber_name}.`);
            continue;
          }
          reason = reason || 'orario occupato';
        }
        db.prepare('INSERT OR IGNORE INTO recurring_skips(recurring_id, date, reason) VALUES (?, ?, ?)').run(rule.id, date, reason);
        skipped.push({ date, time: rule.time, reason });
        if (!silent) notify(db, rule.user_id, `Il taglio settimanale di ${formatDate(date)} alle ${rule.time} non è stato prenotato (${reason}). Puoi scegliere un altro orario.`);
      }
    }
    return { booked, skipped };
  });
}

export function userRecurring(db, userId) {
  return db.prepare(`
    SELECT r.*, br.name AS barber_name FROM recurring r LEFT JOIN barbers br ON br.id = r.barber_id
    WHERE r.user_id = ? AND r.active = 1 ORDER BY r.weekday, r.time`).all(userId);
}

/** Disattiva il taglio settimanale e annulla le prenotazioni future ancora disdicibili. */
export function cancelRecurring(db, { id, userId, isAdmin = false }) {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM recurring WHERE id = ?').get(Number(id));
    if (!r || (!isAdmin && r.user_id !== userId) || !r.active) throw new AppError(404, 'Taglio settimanale non trovato');
    db.prepare('UPDATE recurring SET active = 0 WHERE id = ?').run(r.id);
    const future = db.prepare("SELECT * FROM bookings WHERE recurring_id = ? AND status = 'active'").all(r.id);
    let cancelled = 0;
    const kept = [];
    for (const b of future) {
      if (slotEpoch(b.date, b.time) <= now()) continue;
      if (canCancel(db, b) || isAdmin) {
        db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(now(), b.id);
        releaseSlot(db, b.barber_id, b.date, b.time);
        cancelled++;
      } else kept.push({ date: b.date, time: b.time });
    }
    return { cancelled, kept };
  });
}

// ---------- Gestore ----------
export function adminAgenda(db, date) {
  if (!isDate(date)) throw new AppError(400, 'Data non valida');
  const slots = daySlots(db, date);
  const rows = db.prepare(`
    SELECT b.id, b.barber_id, b.time, b.source, b.guest_name, u.name AS user_name, u.phone AS user_phone, u.role
    FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.date = ? AND b.status = 'active'`).all(date);
  const holds = db.prepare(`
    SELECT h.barber_id, h.time, h.expires_at, u.name AS user_name FROM holds h JOIN users u ON u.id = h.user_id
    WHERE h.date = ? AND h.status = 'pending'`).all(date);
  const times = new Set(slotTimesForDate(db, date));
  // Prenotazioni rimaste fuori orario dopo un cambio degli orari di lavoro
  const outside = rows.filter((r) => !times.has(r.time));
  const result = slots.map((b) => ({
    ...b,
    slots: b.slots.map((s) => {
      const bk = rows.find((r) => r.barber_id === b.barberId && r.time === s.time);
      const hd = holds.find((h) => h.barber_id === b.barberId && h.time === s.time);
      return {
        ...s,
        status: bk ? 'booked' : hd ? 'held' : s.status,
        booking: bk ? { id: bk.id, name: bk.guest_name || bk.user_name, phone: bk.guest_name ? null : bk.user_phone, source: bk.source } : null,
        hold: hd ? { name: hd.user_name, expiresAt: hd.expires_at } : null,
      };
    }),
  }));
  for (const o of outside) {
    const col = result.find((c) => c.barberId === o.barber_id);
    if (col) col.slots.push({ time: o.time, status: 'booked', outsideHours: true, booking: { id: o.id, name: o.guest_name || o.user_name, phone: o.guest_name ? null : o.user_phone, source: o.source } });
    col?.slots.sort((a, b) => toMin(a.time) - toMin(b.time));
  }
  const closure = db.prepare('SELECT reason FROM closures WHERE date = ?').get(date);
  const waitlist = db.prepare(`
    SELECT w.*, u.name AS user_name, u.phone AS user_phone, br.name AS barber_name FROM waitlist w
    JOIN users u ON u.id = w.user_id LEFT JOIN barbers br ON br.id = w.barber_id
    WHERE w.date = ? AND w.status IN ('waiting','offered') ORDER BY w.created_at, w.id`).all(date);
  return { date, closed: closure ? closure.reason || 'Chiuso' : null, barbers: result, waitlist };
}

export function addClosure(db, { date, reason }) {
  if (!isDate(date)) throw new AppError(400, 'Data non valida');
  db.prepare('INSERT INTO closures(date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason').run(date, reason || null);
  const affected = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND status = 'active'").get(date).n;
  return { ok: true, affectedBookings: affected };
}
