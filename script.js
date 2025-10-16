console.log("RRPD Dashboard Script Loaded");

const API = "/.netlify/functions/dashboard";
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh_btn");
let charts = {};

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
  }
}

function renderAll(data) {
  const scanners = data.scanners || {};
  const classifications = data.classifications || {};
  const weekly = data.weekly || {};
  const totals = data.totals || {};

  // Dashboard panel
  renderChart("trend_chart", "Daily Totals", totals.labels || Object.keys(totals), totals.values || Object.values(totals));
  renderChart("weekly_chart", "Weekly Totals", Object.keys(weekly), Object.values(weekly));

  // Scanners
  renderChart("scanner_chart", "Scans by User", Object.keys(scanners), Object.values(scanners));
  renderTable("scanner_totals", scanners);

  // Classifications
  renderChart("class_chart", "Classification Counts", Object.keys(classifications), Object.values(classifications));
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
      plugins: {
        legend: { labels: { color: "#fff" } }
      },
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

// Manual entry buttons
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

// Tab switching
document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

refreshBtn.addEventListener("click", fetchDashboard);

// Auto-refresh every 2 minutes
setInterval(fetchDashboard, 120000);

// Initial load
fetchDashboard();
