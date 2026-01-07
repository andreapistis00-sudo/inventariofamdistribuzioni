/* =========================================================
   Inventario (solo prodotti da file Excel .xlsx)
   - Importa lista prodotti (.xlsx) -> crea/aggiorna catalogo
   - NON permette di aggiungere nuovi prodotti dal sito
   - Cerca prodotto -> seleziona -> inserisci lotto/scadenza/quantità
   - Aggiorna giacenza (somma qty)
   - Export .xlsx con 2 fogli:
       1) Prodotti (giacenze aggiornate)
       2) Lotti (inserimenti lotto/scadenza/qty/data)
   - Mobile-first, dati salvati nel browser (LocalStorage)
   ========================================================= */

const STORE_PRODUCTS = "inv_products_v1";
const STORE_LOTS = "inv_lots_v1";

const el = (id) => document.getElementById(id);

const fileInput = el("file");
const btnImport = el("btnImport");
const btnExport = el("btnExport");

const searchIn = el("search");
const count = el("count");
const statusEl = el("status");

const listEl = el("list");

const selSkuEl = el("selSku");
const selNameEl = el("selName");
const selQtyEl = el("selQty");
const selectedHint = el("selectedHint");

const lotIn = el("lot");
const expIn = el("exp");
const qtyIn = el("qty");
const btnSave = el("btnSave");

const recentEl = el("recent");

let selectedSku = null;

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

function normalizeSku(s) {
  return (s ?? "").toString().trim();
}
function normalizeText(s) {
  return (s ?? "").toString().trim();
}
function toInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.trunc(x);
}
function fmtDateISO(d) {
  try { return new Date(d).toISOString(); } catch { return new Date().toISOString(); }
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===== UI ===== */

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function setSelected(sku) {
  selectedSku = sku;
  const products = loadProducts();
  const p = products.find(x => normalizeSku(x.sku) === normalizeSku(sku)) || null;

  if (!p) {
    selSkuEl.textContent = "—";
    selNameEl.textContent = "Nessun prodotto selezionato";
    selQtyEl.textContent = "0";
    selectedHint.textContent = "Seleziona un prodotto dalla lista.";
    btnSave.disabled = true;
    return;
  }

  selSkuEl.textContent = p.sku;
  selNameEl.textContent = p.name;
  selQtyEl.textContent = String(p.qty ?? 0);
  selectedHint.textContent = "Compila lotto, scadenza e quantità, poi salva.";
  btnSave.disabled = false;

  // evidenzia selezionato
  for (const node of listEl.querySelectorAll(".item")) {
    node.classList.toggle("selected", node.dataset.sku === p.sku);
  }
}

function renderList() {
  const products = loadProducts();
  const q = normalizeText(searchIn.value).toLowerCase();

  const filtered = q
    ? products.filter(p =>
        (p.sku || "").toLowerCase().includes(q) ||
        (p.name || "").toLowerCase().includes(q)
      )
    : products;

  count.textContent = products.length
    ? `${filtered.length} risultati (totale prodotti: ${products.length})`
    : `Nessun prodotto caricato. Importa un file .xlsx`;

  listEl.innerHTML = "";

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="muted small" style="padding:10px;">
        ${products.length ? "Nessun risultato." : "Importa un Excel per vedere i prodotti."}
      </div>`;
    return;
  }

  for (const p of filtered) {
    const div = document.createElement("div");
    div.className = "item" + (selectedSku === p.sku ? " selected" : "");
    div.dataset.sku = p.sku;

    div.innerHTML = `
      <div class="badge">${escapeHtml(p.sku)}</div>
      <div>
        <div class="itemTitle">${escapeHtml(p.name)}</div>
        <div class="itemMeta">
          <span>Giacenza: <b>${p.qty ?? 0}</b></span>
          ${p.location ? `<span>Pos: ${escapeHtml(p.location)}</span>` : ""}
        </div>
      </div>
    `;

    div.addEventListener("click", () => setSelected(p.sku));
    listEl.appendChild(div);
  }
}

function renderRecent() {
  const lots = loadLots();
  const products = loadProducts();
  const mapName = new Map(products.map(p => [p.sku, p.name]));

  const last = lots.slice(-8).reverse();
  recentEl.innerHTML = "";

  if (last.length === 0) {
    recentEl.innerHTML = `<div class="muted small">Nessun inserimento ancora.</div>`;
    return;
  }

  for (const r of last) {
    const div = document.createElement("div");
    div.className = "recentRow";
    const name = mapName.get(r.sku) || "";
    const exp = r.expiry ? r.expiry : "—";
    div.innerHTML = `
      <div><b>${escapeHtml(r.sku)}</b> ${escapeHtml(name)}</div>
      <div class="muted small">Lotto: ${escapeHtml(r.lot || "—")} • Scad: ${escapeHtml(exp)} • Qty: <b>${r.qty}</b></div>
    `;
    recentEl.appendChild(div);
  }
}

/* ===== Import Excel (.xlsx) =====
   Atteso: intestazioni nel primo foglio
   sku, name, qty (opzionale), location (opzionale), notes (opzionale)
*/

async function importExcel(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Nessun foglio trovato.");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (!rows.length) throw new Error("File Excel vuoto.");

  // Supporta intestazioni con maiuscole/minuscole diverse
  const pick = (obj, key) => {
    const keys = Object.keys(obj);
    const found = keys.find(k => k.trim().toLowerCase() === key);
    return found ? obj[found] : "";
  };

  const products = [];
  const seen = new Set();

  for (const r of rows) {
    const sku = normalizeSku(pick(r, "sku"));
    const name = normalizeText(pick(r, "name"));
    if (!sku || !name) continue;

    if (seen.has(sku)) continue;
    seen.add(sku);

    products.push({
      sku,
      name,
      qty: toInt(pick(r, "qty")),           // se assente -> 0
      location: normalizeText(pick(r, "location")),
      notes: normalizeText(pick(r, "notes")),
      updated_at: new Date().toISOString(),
    });
  }

  if (products.length === 0) {
    throw new Error("Nessuna riga valida trovata. Servono almeno sku e name.");
  }

  products.sort((a, b) => (a.name || "").localeCompare(b.name || "", "it"));

  // Import = “catalogo ufficiale”: sostituiamo i prodotti,
  // MA preserviamo le giacenze già inserite se lo SKU esiste.
  const old = loadProducts();
  const oldMap = new Map(old.map(p => [p.sku, p]));

  for (const p of products) {
    const prev = oldMap.get(p.sku);
    if (prev) {
      // mantieni qty attuale (già lavorata dal sito) e aggiorna anagrafica
      p.qty = toInt(prev.qty);
    }
  }

  saveProducts(products);

  // Se lo SKU selezionato non esiste più, deseleziona
  if (selectedSku && !products.find(p => p.sku === selectedSku)) {
    selectedSku = null;
  }

  setStatus(`Import OK: ${products.length} prodotti`);
  renderList();
  setSelected(selectedSku);
}

/* ===== Salvataggio lotto/scadenza/quantità ===== */

function saveEntry() {
  const sku = normalizeSku(selectedSku);
  if (!sku) return;

  const lot = normalizeText(lotIn.value);
  const expiry = normalizeText(expIn.value); // yyyy-mm-dd (da input date)
  const qty = toInt(qtyIn.value);

  if (!qty || qty <= 0) {
    alert("Inserisci una quantità > 0.");
    return;
  }

  // aggiorna giacenza prodotto
  const products = loadProducts();
  const idx = products.findIndex(p => p.sku === sku);
  if (idx < 0) {
    alert("Prodotto non trovato (riprova con import).");
    return;
  }

  products[idx].qty = toInt(products[idx].qty) + qty;
  products[idx].updated_at = new Date().toISOString();
  saveProducts(products);

  // salva riga lotto
  const lots = loadLots();
  lots.push({
    sku,
    lot: lot || "",
    expiry: expiry || "",
    qty,
    created_at: new Date().toISOString(),
  });
  saveLots(lots);

  // reset campi veloci per inserimento successivo
  lotIn.value = "";
  expIn.value = "";
  qtyIn.value = "";

  // aggiorna UI
  setSelected(sku);
  renderList();
  renderRecent();
  setStatus("Salvato ✔");
  setTimeout(() => setStatus(""), 1200);
}

/* ===== Export Excel (.xlsx) ===== */

function exportExcel() {
  const products = loadProducts();
  if (products.length === 0) {
    alert("Nessun prodotto da esportare. Importa prima un file .xlsx.");
    return;
  }

  const lots = loadLots();

  const sheetProducts = products.map(p => ({
    sku: p.sku,
    name: p.name,
    qty: p.qty ?? 0,
    location: p.location ?? "",
    notes: p.notes ?? "",
    updated_at: p.updated_at ?? "",
  }));

  const sheetLots = lots.map(r => ({
    sku: r.sku,
    lot: r.lot ?? "",
    expiry: r.expiry ?? "",
    qty: r.qty ?? 0,
    created_at: r.created_at ?? "",
  }));

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(sheetProducts);
  ws1["!cols"] = [
    { wch: 14 }, { wch: 34 }, { wch: 10 }, { wch: 14 }, { wch: 28 }, { wch: 22 }
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "Prodotti");

  const ws2 = XLSX.utils.json_to_sheet(sheetLots);
  ws2["!cols"] = [
    { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 22 }
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Lotti");

  XLSX.writeFile(wb, "inventario_aggiornato.xlsx");
}

/* ===== Eventi ===== */

btnImport.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) return alert("Seleziona un file Excel (.xlsx) e poi premi OK.");
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

searchIn.addEventListener("input", () => {
  renderList();
});

listEl.addEventListener("click", () => {
  // niente: click gestito sui singoli item
});

btnSave.addEventListener("click", saveEntry);

// abilita/disabilita salva se selezionato
function refreshSaveEnabled() {
  btnSave.disabled = !normalizeSku(selectedSku);
}
setInterval(refreshSaveEnabled, 400); // leggerissimo, evita edge case UI

/* ===== Init ===== */

(function init() {
  setStatus("");
  renderList();
  renderRecent();
  setSelected(null);

  // se c'erano dati precedenti e solo 1 prodotto, selezionalo per comodità
  const products = loadProducts();
  if (products.length === 1) setSelected(products[0].sku);
})();
