// Genera demo/dist/barberia-demo.html: un unico file che contiene l'app completa
// e la fa girare nel browser (nessun server necessario). Uso: npm run demo
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const swap = {
  name: 'browser-swap',
  setup(b) {
    b.onResolve({ filter: /^node:sqlite$/ }, () => ({ path: here('./sqlite-shim.js') }));
    b.onResolve({ filter: /\/auth\.js$/ }, () => ({ path: here('./auth-browser.js') }));
  },
};
const out = await build({ entryPoints: [here('./entry.js')], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', write: false, plugins: [swap] });
const bundle = out.outputFiles[0].text;
const css = await readFile(here('../public/style.css'), 'utf8');
const app = await readFile(here('../public/app.js'), 'utf8');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');

const html = `<title>Barberia Prenotazioni Demo</title>
<meta name="theme-color" content="#16130f">
<style>${css}
.demo-bar { background: #2a2214; border-bottom: 1px solid #6b5530; color: #e9d3a8; font-size: 13px; padding: 8px 16px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: center; text-align: center; }
.demo-bar code { background: #16130f; padding: 1px 6px; border-radius: 5px; color: #f3ede4; }
.demo-bar button { background: transparent; border: 1px solid #6b5530; color: #e9d3a8; border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
/* Pagina pubblicata: tema scuro unico e barra in alto sotto l'area sicura */
:root { color-scheme: dark; }
.topbar { top: env(safe-area-inset-top, 0px); }
</style>
<div class="demo-bar"><span><b>Demo</b> · Cliente: <code>3331234567</code> / <code>demo123</code> · Gestore: <code>admin</code> / <code>admin123</code></span>
<button id="demo-reset" type="button">Ricomincia la demo</button></div>
<div id="app"><div class="loading">Caricamento…</div></div>
<div id="modal-root"></div>
<div id="toast-root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-asm.js"></script>
<script>${esc(bundle)}</script>
<script type="module">${esc(app)}</script>`;
await mkdir(here('./dist'), { recursive: true });
await writeFile(here('./dist/barberia-demo.html'), html);
console.log('Creato demo/dist/barberia-demo.html', (html.length / 1024).toFixed(0), 'KB');
