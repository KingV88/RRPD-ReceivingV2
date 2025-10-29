console.log("RRPD Dashboard Script Loaded");

const API = "/.netlify/functions/dashboard";
const refreshBtn = document.getElementById("refresh_btn");
const statusEl = document.getElementById("status");
let charts = {};

// ===== Diagnostic Banner =====
function showDiag(msg) {
  const el = document.getElementById("diagnostic-banner");
  if (el) {
    el.style.display = "block";
    el.textContent = `⚠️ ${msg}`;
  }
}

window.addEventListener("load", () => {
  if (typeof pdfjsLib === "undefined") {
    showDiag("PDF module failed to load — Manifest upload unavailable.");
  }
});

// API Connectivity Test
(async () => {
  try {
    const ping = await fetch(API);
    if (!ping.ok) throw new Error(ping.status);
  } catch (e) {
    showDiag("API connection failed — using cached data only.");
  }
})();

// ===== FETCH DATA =====
async function fetchDashboard() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = await res.json();
    console.log("Data fetched:", data);
    renderAll(data);
    statusEl.textContent = "Updated: " + new Date().toLocaleTimeString();
  } catch (e) {
    console.warn("API Fallback:", e.message);
    statusEl.textContent = "API unavailable — local mode";
    showDiag("Unable to fetch dashboard data.");
  }
}

// ===== RENDER PANELS =====
function renderAll(data) {
  const scanners = data.scanners || {};
  const classifications = data.classifications || {};
  const weekly = data.weekly || {};
  const totals = data.totals || {};

  renderChart("trend_chart", "Daily Totals", totals.labels || Object.keys(totals), totals.values || Object.values(totals));
  renderChart("weekly_chart", "Weekly Totals", Object.keys(weekly), Object.values(weekly));
  renderChart("scanner_chart", "Scans by User", Object.keys(scanners), Object.values(scanners));
  renderChart("class_chart", "Classification Mix", Object.keys(classifications), Object.values(classifications));

  renderTable("scanner_totals", scanners);
  renderTable("class_table", classifications);
}

function renderChart(id, label, labels, values) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: "#00bfff",
        borderColor: "#007acc",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#fff" } } },
      scales: {
        x: { ticks: { color: "#fff" } },
        y: { ticks: { color: "#fff" } }
      }
    }
  });
}

function renderTable(id, obj) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = "<tr><th>Name</th><th>Count</th></tr>" +
    Object.entries(obj).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
}

// ===== MANUAL ENTRY =====
const addBtn = document.getElementById("rack_add");
const resetBtn = document.getElementById("rack_reset");
const rackTable = document.getElementById("rack_table");

if (addBtn && resetBtn && rackTable) {
  addBtn.onclick = () => {
    const name = document.getElementById("rack_name").value.trim();
    const val = document.getElementById("rack_val").value.trim();
    if (!name || !val) return;
    rackTable.innerHTML += `<tr><td>${name}</td><td>${val}</td></tr>`;
  };
  resetBtn.onclick = () => (rackTable.innerHTML = "<tr><th>Name</th><th>Count</th></tr>");
}

// ===== PDF MANIFEST READER =====
const pdfInput = document.getElementById("pdfUpload");
const pdfTable = document.getElementById("pdfTable");
const pdfStatus = document.getElementById("pdfStatus");

if (pdfInput) {
  pdfInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    pdfStatus.textContent = "Processing manifests...";
    pdfTable.innerHTML = "<tr><th>File</th><th>Pages</th><th>Items Detected</th></tr>";

    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;
        let itemsFound = 0;

        for (let i = 1; i <= totalPages; i++) {
          const page = await pdf.getPage(i);
          const text = await page.getTextContent();
          const str = text.items.map((t) => t.str).join(" ");
          const matches = str.match(/\b[A-Z0-9]{6,}\b/g); // detect SKU-like patterns
          if (matches) itemsFound += matches.length;
        }

        pdfTable.innerHTML += `<tr><td>${file.name}</td><td>${totalPages}</td><td>${itemsFound}</td></tr>`;
      } catch (err) {
        pdfTable.innerHTML += `<tr><td>${file.name}</td><td>⚠️ Error</td><td>${err.message}</td></tr>`;
      }
    }

    pdfStatus.textContent = "Manifests processed successfully.";
  });
}

// ===== TAB SWITCHING =====
document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
    document.getElementById(btn.dataset.target).classList.add("active");
    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

refreshBtn.addEventListener("click", fetchDashboard);
setInterval(fetchDashboard, 120000);
fetchDashboard();
