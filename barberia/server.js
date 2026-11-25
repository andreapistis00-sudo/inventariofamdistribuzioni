import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { createApi } from './src/routes.js';
import * as L from './src/logic.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const db = openDb(process.env.DB_FILE || join(ROOT, 'barberia.db'));
const api = createApi(db);

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
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const r = await api.handle({ method: req.method, pathname: url.pathname, query: url.searchParams, body, authorization: req.headers.authorization });
    send(res, r.status, r.data);
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
