/* ===========================
   Inventario Magazzino
   - Import/Export Excel .xlsx
   - Cerca prodotto
   - Aggiungi/Aggiorna
   - +1 / -1 / modifica / elimina
   - Salva in LocalStorage
   =========================== */

const STORAGE_KEY = "inventario_items_v1";

const el = (id) => document.getElementById(id);

const fileInput = el("file");
const btnImport = el("btnImport");
const btnExport = el("btnExport");
const btnClear = el("btnClear");

const skuIn = el("sku");
const nameIn = el("name");
const qtyIn = el("qty");
const locationIn = el("location");
const notesIn = el("notes");
const btnAdd = el("btnAdd");

const searchIn = el("search");
const btnReset = el("btnReset");

const rows = el("rows");
const count = el("count");

/* ===== Storage ===== */

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===== Render ===== */

function render() {
  const items = loadItems();
  const q = normalizeText(searchIn.value).toLowerCase();

  const filtered = q
    ? items.filter((it) =>
        (it.sku || "").toLowerCase().includes(q) ||
        (it.name || "").toLowerCase().includes(q)
      )
    : items;

  count.textContent = `${filtered.length} prodotti (totale: ${items.length})`;

  rows.innerHTML = "";
  if (filtered.length === 0) {
    rows.innerHTML = `<tr><td colspan="6" class="muted">Nessun prodotto.</td></tr>`;
    return;
  }

  for (const it of filtered) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="badge">${escapeHtml(it.sku || "-")}</span></td>
      <td>${escapeHtml(it.name || "")}</td>
      <td class="num">${it.qty ?? 0}</td>
      <td>${escapeHtml(it.location || "")}</td>
      <td>${escapeHtml(it.notes || "")}</td>
      <td>
        <div class="actions">
          <button class="ghost" data-act="dec" data-sku="${escapeHtml(it.sku)}">-1</button>
          <button class="ghost" data-act="inc" data-sku="${escapeHtml(it.sku)}">+1</button>
          <button class="ghost" data-act="edit" data-sku="${escapeHtml(it.sku)}">Modifica</button>
          <button class="danger" data-act="del" data-sku="${escapeHtml(it.sku)}">Elimina</button>
        </div>
      </td>
    `;
    rows.appendChild(tr);
  }
}

/* ===== CRUD ===== */

function upsertItem(newItem) {
  const items = loadItems();

  const sku = normalizeSku(newItem.sku);
  if (!sku) {
    alert("SKU obbligatorio (serve per riconoscere univocamente il prodotto).");
    return;
  }

  const name = normalizeText(newItem.name);
  if (!name) {
    alert("Nome prodotto obbligatorio.");
    return;
  }

  const idx = items.findIndex((it) => normalizeSku(it.sku) === sku);

  const payload = {
    sku,
    name,
    qty: toInt(newItem.qty),
    location: normalizeText(newItem.location),
    notes: normalizeText(newItem.notes),
    updated_at: new Date().toISOString(),
  };

  if (idx >= 0) items[idx] = { ...items[idx], ...payload };
  else items.push(payload);

  items.sort((a, b) => (a.name || "").localeCompare(b.name || "", "it"));
  saveItems(items);
  render();
}

function changeQty(sku, delta) {
  const items = loadItems();
  const idx = items.findIndex((it) => normalizeSku(it.sku) === normalizeSku(sku));
  if (idx < 0) return;

  const current = toInt(items[idx].qty);
  const next = current + delta;
  if (next < 0) return;

  items[idx].qty = next;
  items[idx].updated_at = new Date().toISOString();
  saveItems(items);
  render();
}

function deleteItem(sku) {
  const items = loadItems();
  const next = items.filter((it) => normalizeSku(it.sku) !== normalizeSku(sku));
  saveItems(next);
  render();
}

function editItemPrompt(sku) {
  const items = loadItems();
  const it = items.find((x) => normalizeSku(x.sku) === normalizeSku(sku));
  if (!it) return;

  const name = prompt("Nome prodotto:", it.name ?? "");
  if (name === null) return;

  const qty = prompt("Quantità:", String(it.qty ?? 0));
  if (qty === null) return;

  const location = prompt("Posizione:", it.location ?? "");
  if (location === null) return;

  const notes = prompt("Note:", it.notes ?? "");
  if (notes === null) return;

  upsertItem({ sku: it.sku, name, qty, location, notes });
}

/* ===== Excel Import/Export (.xlsx) =====
   Richiede SheetJS (xlsx.full.min.js) caricato in index.html
*/

async function importExcelFile(file) {
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      alert("Nessun foglio trovato nel file Excel.");
      return;
    }

    const sheet = workbook.Sheets[sheetName];
    const excelRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!excelRows.length) {
      alert("File Excel vuoto.");
      return;
    }

    // Normalizza intestazioni attese: sku, name, qty, location, notes
    // sheet_to_json restituisce oggetti basati sulle intestazioni (case sensitive),
    // quindi gestiamo varianti possibili (SKU, Name, ecc.)
    const pick = (obj, key) => {
      const keys = Object.keys(obj);
      const found = keys.find(k => k.trim().toLowerCase() === key);
      return found ? obj[found] : "";
    };

    const items = loadItems();
    const bySku = new Map(items.map((it) => [normalizeSku(it.sku), it]));

    let imported = 0;
    let updated = 0;

    for (const r of excelRows) {
      const sku = normalizeSku(pick(r, "sku"));
      const name = normalizeText(pick(r, "name"));
      if (!sku || !name) continue;

      const payload = {
        sku,
        name,
        qty: toInt(pick(r, "qty")),
        location: normalizeText(pick(r, "location")),
        notes: normalizeText(pick(r, "notes")),
        updated_at: new Date().toISOString(),
      };

      const existing = bySku.get(sku);
      if (existing) {
        Object.assign(existing, payload);
        updated++;
      } else {
        items.push(payload);
        bySku.set(sku, payload);
        imported++;
      }
    }

    items.sort((a, b) => (a.name || "").localeCompare(b.name || "", "it"));
    saveItems(items);
    render();

    alert(`Import completato.\nNuovi: ${imported}\nAggiornati: ${updated}`);
  } catch (err) {
    alert("Errore durante l'import: " + (err?.message || String(err)));
  }
}

function exportExcel() {
  try {
    const items = loadItems();

    const data = items.map((it) => ({
      sku: it.sku,
      name: it.name,
      qty: it.qty ?? 0,
      location: it.location ?? "",
      notes: it.notes ?? "",
      updated_at: it.updated_at ?? "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);

    // Piccolo miglioramento: larghezza colonne (facoltativo)
    worksheet["!cols"] = [
      { wch: 14 }, // sku
      { wch: 32 }, // name
      { wch: 8 },  // qty
      { wch: 14 }, // location
      { wch: 30 }, // notes
      { wch: 22 }, // updated_at
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");

    XLSX.writeFile(workbook, "inventario.xlsx");
  } catch (err) {
    alert("Errore durante l'export: " + (err?.message || String(err)));
  }
}

/* ===== Eventi UI ===== */

btnAdd.addEventListener("click", () => {
  upsertItem({
    sku: skuIn.value,
    name: nameIn.value,
    qty: qtyIn.value,
    location: locationIn.value,
    notes: notesIn.value,
  });
});

rows.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const act = btn.dataset.act;
  const sku = btn.dataset.sku;

  if (act === "inc") changeQty(sku, +1);
  if (act === "dec") changeQty(sku, -1);
  if (act === "edit") editItemPrompt(sku);
  if (act === "del") {
    if (confirm(`Eliminare il prodotto ${sku}?`)) deleteItem(sku);
  }
});

btnImport.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) return alert("Seleziona un file Excel (.xlsx) prima di importare.");
  await importExcelFile(file);
  fileInput.value = "";
});

btnExport.addEventListener("click", exportExcel);

btnClear.addEventListener("click", () => {
  if (!confirm("Sicuro? Cancella tutti i dati salvati su questo browser.")) return;
  localStorage.removeItem(STORAGE_KEY);
  render();
});

searchIn.addEventListener("input", render);

btnReset.addEventListener("click", () => {
  searchIn.value = "";
  render();
});

render();
