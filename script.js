// ===============================
// RRPD RECEIVING DASHBOARD SCRIPT
// ===============================

console.log("RRPD Dashboard Script Loaded");

// ----- CONFIG -----
const API = "/.netlify/functions/dashboard";  // Correct path for Netlify function
const refreshBtn = document.getElementById("refresh_btn");
const statusEl = document.getElementById("status");
const chartsDiv = document.getElementById("chartsDiv");
let charts = {};  // Chart.js instances

// ----- FETCH DASHBOARD DATA -----
async function fetchDashboard() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);

    const data = await res.json();
    console.log("✅ Data fetched:", data);

    renderAll(data);
    updateStatus("Updated: " + new Date().toLocaleTimeString());
  } catch (e) {
    console.warn("⚠️ API fallback:", e.message);
    updateStatus("API unavailable — local mode");
  }
}

// ----- RENDER ALL DASHBOARD SECTIONS -----
function renderAll(data) {
  const scanners = data.scanners || {};
  const classifications = data.classifications || {};
  const weekly = data.weekly || {};
  const totals = data.totals || {};

  // Dashboard charts
  renderChart("trend_chart", "Daily Totals", totals.labels || Object.keys(totals), totals.values || Object.values(totals));
  renderChart("weekly_chart", "Weekly Totals", Object.keys(weekly), Object.values(weekly));

  // Scanner charts + table
  renderChart("scanner_chart", "Scans by User", Object.keys(scanners), Object.values(scanners));
  renderTable("scanner_totals", scanners);

  // Classification charts + table
  renderChart("class_chart", "Classification Counts", Object.keys(classifications), Object.values(classifications));
  renderTable("class_table", classifications);
}

// ----- CHART RENDERING -----
function renderChart(id, label, labels, values) {
  const ctx = document.getElementById(id);
  if (!ctx) return;

  if (charts[id]) {
    charts[id].destroy(); // Prevent duplicate charts
  }

  charts[id] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: label,
          data: values,
          backgroundColor: "rgba(0, 191, 255, 0.6)",
          borderColor: "#00bfff",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#fff" } },
      },
      scales: {
        x: {
          ticks: { color: "#fff" },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
        y: {
          ticks: { color: "#fff" },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
      },
    },
  });
}

// ----- TABLE RENDERING -----
function renderTable(id, obj) {
  const el = document.getElementById(id);
  if (!el) return;

  el.innerHTML =
    "<tr><th>Name</th><th>Count</th></tr>" +
    Object.entries(obj)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
      .join("");
}

// ----- STATUS BAR -----
function updateStatus(msg) {
  if (statusEl) {
    statusEl.textContent = msg;
  }
}

// ----- MANUAL ENTRY (RACKS / CARRIERS) -----
const addBtn = document.getElementById("rack_add");
const resetBtn = document.getElementById("rack_reset");
const rackTable = document.getElementById("rack_table");

if (addBtn && resetBtn && rackTable) {
  addBtn.addEventListener("click", () => {
    const name = document.getElementById("rack_name").value.trim();
    const val = document.getElementById("rack_val").value.trim();
    if (!name || !val) return;
    rackTable.innerHTML += `<tr><td>${name}</td><td>${val}</td></tr>`;
  });

  resetBtn.addEventListener("click", () => {
    rackTable.innerHTML = "<tr><th>Name</th><th>Count</th></tr>";
  });
}

// ----- TAB SWITCHING -----
document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

// ----- REFRESH BUTTON -----
if (refreshBtn) {
  refreshBtn.addEventListener("click", fetchDashboard);
}

// ----- AUTO REFRESH -----
setInterval(fetchDashboard, 120000); // 2 minutes

// ----- INITIAL LOAD -----
fetchDashboard();
