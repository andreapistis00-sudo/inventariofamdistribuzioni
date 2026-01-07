/* =========================================================
   ADEGUATO AL TUO EXCEL (come da screenshot)
   Colonne usate:
   - "Cod." (chiave prodotto)
   - "Descrizione" (testo ricerca/visualizzazione)
   Altre colonne mantenute e riesportate uguali.

   Workflow:
   - Import Excel: crea catalogo prodotti dal file (no aggiunte manuali)
   - Cerca e seleziona
   - Inserisci: lotto, scadenza, quantità (carico)
   - Aggiorna Giacenza
   - Export: stesso file con colonne originali + "Giacenza" (in fondo) + foglio "Lotti"
   ========================================================= */

const STORE_PRODUCTS = "inv_products_custom_v1";
const STORE_LOTS = "inv_lots_custom_v1";

const el = (id) => document.getElementById(id);

const fileInput = el("file");
const btnExport = el("btnExport");

const searchIn = el("search");
const countEl = el("count");
const statusEl = el("status");

const listEl = el("list");

const selCodeEl = el("selCode");
const selDescEl = el("selDesc");
const selStockEl = el("selStock");
const selUmEl = el("selUm");
const selectedHintEl = el("selectedHint");

const lotIn = el("lot");
const expIn = el("exp");
const qtyIn = el("qty");
const btnSave = el("btnSave");

const recentEl = el("recent");

let selectedCode = null;

/* ===== Storage ===== */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return data ?? fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function loadProducts() {
  const arr = loadJSON(STORE_PRODUCTS, []);
  return Array.isArray(arr) ? arr : [];
}
function saveProducts(products) {
  saveJSON(STORE_PRODUCTS, products);
}

function loadLots() {
  const arr = loadJSON(STORE_LOTS, []);
  return Array.isArray(arr) ? arr : [];
}
function saveLots(lots) {
  saveJSON(STORE_LOTS, lots);
}

/* ===== Utils ===== */

function norm(s) { return (s ?? "").toString().trim(); }
function toInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.trunc(x);
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function setStatus(msg) { statusEl.textContent = msg || ""; }

/* ===== Excel helpers =====
   Trova una proprietà dell'oggetto riga, ignorando maiuscole/minuscole e spazi.
   Esempio: "Cod." potrebbe essere "Cod." o "Cod" o "COD." ecc.
*/
function pick(rowObj, wantedHeader) {
  const target = wantedHeader.trim().toLowerCase();
  const keys = Object.keys(rowObj);
  const found = keys.find(k => k.trim().toLowerCase() === target);
  return found ? rowObj[found] : "";
}

/* ===== UI render ===== */

function setSelected(code) {
  selectedCode = code;
  const products = loadProducts();
  const p = products.find(x => norm(x["Cod."]) === norm(code)) || null;

  if (!p) {
    selCodeEl.textContent = "—";
    selDescEl.textContent = "Nessun prodotto selezionato";
    selStockEl.textContent = "0";
    selUmEl.textContent = "";
    selectedHintEl.textContent = "Seleziona un prodotto dalla lista.";
    btnSave.disabled = true;
    return;
  }

  selCodeEl.textContent = p["Cod."] || "—";
  selDescEl.textContent = p["Descrizione"] || "";
  selStockEl.textContent = String(p["Giacenza"] ?? 0);

  const um = p["U.m."] || p["U.m"] || p["UM"] || "";
  selUmEl.textContent = um ? ` • ${um}` : "";

  selectedHintEl.textContent = "Inserisci lotto, scadenza e quantità, poi salva.";
  btnSave.disabled = false;

  for (const node of listEl.querySelectorAll(".item")) {
    node.classList.toggle("selected", node.dataset.code === p["Cod."]);
  }
}

function renderList() {
  const products = loadProducts();
  const q = norm(searchIn.value).toLowerCase();

  const filtered = q
    ? products.filter(p => {
        const code = norm(p["Cod."]).toLowerCase();
        const desc = norm(p["Descrizione"]).toLowerCase();
        return code.includes(q) || desc.includes(q);
      })
    : products;

  countEl.textContent = products.length
    ? `${filtered.length} risultati (totale: ${products.length})`
    : `Nessun prodotto caricato. Importa il file Excel.`;

  listEl.innerHTML = "";

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="muted small" style="padding:10px;">
      ${products.length ? "Nessun risultato." : "Importa un Excel per vedere i prodotti."}
    </div>`;
    return;
  }

  for (const p of filtered) {
    const code = p["Cod."] || "";
    const desc = p["Descrizione"] || "";
    const stock = p["Giacenza"] ?? 0;

    const extra = [];
    if (p["Categoria"]) extra.push(`Cat: ${p["Categoria"]}`);
    const um = p["U.m."] || p["U.m"] || "";
    if (um) extra.push(`UM: ${um}`);

    const div = document.createElement("div");
    div.className = "item" + (selectedCode === code ? " selected" : "");
    div.dataset.code = code;

    div.innerHTML = `
      <div class="badge">${escapeHtml(code)}</div>
      <div>
        <div class="itemTitle">${escapeHtml(desc)}</div>
        <div class="itemMeta">
          <span>Giacenza: <b>${stock}</b></span>
          ${extra.length ? `<span>${escapeHtml(extra.join(" • "))}</span>` : ""}
        </div>
      </div>
    `;

    div.addEventListener("click", () => setSelected(code));
    listEl.appendChild(div);
  }
}

function renderRecent() {
  const lots = loadLots();
  const products = loadProducts();
  const mapDesc = new Map(products.map(p => [p["Cod."], p["Descrizione"]]));

  const last = lots.slice(-8).reverse();
  recentEl.innerHTML = "";

  if (last.length === 0) {
    recentEl.innerHTML = `<div class="muted small">Nessun inserimento ancora.</div>`;
    return;
  }

  for (const r of last) {
    const div = document.createElement("div");
    div.className = "recentRow";
    const desc = mapDesc.get(r.code) || "";
    const exp = r.expiry ? r.expiry : "—";
    div.innerHTML = `
      <div><b>${escapeHtml(r.code)}</b> ${escapeHtml(desc)}</div>
      <div class="muted small">Lotto: ${escapeHtml(r.lot || "—")} • Scad: ${escapeHtml(exp)} • Qty: <b>${r.qty}</b></div>
    `;
    recentEl.appendChild(div);
  }
}

/* ===== Import Excel (ADEGUATO) ===== */

async function importExcel(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Nessun foglio trovato nel file.");

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (!rows.length) throw new Error("File Excel vuoto.");

  // Validazione: devono esistere "Cod." e "Descrizione" come intestazioni
  // (le cerchiamo sulla prima riga oggetto)
  const sample = rows[0];
  const sampleCode = pick(sample, "Cod.");
  const sampleDesc = pick(sample, "Descrizione");

  // Anche se la prima riga può essere una riga “strana”, controlliamo almeno le chiavi presenti:
  const keysLower = Object.keys(sample).map(k => k.trim().toLowerCase());
  const hasCode = keysLower.includes("cod.") || keysLower.includes("cod");
  const hasDesc = keysLower.includes("descrizione");

  if (!hasCode || !hasDesc) {
    throw new Error('Intestazioni non trovate. Devono esserci almeno: "Cod." e "Descrizione".');
  }

  // Prodotti importati: manteniamo TUTTE le colonne originali presenti nel file.
  // In più aggiungiamo "Giacenza" (se non c’è già) e la gestiamo dal sito.
  const imported = [];
  const seen = new Set();

  for (const r of rows) {
    const code = norm(pick(r, "Cod."));
    const desc = norm(pick(r, "Descrizione"));

    // ignora righe di gruppo / vuote (es: "Produttore :" o righe senza codice/descrizione)
    if (!code || !desc) continue;

    if (seen.has(code)) continue;
    seen.add(code);

    // Copia tutte le colonne così come sono
    const obj = { ...r };

    // Normalizza i campi chiave con i nomi ESATTI del tuo file
    obj["Cod."] = code;
    obj["Descrizione"] = desc;

    // Giacenza gestita dal sito (se non esiste, 0)
    obj["Giacenza"] = 0;

    imported.push(obj);
  }

  if (imported.length === 0) {
    throw new Error("Nessuna riga valida trovata (serve Cod. + Descrizione).");
  }

  // Preserva giacenze già inserite se re-importi lo stesso listino
  const old = loadProducts();
  const oldMap = new Map(old.map(p => [norm(p["Cod."]), p]));

  for (const p of imported) {
    const prev = oldMap.get(norm(p["Cod."]));
    if (prev) p["Giacenza"] = toInt(prev["Giacenza"]);
  }

  // Ordina per descrizione
  imported.sort((a, b) => norm(a["Descrizione"]).localeCompare(norm(b["Descrizione"]), "it"));

  saveProducts(imported);

  // Se selezionato non esiste più, reset
  if (selectedCode && !imported.find(p => norm(p["Cod."]) === norm(selectedCode))) {
    selectedCode = null;
  }

  setStatus(`Import OK: ${imported.length} prodotti`);
  renderList();
  setSelected(selectedCode);
  renderRecent();
}

/* ===== Salva lotto/scadenza/quantità (carico) ===== */

function saveEntry() {
  const code = norm(selectedCode);
  if (!code) return;

  const lot = norm(lotIn.value);
  const expiry = norm(expIn.value); // yyyy-mm-dd
  const qty = toInt(qtyIn.value);

  if (!qty || qty <= 0) {
    alert("Inserisci una quantità > 0.");
    return;
  }

  const products = loadProducts();
  const idx = products.findIndex(p => norm(p["Cod."]) === code);
  if (idx < 0) {
    alert("Prodotto non trovato (ripeti import).");
    return;
  }

  products[idx]["Giacenza"] = toInt(products[idx]["Giacenza"]) + qty;
  saveProducts(products);

  const lots = loadLots();
  lots.push({
    code,
    lot: lot || "",
    expiry: expiry || "",
    qty,
    created_at: new Date().toISOString(),
  });
  saveLots(lots);

  lotIn.value = "";
  expIn.value = "";
  qtyIn.value = "";

  setSelected(code);
  renderList();
  renderRecent();

  setStatus("Salvato ✔");
  setTimeout(() => setStatus(""), 1200);
}

/* ===== Export Excel =====
   - Foglio 1: stesso elenco prodotti con tutte le colonne originali + Giacenza in fondo
   - Foglio 2: Lotti (storico)
*/

function exportExcel() {
  const products = loadProducts();
  if (products.length === 0) {
    alert("Nessun prodotto da esportare. Importa prima il file Excel.");
    return;
  }

  const lots = loadLots();

  // Determina ordine colonne: prendiamo le colonne originali dalla prima riga importata
  // e mettiamo "Giacenza" in fondo (se non c’è già).
  const first = products[0];
  const baseCols = Object.keys(first).filter(k => k !== "Giacenza");
  const cols = [...baseCols, "Giacenza"];

  // Ricostruisce righe rispettando ordine colonne
  const prodRows = products.map(p => {
    const out = {};
    for (const c of cols) out[c] = p[c] ?? "";
    return out;
  });

  const lotRows = lots.map(r => ({
    "Cod.": r.code,
    "Lotto": r.lot ?? "",
    "Scadenza": r.expiry ?? "",
    "Quantità": r.qty ?? 0,
    "Data": r.created_at ?? "",
  }));

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(prodRows, { header: cols });
  ws1["!cols"] = cols.map(h => ({ wch: Math.min(40, Math.max(10, h.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws1, "Prodotti");

  const ws2 = XLSX.utils.json_to_sheet(lotRows);
  ws2["!cols"] = [{ wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Lotti");

  XLSX.writeFile(wb, "inventario_aggiornato.xlsx");
}

/* ===== Eventi ===== */

// Import automatico appena scegli il file (più comodo da telefono)
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    setStatus("Import in corso...");
    await importExcel(file);
  } catch (e) {
    alert("Errore import: " + (e?.message || String(e)));
    setStatus("");
  } finally {
    fileInput.value = "";
  }
});

btnExport.addEventListener("click", exportExcel);
searchIn.addEventListener("input", renderList);
btnSave.addEventListener("click", saveEntry);

// sicurezza: abilita salva solo se c’è selezione
setInterval(() => { btnSave.disabled = !norm(selectedCode); }, 400);

/* ===== Init ===== */
(function init() {
  setStatus("");
  renderList();
  renderRecent();
  setSelected(null);
})();
