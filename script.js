// -------------------------------
// RRPD Receiving Dashboard Script
// -------------------------------

// Function endpoint (Netlify)
const API_DASH = "/.netlify/functions/dashboard";

// Chart instances for cleanup
let scannerChart, classChart, dailyChart, weeklyChart;

// On page load
document.addEventListener("DOMContentLoaded", () => {
  initDashboard();
});

// -------------------------------
// Initialize dashboard
// -------------------------------
function initDashboard() {
  console.log("RRPD Dashboard Script Loaded");

  // Attach buttons
  const refreshBtn = document.getElementById("refresh_btn");
  if (refreshBtn) refreshBtn.addEventListener("click", fetchDashboard);

  document.querySelectorAll("nav button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.target.getAttribute("data-target");
      document.querySelectorAll("section").forEach((sec) =>
        sec.classList.toggle("active", sec.id === target)
      );
    });
  });

  // Manual Add handlers
  setupManualAdd("carrier");
  setupManualAdd("rack");

  // Load data
  fetchDashboard();
}

// -------------------------------
// Fetch Dashboard Data
// -------------------------------
async function fetchDashboard() {
  setStatus("Fetching data...");

  try {
    const res = await fetch(API_DASH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Upstream ${res.status}`);

    const data = await res.json();
    console.log("Data fetched:", data);

    // Validate
    if (!data.scanners || Object.keys(data.scanners).length === 0)
      throw new Error("Empty or invalid data");

    setStatus(`Updated: ${new Date(data.updated).toLocaleTimeString()}`);
    renderAll(data);
  } catch (e) {
    console.warn("API fallback:", e.message);
    setStatus("API unavailable — using local mode");
    renderAll(localFallback());
  }
}

// -------------------------------
// Render All Sections
// -------------------------------
function renderAll(data) {
  renderScanners(data.scanners);
  renderClassifications(data.classifications);
  renderTrends(data.daily, data.weekly);
}

// -------------------------------
// Render Scanners Chart
// -------------------------------
function renderScanners(scanners) {
  const ctx = document.getElementById("scanner_chart");
  const table = document.getElementById("scanner_totals");

  if (!ctx || !table) return;

  const names = Object.keys(scanners);
  const totals = Object.values(scanners);

  table.innerHTML =
    "<tr><th>Scanner</th><th>Count</th></tr>" +
    names.map((n, i) => `<tr><td>${n}</td><td>${totals[i]}</td></tr>`).join("");

  if (scannerChart) scannerChart.destroy();
  scannerChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: names,
      datasets: [
        {
          label: "All-Time (From API)",
          data: totals,
          backgroundColor: "rgba(0, 153, 255, 0.7)",
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

// -------------------------------
// Render Classifications
// -------------------------------
function renderClassifications(classifications) {
  const ctx = document.getElementById("class_chart");
  const table = document.getElementById("class_table");

  if (!ctx || !table) return;

  const labels = Object.keys(classifications);
  const values = Object.values(classifications);

  table.innerHTML =
    "<tr><th>Type</th><th>Count</th></tr>" +
    labels.map((t, i) => `<tr><td>${t}</td><td>${values[i]}</td></tr>`).join("");

  if (classChart) classChart.destroy();
  classChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: ["#4CAF50", "#FF9800", "#F44336", "#2196F3"],
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

// -------------------------------
// Render Trends (Daily + Weekly)
// -------------------------------
function renderTrends(daily, weekly) {
  const dailyCtx = document.getElementById("trend_chart");
  const weeklyCtx = document.getElementById("weekly_chart");

  if (dailyChart) dailyChart.destroy();
  if (weeklyChart) weeklyChart.destroy();

  // Daily Totals
  if (dailyCtx && daily?.length) {
    const labels = daily.map((d) => d.date);
    const values = daily.map((d) => d.total);
    dailyChart = new Chart(dailyCtx, {
      type: "line",
      data: {
        labels,
        datasets: [{ label: "Daily Totals", data: values, borderColor: "#03A9F4" }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }

  // Weekly Totals
  if (weeklyCtx && weekly?.length) {
    const labels = weekly.map((w) => w.week);
    const values = weekly.map((w) => w.fedex + w.ups + w.usps);
    weeklyChart = new Chart(weeklyCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Weekly Totals", data: values, backgroundColor: "#00BCD4" },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }
}

// -------------------------------
// Manual Add / Reset Functions
// -------------------------------
function setupManualAdd(type) {
  const addBtn = document.getElementById(`${type}_add`);
  const resetBtn = document.getElementById(`${type}_reset`);
  const table = document.getElementById(`${type}_table`);

  if (!addBtn || !resetBtn || !table) return;

  addBtn.addEventListener("click", () => {
    const name = document.getElementById(`${type}_name`).value.trim();
    const val = parseInt(document.getElementById(`${type}_val`).value.trim());
    if (!name || isNaN(val)) return alert("Invalid entry");
    const row = document.createElement("tr");
    row.innerHTML = `<td>${name}</td><td>${val}</td>`;
    table.appendChild(row);
  });

  resetBtn.addEventListener("click", () => {
    table.innerHTML = "<tr><th>Name</th><th>Count</th></tr>";
  });
}

// -------------------------------
// Helpers
// -------------------------------
function setStatus(text) {
  const status = document.getElementById("status");
  if (status) status.textContent = text;
}

function localFallback() {
  return {
    scanners: { Sample1: 50, Sample2: 75 },
    classifications: { Good: 10, Used: 20, Core: 15 },
    daily: [{ date: "2025-10-16", total: 100 }],
    weekly: [{ week: "Week 1", fedex: 50, ups: 30, usps: 20 }],
    updated: new Date().toISOString(),
  };
}
