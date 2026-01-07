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

function render() {
  const items = loadItems();
  const q = normalizeText(searchIn.value).toLowerCase();

  const filtered = q
    ? items.filter(it =>
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

  const idx = items.findIndex(it => normalizeSku(it.sku) === sku);

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

  // Ordina per nome
  items.sort((a, b) => (a.name || "").localeCompare(b.name || "", "it"));

  saveItems(items);
  render();
}

function changeQty(sku, delta) {
  const items = loadItems();
  const idx = items.findIndex(it => normalizeSku(it.sku) === normalizeSku(sku));
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
  const next = items.filter(it => normalizeSku(it.sku) !== normalizeSku(sku));
  saveItems(next);
  render();
}

function editItemPrompt(sku) {
  const items = loadItems();
  const it = items.find(x => normalizeSku(x.sku) === normalizeSku(sku));
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

/* ===== CSV Import/Export ===== */

// Parser CSV semplice: supporta virgole e doppi apici.
// Excel di solito esporta bene con questo.
function parseCSV(text) {
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { pushField(); i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { pushField(); pushRow(); i++; continue; }
      field += c; i++; continue;
    }
  }
  // ultimo campo/riga
  pushField();
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) pushRow();

  return rows;
}

function toCSV(items) {
  const headers = ["sku","name","qty","location","notes","updated_at"];
  const esc = (v) => {
    const s = (v ?? "").toString();
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replaceAll('"','""')}"`;
    }
    return s;
  };

  const lines = [];
  lines.push(headers.join(","));
  for (const it of items) {
    lines.push([
      esc(it.sku),
      esc(it.name),
      esc(it.qty ?? 0),
      esc(it.location ?? ""),
      esc(it.notes ?? ""),
      esc(it.updated_at ?? ""),
    ].join(","));
  }
  return lines.join("\n");
}

async function importCSVFile(file) {
  const text = await file.text();
  const grid = parseCSV(text);

  if (grid.length < 2) {
    alert("CSV vuoto o non valido.");
    return;
  }

  const headers = grid[0].map(h => normalizeText(h).toLowerCase());
  const col = (name) => headers.indexOf(name);

  const skuIdx = col("sku");
  const nameIdx = col("name");
  const qtyIdx = col("qty");
  const locationIdx = col("location");
  const notesIdx = col("notes");

  if (skuIdx < 0 || nameIdx < 0) {
    alert("CSV deve avere almeno le colonne: sku,name (qty consigliata).");
    return;
  }

  const items = loadItems();
  const bySku = new Map(items.map(it => [normalizeSku(it.sku), it]));

  let imported = 0;
  let updated = 0;

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const sku = normalizeSku(row[skuIdx]);
    const name = normalizeText(row[nameIdx]);
    if (!sku || !name) continue;

    const qty = qtyIdx >= 0 ? toInt(row[qtyIdx]) : 0;
    const location = locationIdx >= 0 ? normalizeText(row[locationIdx]) : "";
    const notes = notesIdx >= 0 ? normalizeText(row[notesIdx]) : "";

    const existing = bySku.get(sku);
    const payload = {
      sku, name, qty, location, notes,
      updated_at: new Date().toISOString(),
    };

    if (existing) { Object.assign(existing, payload); updated++; }
    else { items.push(payload); bySku.set(sku, payload); imported++; }
  }

  items.sort((a, b) => (a.name || "").localeCompare(b.name || "", "it"));
  saveItems(items);
  render();

  alert(`Import completato.\nNuovi: ${imported}\nAggiornati: ${updated}`);
}

function exportCSV() {
  const items = loadItems();
  const csv = toCSV(items);

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "inventario.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
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
  if (!file) return alert("Seleziona un file CSV prima di importare.");
  await importCSVFile(file);
  fileInput.value = "";
});

btnExport.addEventListener("click", exportCSV);

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
