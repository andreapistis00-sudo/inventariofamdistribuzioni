import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import * as L from '../src/logic.js';
import { hashPassword } from '../src/auth.js';

let db, anna, bruno, carla, t;
const setNow = (date, time) => { t = L.slotEpoch(date, time); };
const addUser = (name, phone) => Number(db.prepare("INSERT INTO users(name, phone, password_hash, role, created_at) VALUES (?, ?, ?, 'client', 0)").run(name, phone, hashPassword('x')).lastInsertRowid);

// 2026-12-01 è un martedì
const TUE = '2026-12-01';
const MON = '2026-11-30';
const SUN = '2026-12-06';

beforeEach(() => {
  L.setClock(() => t);
  setNow(TUE, '07:00');
  db = openDb(':memory:');
  anna = addUser('Anna', '3330000001');
  bruno = addUser('Bruno', '3330000002');
  carla = addUser('Carla', '3330000003');
});

test('orari predefiniti: martedì-sabato 8-13 e 15-20, un taglio ogni 30 minuti', () => {
  const slots = L.slotTimesForDate(db, TUE);
  assert.equal(slots.length, 20);
  assert.equal(slots[0], '08:00');
  assert.equal(slots[9], '12:30');
  assert.equal(slots[10], '15:00');
  assert.equal(slots.at(-1), '19:30');
  assert.deepEqual(L.slotTimesForDate(db, MON), []);
  assert.deepEqual(L.slotTimesForDate(db, SUN), []);
  assert.equal(L.activeBarbers(db).length, 2);
});

test('un blocco prenotato è bloccato per gli altri, ma l\'altra postazione resta libera', () => {
  L.createBooking(db, { userId: anna, barberId: 1, date: TUE, time: '10:00' });
  assert.throws(() => L.createBooking(db, { userId: bruno, barberId: 1, date: TUE, time: '10:00' }), /già prenotato/);
  const b = L.createBooking(db, { userId: bruno, barberId: 2, date: TUE, time: '10:00' });
  assert.equal(b.barber_id, 2);
  const view = L.daySlots(db, TUE, anna);
  assert.equal(view[0].slots.find((s) => s.time === '10:00').status, 'mine');
  assert.equal(view[1].slots.find((s) => s.time === '10:00').status, 'booked');
});

test('non si prenota fuori orario, nel passato o di lunedì', () => {
  assert.throws(() => L.createBooking(db, { userId: anna, barberId: 1, date: TUE, time: '13:30' }), /fuori/);
  assert.throws(() => L.createBooking(db, { userId: anna, barberId: 1, date: MON, time: '10:00' }), /fuori/);
  setNow(TUE, '11:00');
  assert.throws(() => L.createBooking(db, { userId: anna, barberId: 1, date: TUE, time: '10:00' }), /passato/);
});

test('il cliente non può disdire a meno di 3 ore dall\'appuntamento', () => {
  const b = L.createBooking(db, { userId: anna, barberId: 1, date: TUE, time: '12:00' });
  setNow(TUE, '09:01');
  assert.throws(() => L.cancelBooking(db, { bookingId: b.id, userId: anna }), /3 ore/);
  setNow(TUE, '09:00');
  assert.deepEqual(L.cancelBooking(db, { bookingId: b.id, userId: anna }), { ok: true });
});

test('il gestore può sempre annullare e il cliente viene avvisato', () => {
  const b = L.createBooking(db, { userId: anna, barberId: 1, date: TUE, time: '08:30' });
  L.cancelBooking(db, { bookingId: b.id, userId: 999, isAdmin: true });
  const n = db.prepare('SELECT message FROM notifications WHERE user_id = ?').all(anna);
  assert.match(n[0].message, /annullato/);
});

test('coda: il posto liberato viene riservato al primo in coda, poi passa al successivo', () => {
  const b = L.createBooking(db, { userId: anna, barberId: 1, date: TUE, time: '16:00' });
  L.addToWaitlist(db, { userId: bruno, date: TUE, timeFrom: '15:00', timeTo: '18:00' });
  L.addToWaitlist(db, { userId: carla, date: TUE });

  L.cancelBooking(db, { bookingId: b.id, userId: anna });
  // Riservato a Bruno: Carla non può prenderlo
  assert.equal(L.userOffers(db, bruno).length, 1);
  assert.throws(() => L.createBooking(db, { userId: carla, barberId: 1, date: TUE, time: '16:00' }), /riservato/);

  // Bruno rifiuta -> passa a Carla
  L.declineOffer(db, { holdId: L.userOffers(db, bruno)[0].id, userId: bruno });
  const offer = L.userOffers(db, carla)[0];
  assert.ok(offer);
  const booking = L.acceptOffer(db, { holdId: offer.id, userId: carla });
  assert.equal(booking.source, 'waitlist');
  assert.equal(L.userWaitlist(db, carla).length, 0);
  // Bruno resta in coda per altri posti
  assert.equal(L.userWaitlist(db, bruno).length, 1);
});

test('coda: se l\'offerta scade il posto passa al successivo; se nessuno è in coda torna libero', () => {
  const b = L.createBooking(db, { userId: anna, barberId: 2, date: TUE, time: '17:00' });
  L.addToWaitlist(db, { userId: bruno, date: TUE, barberId: 2 });
  L.addToWaitlist(db, { userId: carla, date: TUE, barberId: 1 }); // vuole solo la postazione 1
  L.cancelBooking(db, { bookingId: b.id, userId: anna });
  assert.equal(L.userOffers(db, bruno).length, 1);
  setNow(TUE, '07:31'); // 30 minuti di riserva scaduti
  L.expireHolds(db);
  assert.equal(L.userOffers(db, bruno).length, 0);
  assert.equal(L.userOffers(db, carla).length, 0); // incompatibile con la postazione 2
  const s = L.daySlots(db, TUE)[1].slots.find((x) => x.time === '17:00');
  assert.equal(s.status, 'free');
});

test('taglio settimanale: prenota in automatico le prossime settimane', () => {
  const r = L.createRecurring(db, { userId: anna, barberId: 1, weekday: 4, time: '18:00' });
  assert.equal(r.booked.length, 4);
  assert.deepEqual(r.booked.map((x) => x.date), ['2026-12-03', '2026-12-10', '2026-12-17', '2026-12-24']);
  // Avanzando di una settimana viene aggiunta la quinta
  setNow('2026-12-08', '07:00');
  const g = L.generateRecurring(db);
  assert.deepEqual(g.booked.map((x) => x.date), ['2026-12-31']);
});

test('taglio settimanale: se la postazione preferita è occupata usa l\'altra (se flessibile)', () => {
  L.createBooking(db, { userId: bruno, barberId: 1, date: '2026-12-03', time: '18:00' });
  const r = L.createRecurring(db, { userId: anna, barberId: 1, flexible: true, weekday: 4, time: '18:00' });
  assert.equal(r.booked[0].date, '2026-12-03');
  assert.equal(r.booked[0].barber, 'Postazione 2');

  const r2 = L.createRecurring(db, { userId: carla, barberId: 1, flexible: false, weekday: 4, time: '18:00' });
  // Postazione 1 occupata da Bruno (3/12) e da Anna (settimane seguenti): niente prenotazioni
  assert.equal(r2.booked.length, 0);
  assert.equal(r2.skipped.length, 4);
});

test('taglio settimanale: non si può creare in un giorno di chiusura; disattivarlo libera i posti', () => {
  assert.throws(() => L.createRecurring(db, { userId: anna, weekday: 1, time: '10:00' }), /non lavora/);
  const r = L.createRecurring(db, { userId: anna, weekday: 2, time: '09:00' });
  assert.equal(r.booked[0].date, TUE);
  setNow(TUE, '07:00'); // a 2 ore: l'appuntamento di oggi resta
  const c = L.cancelRecurring(db, { id: r.id, userId: anna });
  assert.equal(c.cancelled, 3);
  assert.deepEqual(c.kept, [{ date: TUE, time: '09:00' }]);
});

test('il gestore può cambiare gli orari di lavoro e aggiungere chiusure', () => {
  L.updateSettings(db, { hours: { 1: [['09:00', '12:00']], 2: [['08:00', '13:00']] } });
  assert.equal(L.slotTimesForDate(db, MON).length, 6);
  assert.equal(L.slotTimesForDate(db, TUE).length, 10);
  assert.deepEqual(L.slotTimesForDate(db, '2026-12-05'), []); // sabato non più indicato
  assert.throws(() => L.updateSettings(db, { hours: { 2: [['10:00', '09:00']] } }), /fine/);
  L.addClosure(db, { date: TUE, reason: 'Ferie' });
  assert.deepEqual(L.slotTimesForDate(db, TUE), []);
  L.updateSettings(db, { slotMinutes: 60 });
  assert.equal(L.slotTimesForDate(db, MON).length, 3);
});
