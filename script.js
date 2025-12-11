console.log("RRPD final script loaded");

const API = "/.netlify/functions/dashboard";

const statusEl = document.getElementById("status_text");
const updatedSmall = document.getElementById("updated_small");
const refreshBtn = document.getElementById("refresh_btn");

let charts = {};

function makeChart(id, type, labels, values, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor:
            type === "doughnut"
              ? [
                  "#00bfff",
                  "#36cfc9",
                  "#ffd666",
                  "#ff7875",
                  "#9254de",
                  "#5cdbd3"
                ]
              : "#00bfff",
          borderColor: type === "doughnut" ? "#001529" : "#007acc",
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#f5f8ff", font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${ctx.parsed}`
          }
        }
      },
      scales:
        type === "doughnut"
          ? {}
          : {
              x: { ticks: { color: "#f5f8ff" } },
              y: {
                beginAtZero: true,
                ticks: { color: "#f5f8ff" }
              }
            }
    }
  });
}

/* ---------- render helpers ---------- */

function renderDashboard(daily, weekly) {
  const dayLabels = Object.keys(daily || {}).sort();
  const dayValues = dayLabels.map(d => daily[d]);

  const weekLabels = Object.keys(weekly || {});
  const weekValues = weekLabels.map(w => weekly[w]);

  makeChart("chart_daily", "line", dayLabels, dayValues, "Daily Totals");
  makeChart("chart_weekly", "bar", weekLabels, weekValues, "Weekly Totals");
}

function renderScanners(scanners) {
  const labels = Object.keys(scanners || {});
  const values = labels.map(k => scanners[k]);
  makeChart("chart_scanners", "bar", labels, values, "Scans");

  const tbody = document.querySelector("#table_scanners tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  labels
    .map((name, i) => ({ name, count: values[i] }))
    .sort((a, b) => b.count - a.count)
    .forEach(row => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.name}</td><td>${row.count}</td>`;
      tbody.appendChild(tr);
    });
}

function renderClassifications(classifications) {
  const labels = Object.keys(classifications || {});
  const values = labels.map(k => classifications[k]);
  makeChart("chart_class_pie", "doughnut", labels, values, "Counts");

  const tbody = document.querySelector("#table_class tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  labels.forEach((cls, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${cls}</td><td>${values[i]}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------- manual local-only tables ---------- */

function wireManualTable(nameInputId, valInputId, addBtnId, resetBtnId, tableId) {
  const nameInput = document.getElementById(nameInputId);
  const valInput = document.getElementById(valInputId);
  const addBtn = document.getElementById(addBtnId);
  const resetBtn = document.getElementById(resetBtnId);
  const tbody = document.querySelector(`#${tableId} tbody`);

  if (!nameInput || !valInput || !addBtn || !resetBtn || !tbody) return;

  addBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const val = valInput.value.trim();
    if (!name || !val) return;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${val}</td>`;
    tbody.appendChild(tr);
    nameInput.value = "";
    valInput.value = "";
  });

  resetBtn.addEventListener("click", () => {
    tbody.innerHTML = "";
  });
}

/* ---------- tabs ---------- */

function wireTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabs = document.querySelectorAll(".tab");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;

      tabButtons.forEach(b => b.classList.remove("active"));
      tabs.forEach(t => t.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(target).classList.add("active");
    });
  });
}

/* ---------- fetch + init ---------- */

async function fetchDashboard() {
  try {
    statusEl.textContent = "Refreshing…";
    const res = await fetch(API);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = await res.json();
    console.log("Data fetched:", data);

    renderDashboard(data.daily || {}, data.weekly || {});
    renderScanners(data.scanners || {});
    renderClassifications(data.classifications || {});

    const ts = data.updated ? new Date(data.updated) : new Date();
    const pretty = ts.toLocaleString();
    statusEl.textContent = `Updated: ${pretty}`;
    if (updatedSmall) updatedSmall.textContent = `Last updated: ${pretty}`;
  } catch (err) {
    console.warn("API fallback:", err);
    statusEl.textContent = "API unavailable — check logs";
  }
}

function init() {
  wireTabs();

  wireManualTable(
    "carrier_name",
    "carrier_val",
    "carrier_add",
    "carrier_reset",
    "table_carriers"
  );
  wireManualTable(
    "rack_name",
    "rack_val",
    "rack_add",
    "rack_reset",
    "table_racks"
  );

  if (refreshBtn) refreshBtn.addEventListener("click", fetchDashboard);

  fetchDashboard();
  setInterval(fetchDashboard, 2 * 60 * 1000); // every 2 minutes
}

document.addEventListener("DOMContentLoaded", init);
