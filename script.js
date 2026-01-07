const STORAGE_KEY = "inventario_magazzino";
const SAVE_TIME_KEY = "inventario_salvataggio";

const fileInput = document.getElementById("fileInput");
const tableBody = document.querySelector("#inventoryTable tbody");
const searchInput = document.getElementById("searchInput");
const saveStatus = document.getElementById("saveStatus");

/* ==========================
   CARICAMENTO EXCEL
========================== */
fileInput.addEventListener("change", handleFile);

function handleFile(e) {
    const reader = new FileReader();
    reader.onload = function (evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        saveData(json);
        renderTable(json);
    };
    reader.readAsArrayBuffer(e.target.files[0]);
}

/* ==========================
   RENDER TABELLA
========================== */
function renderTable(data) {
    tableBody.innerHTML = "";

    data.forEach((item, index) => {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${item.sku}</td>
            <td>${item.nome}</td>
            <td>${item.posizione || ""}</td>
            <td><input type="number" value="${item.giacenza}" data-field="giacenza" data-index="${index}"></td>
            <td><input type="text" value="${item.note}" data-field="note" data-index="${index}"></td>
        `;

        tableBody.appendChild(tr);
    });

    attachInputEvents();
}

/* ==========================
   SALVATAGGIO AUTOMATICO
========================== */
function attachInputEvents() {
    document.querySelectorAll("td input").forEach(input => {
        input.addEventListener("input", () => {
            const data = loadData();
            const index = input.dataset.index;
            const field = input.dataset.field;

            data[index][field] = input.value;
            saveData(data);
        });
    });
}

function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    const now = new Date();
    const time = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    localStorage.setItem(SAVE_TIME_KEY, time);

    saveStatus.textContent = `Salvato alle ${time}`;
}

function loadData() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

/* ==========================
   RIPRISTINO AUTOMATICO
========================== */
window.addEventListener("load", () => {
    const data = loadData();
    if (data.length > 0) {
        renderTable(data);
        const time = localStorage.getItem(SAVE_TIME_KEY);
        if (time) saveStatus.textContent = `Salvato alle ${time}`;
    }
});

/* ==========================
   RICERCA
========================== */
searchInput.addEventListener("input", () => {
    const filter = searchInput.value.toLowerCase();
    Array.from(tableBody.rows).forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(filter) ? "" : "none";
    });
});

/* ==========================
   EXPORT EXCEL
========================== */
document.getElementById("exportBtn").addEventListener("click", () => {
    const data = loadData();
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
    XLSX.writeFile(workbook, "inventario_magazzino.xlsx");
});

/* ==========================
   RESET INVENTARIO
========================== */
document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("Sei sicuro di voler cancellare l'inventario salvato?")) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SAVE_TIME_KEY);
        tableBody.innerHTML = "";
        saveStatus.textContent = "Inventario cancellato";
    }
});
