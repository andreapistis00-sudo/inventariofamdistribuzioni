// ============ Barberia · interfaccia web ============
const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');
const $toast = document.getElementById('toast-root');

const state = {
  token: localGet('token'),
  user: null,
  config: null,
  tab: null,
  // cliente
  calendar: [], date: null, barberId: null, slots: [], offers: [], notifications: [], showNotif: false,
  // gestore
  agendaDate: null,
};

// ---------- Utilità ----------
function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignora */ } }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const WD_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const parseD = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
const fmtDate = (d) => { const x = parseD(d); return `${WD[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]}`; };
const fmtDateLong = (d) => { const x = parseD(d); return `${WD[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
const toDateStr = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = parseD(d); x.setDate(x.getDate() + n); return toDateStr(x); };
const fmtTs = (ts) => new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const SOURCE = { manual: 'App', recurring: 'Settimanale', waitlist: 'Dalla coda', admin: 'Gestore' };

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) { logoutLocal(); throw new Error('Sessione scaduta, accedi di nuovo'); }
  if (!res.ok) throw new Error(data.error || 'Errore');
  return data;
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $toast.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 5000 : 3000);
}

function modal(html, onMount) {
  $modal.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const back = $modal.firstElementChild;
  const close = () => { $modal.innerHTML = ''; };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  onMount?.(back.querySelector('.modal'), close);
  back.querySelector('input, button.primary')?.focus();
  return close;
}

function confirmBox(title, text, okLabel = 'Conferma', danger = false) {
  return new Promise((resolve) => {
    modal(`<h3>${title}</h3><p class="muted">${text}</p>
      <div class="actions"><button class="btn ghost" data-close>Annulla</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="ok">${okLabel}</button></div>`, (m, close) => {
      m.querySelector('#ok').onclick = () => { close(); resolve(true); };
      m.querySelector('[data-close]').addEventListener('click', () => resolve(false));
    });
  });
}

async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, 'err'); return null; }
}

function logoutLocal() { state.token = null; state.user = null; localSet('token', null); render(); }

// ---------- Avvio ----------
async function boot() {
  state.config = await api('GET', '/api/config');
  document.title = `${state.config.shopName} · Prenotazioni`;
  if (state.token) {
    try { state.user = (await api('GET', '/api/me')).user; } catch { state.token = null; localSet('token', null); }
  }
  render();
}

function render() {
  if (!state.user) return renderAuth();
  if (state.user.role === 'admin') return renderAdmin();
  return renderClient();
}

// ============ Accesso ============
function renderAuth(mode = 'login') {
  $app.innerHTML = `
  <div class="auth">
    <div class="hero"><div class="pole"></div><h1>${esc(state.config.shopName)}</h1>
      <div class="muted">Prenota il tuo taglio in pochi secondi</div></div>
    <div class="card">
      <div class="seg"><button data-m="login" class="${mode === 'login' ? 'active' : ''}">Accedi</button>
        <button data-m="register" class="${mode === 'register' ? 'active' : ''}">Registrati</button></div>
      <form id="auth-form">
        ${mode === 'register' ? `<div class="field"><label for="f-name">Nome e cognome</label><input id="f-name" type="text" name="name" autocomplete="name" required></div>` : ''}
        <div class="field"><label for="f-phone">${mode === 'register' ? 'Telefono' : 'Telefono (o "admin" per il gestore)'}</label>
          <input id="f-phone" type="${mode === 'register' ? 'tel' : 'text'}" name="phone" autocomplete="username" required></div>
        <div class="field"><label for="f-pwd">Password</label><input id="f-pwd" type="password" name="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" required minlength="${mode === 'register' ? 6 : 1}"></div>
        <button class="btn primary" style="width:100%">${mode === 'register' ? 'Crea account' : 'Entra'}</button>
      </form>
    </div>
    ${hoursSummary()}
  </div>`;
  $app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => renderAuth(b.dataset.m)));
  $app.querySelector('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const r = await run(() => api('POST', mode === 'register' ? '/api/register' : '/api/login', body));
    if (!r) return;
    state.token = r.token; state.user = r.user; localSet('token', r.token);
    state.tab = null;
    if (r.user.role === 'client') await refreshClientData().catch(() => {});
    render();
  };
}

function hoursSummary() {
  const h = state.config.hours;
  const rows = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const iv = h[d] || [];
    return `<li><span>${WD[d]}</span><span class="muted">${iv.length ? iv.map(([a, b]) => `${a}–${b}`).join(' · ') : 'Chiuso'}</span></li>`;
  }).join('');
  return `<div class="card"><h3>Orari</h3><ul class="list small">${rows}</ul></div>`;
}

// ============ Cliente ============
const CLIENT_TABS = [['book', 'Prenota'], ['mine', 'I miei appuntamenti'], ['queue', 'Coda'], ['weekly', 'Taglio settimanale']];

function topbar(extra = '') {
  return `<header class="topbar">
    <div class="brand"><span class="pole"></span>${esc(state.config.shopName)}</div>
    <div class="spacer"></div>
    <span class="who">${esc(state.user.name)}</span>
    ${extra}
    <button class="btn sm ghost" id="logout">Esci</button>
  </header>`;
}

function bindTopbar() {
  $app.querySelector('#logout').onclick = async () => { await api('POST', '/api/logout').catch(() => {}); logoutLocal(); };
}

async function renderClient() {
  state.tab ||= 'book';
  const unread = state.notifications.filter((n) => !n.read).length;
  $app.innerHTML = `
    ${topbar(`<button class="icon-btn" id="bell" aria-label="Notifiche">🔔${unread ? `<span class="dot">${unread}</span>` : ''}</button>`)}
    ${state.showNotif ? notifPanel() : ''}
    <nav class="tabs">${CLIENT_TABS.map(([k, l]) => `<button class="tab ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}${k === 'queue' && state.offers.length ? `<span class="count">${state.offers.length}</span>` : ''}</button>`).join('')}</nav>
    <main><div id="offers">${offersHtml()}</div><div id="view"><div class="empty">Caricamento…</div></div></main>`;
  bindTopbar();
  $app.querySelector('#bell').onclick = async () => {
    state.showNotif = !state.showNotif;
    if (state.showNotif && unread) { await api('POST', '/api/my/notifications/read').catch(() => {}); }
    renderClient();
    if (!state.showNotif) return;
    state.notifications = state.notifications.map((n) => ({ ...n, read: 1 }));
  };
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; state.showNotif = false; renderClient(); }));
  bindOffers();
  const views = { book: viewBook, mine: viewMine, queue: viewQueue, weekly: viewWeekly };
  await views[state.tab]();
}

function notifPanel() {
  if (!state.notifications.length) return `<div class="notif-panel"><div class="n muted">Nessuna notifica</div></div>`;
  return `<div class="notif-panel">${state.notifications.map((n) => `<div class="n ${n.read ? '' : 'unread'}">${esc(n.message)}<time>${fmtTs(n.created_at)}</time></div>`).join('')}</div>`;
}

// --- Offerte dalla coda ---
function offersHtml() {
  return state.offers.map((o) => `
    <div class="offer">
      <div class="row between">
        <div><div class="small muted">Si è liberato un posto per te!</div>
          <div class="when">${fmtDate(o.date)} · <span class="t">${o.time}</span> · ${esc(o.barber_name)}</div>
          <div class="small">Riservato ancora per <span class="countdown" data-exp="${o.expires_at}"></span></div></div>
        <div class="row"><button class="btn ghost sm" data-decline="${o.id}">Rifiuta</button>
          <button class="btn primary" data-accept="${o.id}">Prendi il posto</button></div>
      </div>
    </div>`).join('');
}
function bindOffers() {
  $app.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = async () => {
    if (await run(() => api('POST', `/api/offers/${b.dataset.accept}/accept`), 'Appuntamento confermato!')) { await refreshClientData(); renderClient(); }
  }));
  $app.querySelectorAll('[data-decline]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Rifiutare il posto?', 'Il posto passerà al prossimo cliente in coda. Resterai comunque in coda per altri orari.', 'Rifiuta', true))) return;
    if (await run(() => api('POST', `/api/offers/${b.dataset.decline}/decline`), 'Offerta rifiutata')) { await refreshClientData(); renderClient(); }
  }));
  tickCountdowns();
}
function tickCountdowns() {
  document.querySelectorAll('.countdown').forEach((el) => {
    const ms = Number(el.dataset.exp) - Date.now();
    if (ms <= 0) { el.textContent = 'scaduto'; return; }
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  });
}
setInterval(tickCountdowns, 1000);

async function refreshClientData() {
  const [offers, notifications] = await Promise.all([api('GET', '/api/my/offers'), api('GET', '/api/my/notifications')]);
  const changed = offers.length !== state.offers.length || notifications.filter((n) => !n.read).length !== state.notifications.filter((n) => !n.read).length;
  state.offers = offers; state.notifications = notifications;
  return changed;
}
// Aggiornamento periodico (offerte dalla coda e notifiche)
setInterval(async () => {
  if (!state.user || state.user.role !== 'client') return;
  try { if (await refreshClientData()) renderClient(); } catch { /* rete assente */ }
}, 20000);

// --- Prenota ---
async function viewBook() {
  const $v = document.getElementById('view');
  state.calendar = await api('GET', `/api/calendar?days=${Math.min(28, state.config.bookingDaysAhead + 1)}`);
  if (!state.date || !state.calendar.find((d) => d.date === state.date && d.open)) {
    state.date = (state.calendar.find((d) => d.open && d.free > 0) || state.calendar.find((d) => d.open) || {}).date || null;
  }
  state.barberId ||= state.config.barbers[0]?.id;
  if (state.date) state.slots = await api('GET', `/api/slots?date=${state.date}`);

  const days = state.calendar.map((d) => {
    const x = parseD(d.date);
    const cls = !d.open ? 'closed' : d.free === 0 ? 'full' : '';
    const info = !d.open ? (d.closedReason ? 'Chiuso*' : 'Chiuso') : d.free === 0 ? 'Pieno' : `${d.free} liberi`;
    return `<button class="day ${cls} ${d.date === state.date ? 'active' : ''}" data-date="${d.date}" ${d.open ? '' : 'disabled'} title="${esc(d.closedReason || '')}">
      <div class="wd">${WD_SHORT[x.getDay()]}</div><div class="dn">${x.getDate()}</div><div class="fr">${info}</div></button>`;
  }).join('');

  if (!state.date) { $v.innerHTML = `<div class="days">${days}</div><div class="empty">Nessun giorno disponibile.</div>`; return; }

  const barbers = state.slots.map((b) => {
    const free = b.slots.filter((s) => s.status === 'free').length;
    return `<button class="barber ${b.barberId === state.barberId ? 'active' : ''}" data-barber="${b.barberId}">
      <div class="avatar">${esc(b.barberName.trim()[0] || '?')}</div>
      <div class="name">${esc(b.barberName)}</div><div class="sub">${free ? `${free} orari liberi` : 'Nessun orario libero'}</div></button>`;
  }).join('');

  const col = state.slots.find((b) => b.barberId === state.barberId) || state.slots[0];
  const label = { free: 'Libero', booked: 'Occupato', held: 'Riservato', mine: 'Tuo', offered: 'Per te', past: '' };
  const slotBtn = (s) => `<button class="slot ${s.status}" data-time="${s.time}" ${['free', 'offered'].includes(s.status) ? '' : 'aria-disabled="true"'}>${s.time}<small>${label[s.status]}</small></button>`;
  const visible = col.slots.filter((s) => s.status !== 'past');
  const morning = visible.filter((s) => s.time < '13:00');
  const afternoon = visible.filter((s) => s.time >= '13:00');
  const anyFree = state.slots.some((b) => b.slots.some((s) => s.status === 'free'));
  const futureTimes = [...new Set(state.slots.flatMap((b) => b.slots.filter((s) => s.status !== 'past').map((s) => s.time)))].sort();

  $v.innerHTML = `
    <div class="days">${days}</div>
    <h2>${fmtDate(state.date)}</h2>
    <div class="barbers">${barbers}</div>
    <div class="card">
      ${morning.length ? `<div class="period">Mattina</div><div class="slots">${morning.map(slotBtn).join('')}</div>` : ''}
      ${afternoon.length ? `<div class="period">Pomeriggio</div><div class="slots">${afternoon.map(slotBtn).join('')}</div>` : ''}
      ${visible.length ? '' : '<div class="empty">Nessun orario ancora disponibile per oggi.</div>'}
      <div class="legend"><span><i style="background:var(--free)"></i>Libero</span><span><i style="background:var(--busy)"></i>Occupato</span>
        <span><i style="background:var(--held)"></i>Riservato a chi è in coda</span><span><i style="background:var(--mine)"></i>Il tuo appuntamento</span></div>
    </div>
    ${futureTimes.length ? `
    <div class="card">
      <h3>${anyFree ? 'Non trovi l\'orario che vuoi?' : 'Giornata piena'} Mettiti in coda</h3>
      <p class="muted small">Se qualcuno disdice un orario compatibile, il posto viene riservato a te per ${state.config.offerHoldMinutes} minuti e ricevi una notifica. Chi si mette in coda prima ha la precedenza.</p>
      <form id="queue-form" class="grid-2" style="gap:10px">
        <div><label>Barbiere</label><select name="barberId"><option value="">Indifferente</option>${state.config.barbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div class="row" style="flex-wrap:nowrap">
          <div style="flex:1"><label>Dalle</label><select name="timeFrom">${futureTimes.map((t) => `<option>${t}</option>`).join('')}</select></div>
          <div style="flex:1"><label>Alle</label><select name="timeTo">${futureTimes.map((t, i) => `<option ${i === futureTimes.length - 1 ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div><button class="btn primary">Mettimi in coda</button></div>
      </form>
    </div>` : ''}`;

  $v.querySelectorAll('[data-date]').forEach((b) => (b.onclick = () => { state.date = b.dataset.date; viewBook(); }));
  $v.querySelectorAll('[data-barber]').forEach((b) => (b.onclick = () => { state.barberId = Number(b.dataset.barber); viewBook(); }));
  $v.querySelector('.day.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  $v.querySelectorAll('.slot').forEach((b) => (b.onclick = () => {
    const s = col.slots.find((x) => x.time === b.dataset.time);
    if (s.status === 'offered') return run(() => api('POST', `/api/offers/${s.holdId}/accept`), 'Appuntamento confermato!').then(async (r) => { if (r) { await refreshClientData(); renderClient(); } });
    if (s.status !== 'free') return;
    bookDialog(col, s.time);
  }));
  $v.querySelector('#queue-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { date: state.date, ...Object.fromEntries(new FormData(e.target)) };
    const r = await run(() => api('POST', '/api/waitlist', body));
    if (r) toast(`Sei in coda (posizione ${r.position}). Ti avviseremo se si libera un posto.`);
  });
}

function bookDialog(col, time) {
  modal(`<h3>Conferma prenotazione</h3>
    <p class="when" style="font-size:18px">${fmtDateLong(state.date)}<br><span class="t">${time}</span> · ${esc(col.barberName)}</p>
    <p class="muted small">Potrai disdire gratuitamente fino a ${state.config.cancelLimitHours} ore prima dell'appuntamento.</p>
    <div class="actions"><button class="btn ghost" data-close>Annulla</button><button class="btn primary" id="ok">Prenota</button></div>`, (m, close) => {
    m.querySelector('#ok').onclick = async () => {
      close();
      const r = await run(() => api('POST', '/api/bookings', { barberId: col.barberId, date: state.date, time }), 'Prenotazione confermata!');
      viewBook();
      return r;
    };
  });
}

// --- I miei appuntamenti ---
async function viewMine() {
  const $v = document.getElementById('view');
  const list = await api('GET', '/api/my/bookings');
  const upcoming = list.filter((b) => !b.past);
  const h = state.config.cancelLimitHours;
  $v.innerHTML = `<h2>I miei appuntamenti</h2>
    <div class="card">${upcoming.length ? `<ul class="list">${upcoming.map((b) => `
      <li><div><div class="when">${fmtDate(b.date)} · <span class="t">${b.time}</span></div>
        <div class="small muted">${esc(b.barber_name)} ${b.source !== 'manual' ? `<span class="badge accent">${SOURCE[b.source]}</span>` : ''}</div></div>
        ${b.canCancel ? `<button class="btn danger sm" data-cancel="${b.id}">Disdici</button>`
          : `<span class="small muted" title="Non si può disdire a meno di ${h} ore dall'appuntamento">Non più disdicibile</span>`}
      </li>`).join('')}</ul>` : `<div class="empty">Nessun appuntamento in programma.<br><br><button class="btn primary" id="go-book">Prenota un taglio</button></div>`}
    </div>
    <p class="muted small">Ricorda: non è possibile disdire a meno di ${h} ore dall'appuntamento. In quel caso contatta direttamente la barberia.</p>`;
  $v.querySelector('#go-book')?.addEventListener('click', () => { state.tab = 'book'; renderClient(); });
  $v.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Disdire l\'appuntamento?', 'Il posto verrà liberato e offerto a chi è in coda.', 'Disdici', true))) return;
    if (await run(() => api('DELETE', `/api/bookings/${b.dataset.cancel}`), 'Appuntamento disdetto')) viewMine();
  }));
}

// --- Coda ---
async function viewQueue() {
  const $v = document.getElementById('view');
  const list = await api('GET', '/api/my/waitlist');
  $v.innerHTML = `<h2>La mia coda</h2>
    <div class="card">${list.length ? `<ul class="list">${list.map((w) => `
      <li><div><div class="when">${fmtDate(w.date)} · <span class="t">${w.time_from || 'apertura'}–${w.time_to || 'chiusura'}</span></div>
        <div class="small muted">${esc(w.barber_name || 'Barbiere indifferente')} · ${w.status === 'offered' ? '<span class="badge accent">Posto disponibile!</span>' : `posizione ${w.position}`}</div></div>
        <button class="btn danger sm" data-del="${w.id}">Esci dalla coda</button></li>`).join('')}</ul>`
      : `<div class="empty">Non sei in coda per nessun giorno.<br><span class="small">Dalla pagina <b>Prenota</b> puoi metterti in coda per un giorno pieno.</span></div>`}
    </div>`;
  $v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (await run(() => api('DELETE', `/api/waitlist/${b.dataset.del}`), 'Rimosso dalla coda')) { await refreshClientData(); renderClient(); }
  }));
}

// --- Taglio settimanale ---
async function viewWeekly() {
  const $v = document.getElementById('view');
  const list = await api('GET', '/api/my/recurring');
  const openDays = [1, 2, 3, 4, 5, 6, 0].filter((d) => state.config.weekdaySlots[d]?.length);
  const first = openDays[0];
  $v.innerHTML = `<h2>Taglio settimanale automatico</h2>
    <div class="card">
      <p class="muted small" style="margin-top:0">Scegli giorno e ora: prenoteremo per te in automatico ogni settimana, ${state.config.recurringWeeksAhead} settimane in anticipo. Se l'orario è già occupato ti avvisiamo con una notifica. Puoi disdire i singoli appuntamenti come sempre.</p>
      <form id="weekly-form" class="grid-2" style="gap:10px">
        <div><label>Giorno</label><select name="weekday" id="wd">${openDays.map((d) => `<option value="${d}">${WD[d]}</option>`).join('')}</select></div>
        <div><label>Ora</label><select name="time" id="wt">${(state.config.weekdaySlots[first] || []).map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div><label>Barbiere</label><select name="barberId"><option value="">Indifferente</option>${state.config.barbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div style="align-self:end"><label class="check"><input type="checkbox" name="flexible" checked> Se è occupato, va bene l'altro barbiere</label></div>
        <div><button class="btn primary">Attiva taglio settimanale</button></div>
      </form>
    </div>
    <h3>Attivi</h3>
    <div class="card">${list.length ? `<ul class="list">${list.map((r) => `
      <li><div><div class="when">Ogni ${WD[r.weekday].toLowerCase()} · <span class="t">${r.time}</span></div>
        <div class="small muted">${esc(r.barber_name || 'Barbiere indifferente')}${r.barber_id && r.flexible ? ' (o l\'altro se occupato)' : ''}</div></div>
        <button class="btn danger sm" data-del="${r.id}">Disattiva</button></li>`).join('')}</ul>`
      : '<div class="empty">Nessun taglio settimanale attivo.</div>'}</div>`;
  const $wd = $v.querySelector('#wd');
  $wd.onchange = () => { $v.querySelector('#wt').innerHTML = (state.config.weekdaySlots[$wd.value] || []).map((t) => `<option>${t}</option>`).join(''); };
  $v.querySelector('#weekly-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { weekday: Number(fd.get('weekday')), time: fd.get('time'), barberId: fd.get('barberId') || null, flexible: fd.get('flexible') === 'on' };
    const r = await run(() => api('POST', '/api/recurring', body));
    if (!r) return;
    const lines = [
      ...r.booked.map((b) => `✅ ${fmtDate(b.date)} alle ${b.time} con ${esc(b.barber)}`),
      ...r.skipped.map((s) => `⚠️ ${fmtDate(s.date)} alle ${s.time}: ${esc(s.reason)}`),
    ];
    modal(`<h3>Taglio settimanale attivato</h3><ul class="list small">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      <div class="actions"><button class="btn primary" data-close>Ok</button></div>`);
    viewWeekly();
  };
  $v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Disattivare il taglio settimanale?', `Le prenotazioni future create in automatico verranno annullate (tranne quelle a meno di ${state.config.cancelLimitHours} ore).`, 'Disattiva', true))) return;
    const r = await run(() => api('DELETE', `/api/recurring/${b.dataset.del}`));
    if (!r) return;
    toast(`Disattivato. ${r.cancelled} appuntamenti annullati${r.kept.length ? `, ${r.kept.length} mantenuti perché troppo vicini` : ''}.`);
    viewWeekly();
  }));
}

// ============ Gestore ============
const ADMIN_TABS = [['agenda', 'Agenda'], ['hours', 'Orari di lavoro'], ['closures', 'Chiusure'], ['barbers', 'Barbieri'], ['clients', 'Clienti e settimanali'], ['settings', 'Impostazioni']];

async function renderAdmin() {
  state.tab ||= 'agenda';
  $app.innerHTML = `${topbar('<span class="badge accent">Gestore</span>')}
    <nav class="tabs">${ADMIN_TABS.map(([k, l]) => `<button class="tab ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <main id="view"><div class="empty">Caricamento…</div></main>`;
  bindTopbar();
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; renderAdmin(); }));
  const views = { agenda: adminAgenda, hours: adminHours, closures: adminClosures, barbers: adminBarbers, clients: adminClients, settings: adminSettings };
  await views[state.tab]();
}

async function reloadConfig() { state.config = await api('GET', '/api/config'); }

// --- Agenda ---
async function adminAgenda() {
  const $v = document.getElementById('view');
  state.agendaDate ||= state.config.today;
  const a = await api('GET', `/api/admin/agenda?date=${state.agendaDate}`);
  const total = a.barbers.reduce((s, b) => s + b.slots.filter((x) => x.status === 'booked').length, 0);
  const col = (b) => `<div class="card"><h3>${esc(b.barberName)} <span class="badge">${b.slots.filter((x) => x.status === 'booked').length} tagli</span></h3>
    ${b.slots.length ? b.slots.map((s) => `
      <div class="arow ${s.status} ${s.outsideHours ? 'warn' : ''}">
        <div class="t">${s.time}</div>
        <div class="who">${s.booking ? `<b>${esc(s.booking.name)}</b><span>${s.booking.phone ? `<a href="tel:${esc(s.booking.phone)}">${esc(s.booking.phone)}</a> · ` : ''}${SOURCE[s.booking.source]}${s.outsideHours ? ' · fuori orario!' : ''}</span>`
          : s.hold ? `<b>Riservato</b><span>offerto a ${esc(s.hold.name)} (coda) fino alle ${new Date(s.hold.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>`
          : `<span>${s.status === 'past' ? '—' : 'Libero'}</span>`}</div>
        <div>${s.booking ? `<button class="btn danger sm" data-cancel="${s.booking.id}">Annulla</button>`
          : s.status === 'free' ? `<button class="btn sm" data-add="${b.barberId}|${s.time}">+ Inserisci</button>` : ''}</div>
      </div>`).join('') : '<div class="empty">Nessun orario</div>'}</div>`;
  $v.innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <h2 style="margin:0">${fmtDateLong(a.date)}</h2>
      <div class="row"><button class="btn sm" id="prev" aria-label="Giorno precedente">‹</button>
        <input type="date" id="ad" value="${a.date}" style="width:auto">
        <button class="btn sm" id="next" aria-label="Giorno successivo">›</button>
        <button class="btn sm ghost" id="today">Oggi</button></div>
    </div>
    ${a.closed ? `<div class="notice" style="margin-bottom:14px">Giorno di chiusura: ${esc(a.closed)}</div>` : ''}
    <p class="muted small">${total} appuntamenti in totale</p>
    <div class="agenda">${a.barbers.map(col).join('')}</div>
    <div class="card"><h3>In coda per questo giorno</h3>${a.waitlist.length ? `<ul class="list">${a.waitlist.map((w, i) => `
      <li><div><b>${i + 1}. ${esc(w.user_name)}</b> <span class="small muted">${esc(w.user_phone)}</span>
        <div class="small muted">${w.time_from || 'apertura'}–${w.time_to || 'chiusura'} · ${esc(w.barber_name || 'indifferente')} ${w.status === 'offered' ? '<span class="badge accent">offerta in corso</span>' : ''}</div></div>
        <button class="btn danger sm" data-wl="${w.id}">Rimuovi</button></li>`).join('')}</ul>` : '<div class="muted small">Nessuno in coda.</div>'}</div>`;

  const go = (d) => { state.agendaDate = d; adminAgenda(); };
  $v.querySelector('#prev').onclick = () => go(addDays(a.date, -1));
  $v.querySelector('#next').onclick = () => go(addDays(a.date, 1));
  $v.querySelector('#today').onclick = () => go(state.config.today);
  $v.querySelector('#ad').onchange = (e) => e.target.value && go(e.target.value);
  $v.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Annullare l\'appuntamento?', 'Il cliente riceverà una notifica e il posto sarà offerto a chi è in coda.', 'Annulla appuntamento', true))) return;
    if (await run(() => api('DELETE', `/api/bookings/${b.dataset.cancel}`), 'Appuntamento annullato')) adminAgenda();
  }));
  $v.querySelectorAll('[data-wl]').forEach((b) => (b.onclick = async () => {
    if (await run(() => api('DELETE', `/api/waitlist/${b.dataset.wl}`), 'Rimosso dalla coda')) adminAgenda();
  }));
  $v.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
    const [barberId, time] = b.dataset.add.split('|');
    modal(`<h3>Inserisci appuntamento</h3><p class="muted">${fmtDate(a.date)} alle ${time}</p>
      <form id="walkin"><div class="field"><label for="gn">Nome cliente</label><input id="gn" type="text" name="guestName" required></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Salva</button></div></form>`, (m, close) => {
      m.querySelector('#walkin').onsubmit = async (e) => {
        e.preventDefault();
        const guestName = new FormData(e.target).get('guestName');
        close();
        if (await run(() => api('POST', '/api/admin/bookings', { barberId: Number(barberId), date: a.date, time, guestName }), 'Appuntamento inserito')) adminAgenda();
      };
    });
  }));
}

// --- Orari di lavoro ---
async function adminHours() {
  const $v = document.getElementById('view');
  const s = await api('GET', '/api/admin/settings');
  const hours = JSON.parse(JSON.stringify(s.hours));
  let slotMinutes = s.slotMinutes;
  const draw = () => {
    $v.innerHTML = `<h2>Orari di lavoro</h2>
      <div class="card">
        <div class="field" style="max-width:260px"><label for="sm">Durata di un taglio</label>
          <select id="sm">${[15, 20, 30, 45, 60].map((m) => `<option value="${m}" ${m === slotMinutes ? 'selected' : ''}>${m} minuti</option>`).join('')}</select></div>
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => `
          <div class="hours-row">
            <label class="check"><input type="checkbox" data-open="${d}" ${hours[d]?.length ? 'checked' : ''}> <b>${WD[d]}</b></label>
            <div>${hours[d]?.length ? hours[d].map(([a, b], i) => `
              <div class="iv"><input type="time" step="300" value="${a}" data-iv="${d}|${i}|0"> – <input type="time" step="300" value="${b}" data-iv="${d}|${i}|1">
              <button class="btn sm ghost" data-rm="${d}|${i}" aria-label="Rimuovi fascia">✕</button></div>`).join('') + `<button class="btn sm" data-addiv="${d}">+ Fascia oraria</button>`
              : '<span class="muted">Chiuso</span>'}</div>
          </div>`).join('')}
        <div class="row" style="margin-top:14px"><button class="btn primary" id="save">Salva orari</button>
          <span class="muted small">Le prenotazioni già fatte restano valide anche se finiscono fuori orario: le vedrai evidenziate in agenda.</span></div>
      </div>`;
    $v.querySelector('#sm').onchange = (e) => { slotMinutes = Number(e.target.value); };
    $v.querySelectorAll('[data-open]').forEach((c) => (c.onchange = () => { const d = c.dataset.open; hours[d] = c.checked ? [['08:00', '13:00'], ['15:00', '20:00']] : []; draw(); }));
    $v.querySelectorAll('[data-iv]').forEach((inp) => (inp.onchange = () => { const [d, i, k] = inp.dataset.iv.split('|'); hours[d][i][k] = inp.value; }));
    $v.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { const [d, i] = b.dataset.rm.split('|'); hours[d].splice(Number(i), 1); draw(); }));
    $v.querySelectorAll('[data-addiv]').forEach((b) => (b.onclick = () => { const d = b.dataset.addiv; const last = hours[d].at(-1)?.[1] || '08:00'; hours[d].push([last, last < '20:00' ? '20:00' : '23:00']); draw(); }));
    $v.querySelector('#save').onclick = async () => {
      if (await run(() => api('PUT', '/api/admin/settings', { hours, slotMinutes }), 'Orari salvati')) await reloadConfig();
    };
  };
  draw();
}

// --- Chiusure ---
async function adminClosures() {
  const $v = document.getElementById('view');
  const list = await api('GET', '/api/admin/closures');
  $v.innerHTML = `<h2>Chiusure straordinarie</h2>
    <div class="card"><p class="muted small" style="margin-top:0">Ferie, festività o giorni di chiusura: in quei giorni i clienti non potranno prenotare.</p>
      <form id="cl" class="row"><input type="date" name="date" required min="${state.config.today}" style="width:auto">
      <input type="text" name="reason" placeholder="Motivo (es. Ferie)" style="flex:1;min-width:160px"><button class="btn primary">Aggiungi</button></form></div>
    <div class="card">${list.length ? `<ul class="list">${list.map((c) => `<li><div><b>${fmtDateLong(c.date)}</b> <span class="muted">${esc(c.reason || '')}</span></div>
      <button class="btn danger sm" data-del="${c.date}">Rimuovi</button></li>`).join('')}</ul>` : '<div class="empty">Nessuna chiusura programmata.</div>'}</div>`;
  $v.querySelector('#cl').onsubmit = async (e) => {
    e.preventDefault();
    const r = await run(() => api('POST', '/api/admin/closures', Object.fromEntries(new FormData(e.target))));
    if (!r) return;
    toast(r.affectedBookings ? `Chiusura aggiunta. Attenzione: ci sono ${r.affectedBookings} appuntamenti in quel giorno, annullali dall'agenda.` : 'Chiusura aggiunta', r.affectedBookings ? 'err' : 'ok');
    adminClosures();
  };
  $v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (await run(() => api('DELETE', `/api/admin/closures/${b.dataset.del}`), 'Chiusura rimossa')) adminClosures();
  }));
}

// --- Barbieri ---
async function adminBarbers() {
  const $v = document.getElementById('view');
  const list = await api('GET', '/api/admin/barbers');
  $v.innerHTML = `<h2>Barbieri / postazioni</h2>
    <div class="card">${list.map((b, i) => `<form class="row field" data-id="${b.id}"><label style="width:100%">Postazione ${i + 1}</label>
      <input type="text" name="name" value="${esc(b.name)}" required maxlength="40" style="flex:1"><button class="btn">Salva</button></form>`).join('')}
      <p class="muted small">I clienti vedono questi nomi quando scelgono da chi tagliarsi i capelli.</p></div>`;
  $v.querySelectorAll('form').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    if (await run(() => api('PUT', `/api/admin/barbers/${f.dataset.id}`, { name: new FormData(f).get('name') }), 'Nome aggiornato')) await reloadConfig();
  }));
}

// --- Clienti e tagli settimanali ---
async function adminClients() {
  const $v = document.getElementById('view');
  const [rec, clients] = await Promise.all([api('GET', '/api/admin/recurring'), api('GET', '/api/admin/clients')]);
  $v.innerHTML = `<h2>Tagli settimanali attivi</h2>
    <div class="card">${rec.length ? `<ul class="list">${rec.map((r) => `<li><div><b>${esc(r.user_name)}</b> <span class="small muted">${esc(r.user_phone)}</span>
      <div class="small muted">Ogni ${WD[r.weekday].toLowerCase()} alle ${r.time} · ${esc(r.barber_name || 'indifferente')}</div></div>
      <button class="btn danger sm" data-del="${r.id}">Disattiva</button></li>`).join('')}</ul>` : '<div class="empty">Nessun taglio settimanale attivo.</div>'}</div>
    <h2>Clienti registrati (${clients.length})</h2>
    <div class="card">${clients.length ? `<ul class="list">${clients.map((c) => `<li><div><b>${esc(c.name)}</b> <a class="small" href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>
      <span class="badge">${c.bookings} appuntamenti attivi</span></li>`).join('')}</ul>` : '<div class="empty">Nessun cliente.</div>'}</div>`;
  $v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Disattivare il taglio settimanale?', 'Le prenotazioni future create in automatico verranno annullate.', 'Disattiva', true))) return;
    if (await run(() => api('DELETE', `/api/recurring/${b.dataset.del}`), 'Disattivato')) adminClients();
  }));
}

// --- Impostazioni ---
async function adminSettings() {
  const $v = document.getElementById('view');
  const s = await api('GET', '/api/admin/settings');
  const num = (name, label, help, min, max) => `<div class="field"><label for="s-${name}">${label}</label>
    <input id="s-${name}" type="number" name="${name}" value="${s[name]}" min="${min}" max="${max}" required><div class="small muted">${help}</div></div>`;
  $v.innerHTML = `<h2>Impostazioni</h2>
    <div class="grid-2">
      <form class="card" id="sf">
        <div class="field"><label for="s-shop">Nome della barberia</label><input id="s-shop" type="text" name="shopName" value="${esc(s.shopName)}" required></div>
        ${num('cancelLimitHours', 'Limite disdetta (ore)', 'Il cliente non può disdire a meno di queste ore dall\'appuntamento.', 0, 72)}
        ${num('offerHoldMinutes', 'Riserva posto per chi è in coda (minuti)', 'Tempo che ha il cliente in coda per accettare un posto liberato.', 5, 1440)}
        ${num('recurringWeeksAhead', 'Taglio settimanale: settimane prenotate in anticipo', '', 1, 12)}
        ${num('bookingDaysAhead', 'Prenotabile fino a (giorni)', '', 1, 365)}
        <button class="btn primary">Salva impostazioni</button>
      </form>
      <form class="card" id="pf"><h3>Cambia password gestore</h3>
        <div class="field"><label for="op">Password attuale</label><input id="op" type="password" name="oldPassword" required autocomplete="current-password"></div>
        <div class="field"><label for="np">Nuova password</label><input id="np" type="password" name="newPassword" required minlength="6" autocomplete="new-password"></div>
        <button class="btn">Cambia password</button></form>
    </div>`;
  $v.querySelector('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (await run(() => api('PUT', '/api/admin/settings', body), 'Impostazioni salvate')) { await reloadConfig(); renderAdmin(); }
  };
  $v.querySelector('#pf').onsubmit = async (e) => {
    e.preventDefault();
    if (await run(() => api('POST', '/api/password', Object.fromEntries(new FormData(e.target))), 'Password aggiornata')) e.target.reset();
  };
}

// Avvio + caricamento iniziale dei dati del cliente
boot().then(async () => {
  if (state.user?.role === 'client') { await refreshClientData().catch(() => {}); renderClient(); }
}).catch((e) => { $app.innerHTML = `<div class="empty">Impossibile contattare il server: ${esc(e.message)}</div>`; });
