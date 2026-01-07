const STORE_PRODUCTS = "inv_products_custom_v2";
const STORE_LOTS = "inv_lots_custom_v2";

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
function saveProducts(products) { saveJSON(STORE_PRODUCTS, products); }
function loadLots() {
  const arr = loadJSON(STORE_LOTS, []);
  return Array.isArray(arr) ? arr : [];
}
function saveLots(lots) { saveJSON(STORE_LOTS, lots); }

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

/* ===== Header matching più robusto ===== */
function normalizeHeaderName(h) {
  return norm(h)
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replaceAll("à", "a")
    .replaceAll("è", "e")
    .replaceAll("é", "e")
    .replaceAll("ì", "i")
    .replaceAll("ò", "o")
    .replaceAll("ù", "u");
}

function findKey(rowObj, aliases) {
  const keys = Object.keys(rowObj);
  const map = new Map(keys.map(k => [normalizeHeaderName(k), k]));
  for (const a of aliases) {
    const hit = map.get(normalizeHeaderName(a));
    if (hit) return hit;
  }
  return null;
}

/* ===== UI ===== */
function setSelected(code) {
  selectedCode = code;
  const products = loadProducts();
  const p = products.find(x => norm(x.__code) === norm(code)) || null;

  if (!p) {
    selCodeEl.textContent = "—";
    selDescEl.textContent = "Nessun prodotto selezionato";
    selStockEl.textContent = "0";
    selUmEl.textContent = "";
    selectedHintEl.textContent = "Seleziona un prodotto dalla lista.";
    btnSave.disabled = true;
    return;
  }

  selCodeEl.textContent = p.__code || "—";
  selDescEl.textContent = p.__desc || "";
  selStockEl.textContent = String(p.Giacenza ?? 0);
  selUmEl.textContent = p["U.m."] ? ` • ${p["U.m."]}` : "";
  selectedHintEl.textContent = "Inserisci lotto, scadenza e quantità, poi salva.";
  btnSave.disabled = false;

  for (const node of listEl.querySelectorAll(".item")) {
    node.classList.toggle("selected", node.dataset.code === p.__code);
  }
}

function renderList() {
  const products = loadProducts();
  const q = norm(searchIn.value).toLowerCase();

  const filtered = q
    ? products.filter(p => (p.__code || "").toLowerCase().includes(q) || (p.__desc || "").toLowerCase().includes(q))
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
    const div = document.createElement("div");
    div.className = "item" + (selectedCode === p.__code ? " selected" : "");
    div.dataset.code = p.__code;

    const extra = [];
    if (p["Categoria"]) extra.push(`Cat: ${p["Categoria"]}`);
    if (p["U.m."]) extra.push(`UM: ${p["U.m."]}`);

    div.innerHTML = `
      <div class="badge">${escapeHtml(p.__code)}</div>
      <div>
        <div class="itemTitle">${escapeHtml(p.__desc)}</div>
        <div class="itemMeta">
          <span>Giacenza: <b>${p.Giacenza ?? 0}</b></span>
          ${extra.length ? `<span>${escapeHtml(extra.join(" • "))}</span>` : ""}
        </div>
      </div>
    `;
    div.addEventListener("click", () => setSelected(p.__code));
    listEl.appendChild(div);
  }
}

function renderRecent() {
  const lots = loadLots();
  const products = loadProducts();
  const mapDesc = new Map(products.map(p => [p.__code, p.__desc]));

  const last = lots.slice(-8).reverse();
  recentEl.innerHTML = "";

  if (last.length === 0) {
    recentEl.innerHTML = `<div class="muted small">Nessun inserimento ancora.</div>`;
    return;
  }

  for (const r of last) {
    const div = document.createElement("div");
    div.className = "recentRow";
    div.innerHTML = `
      <div><b>${escapeHtml(r.code)}</b> ${escapeHtml(mapDesc.get(r.code) || "")}</div>
      <div class="muted small">Lotto: ${escapeHtml(r.lot || "—")} • Scad: ${escapeHtml(r.expiry || "—")} • Qty: <b>${r.qty}</b></div>
    `;
    recentEl.appendChild(div);
  }
}

/* ===== Import Excel ===== */
async function importExcel(file) {
  if (typeof XLSX === "undefined") throw new Error("Libreria XLSX non caricata.");

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Nessun foglio trovato nel file.");

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (!rows.length) throw new Error("File Excel vuoto.");

  // Trova colonne code/descrizione con alias
  const kCode = findKey(rows[0], ["Cod.", "Cod", "Codice", "Cod articolo"]);
  const kDesc = findKey(rows[0], ["Descrizione", "Descriz.", "Descrizione articolo", "Articolo"]);

  if (!kCode || !kDesc) {
    const headersFound = Object.keys(rows[0]).join(", ");
    throw new Error(
      `Non trovo le colonne richieste.\nServe: Cod. e Descrizione.\nHo trovato: ${headersFound}`
    );
  }

  const imported = [];
  const seen = new Set();

  for (const r of rows) {
    const code = norm(r[kCode]);
    const desc = norm(r[kDesc]);

    // salta righe non-prodotto
    if (!code || !desc) continue;
    if (code.toLowerCase().includes("produttore")) continue;

    if (seen.has(code)) continue;
    seen.add(code);

    const obj = { ...r };
    // Campi interni per ricerca/chiave (senza rovinare colonne originali)
    obj.__code = code;
    obj.__desc = desc;

    // Giacenza gestita dal sito
    obj.Giacenza = 0;

    // Se nel file esiste già una colonna giacenza, la rispettiamo
    const maybeStockKey = findKey(r, ["Giacenza", "Giacenze", "Stock"]);
    if (maybeStockKey) obj.Giacenza = toInt(r[maybeStockKey]);

    imported.push(obj);
  }

  if (imported.length === 0) {
    throw new Error("Non ho trovato righe prodotto valide (Cod. + Descrizione).");
  }

  // preserva giacenze già lavorate
  const old = loadProducts();
  const oldMap = new Map(old.map(p => [p.__code, p]));

  for (const p of imported) {
    const prev = oldMap.get(p.__code);
    if (prev) p.Giacenza = toInt(prev.Giacenza);
  }

  imported.sort((a, b) => norm(a.__desc).localeCompare(norm(b.__desc), "it"));
  saveProducts(imported);

  if (selectedCode && !imported.find(p => p.__code === selectedCode)) selectedCode = null;

  renderList();
  setSelected(selectedCode);
  renderRecent();
}

/* ===== Salvataggio lotto ===== */
function saveEntry() {
  const code = norm(selectedCode);
  if (!code) return alert("Seleziona un prodotto.");

  const qty = toInt(qtyIn.value);
  if (!qty || qty <= 0) return alert("Inserisci una quantità > 0.");

  const lot = norm(lotIn.value);
  const expiry = norm(expIn.value);

  const products = loadProducts();
  const idx = products.findIndex(p => p.__code === code);
  if (idx < 0) return alert("Prodotto non trovato.");

  products[idx].Giacenza = toInt(products[idx].Giacenza) + qty;
  saveProducts(products);

  const lots = loadLots();
  lots.push({ code, lot: lot || "", expiry: expiry || "", qty, created_at: new Date().toISOString() });
  saveLots(lots);

  lotIn.value = "";
  expIn.value = "";
  qtyIn.value = "";

  renderList();
  setSelected(code);
  renderRecent();
  setStatus("Salvato ✔");
  setTimeout(() => setStatus(""), 1200);
}

/* ===== Export ===== */
function exportExcel() {
  const products = loadProducts();
  if (!products.length) return alert("Importa prima un file Excel.");

  // colonne originali: prendiamo tutte tranne quelle interne
  const first = products[0];
  const baseCols = Object.keys(first).filter(k => !k.startsWith("__") && k !== "Giacenza");
  const cols = [...baseCols, "Giacenza"];

  const prodRows = products.map(p => {
    const out = {};
    for (const c of cols) out[c] = p[c] ?? "";
    out.Giacenza = p.Giacenza ?? 0;
    return out;
  });

  const lots = loadLots();
  const lotRows = lots.map(r => ({
    "Cod.": r.code,
    "Lotto": r.lot ?? "",
    "Scadenza": r.expiry ?? "",
    "Quantità": r.qty ?? 0,
    "Data": r.created_at ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(prodRows, { header: cols });
  XLSX.utils.book_append_sheet(wb, ws1, "Prodotti");

  const ws2 = XLSX.utils.json_to_sheet(lotRows);
  XLSX.utils.book_append_sheet(wb, ws2, "Lotti");

  XLSX.writeFile(wb, "inventario_aggiornato.xlsx");
}

/* ===== Eventi ===== */
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    setStatus("Import in corso...");
    await importExcel(file);
    setStatus("Import OK ✔");
    setTimeout(() => setStatus(""), 1500);
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

setInterval(() => { btnSave.disabled = !norm(selectedCode); }, 400);

/* ===== Init ===== */
(function init() {
  renderList();
  renderRecent();
  setSelected(null);
})();
