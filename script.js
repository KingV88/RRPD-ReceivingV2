console.log("RRPD Dashboard Script Loaded");

// ===== CONFIG =====
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const DASHBOARD_API = "/api/dashboard";

// ===== MAIN LOAD =====
document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#loading").textContent = "Fetching data...";
  const data = await fetchData();
  renderDashboard(data);

  // Manual refresh
  document.getElementById("refresh_btn").addEventListener("click", async () => {
    document.querySelector("#loading").textContent = "Refreshing...";
    const newData = await fetchData();
    renderDashboard(newData);
  });

  // Auto refresh every 15 min
  setInterval(async () => {
    console.log("Auto refreshing dashboard...");
    const updated = await fetchData();
    renderDashboard(updated);
  }, REFRESH_INTERVAL);
});

// ===== FETCH DATA =====
async function fetchData() {
  try {
    const res = await fetch(DASHBOARD_API);
    const data = await res.json();

    if (!data || !data.scanners) {
      console.warn("⚠️ API returned no data, using fallback.");
      document.querySelector("#loading").textContent =
        "Error fetching data — using local fallback.";
      return getFallbackData();
    }

    console.log("✅ Data fetched:", data);
    document.querySelector("#loading").textContent = "Data loaded successfully.";
    return data;
  } catch (err) {
    console.error("❌ Fetch error:", err);
    document.querySelector("#loading").textContent =
      "Error fetching data — using local fallback.";
    return getFallbackData();
  }
}

// ===== FALLBACK DATA =====
function getFallbackData() {
  return {
    scanners: {
      "Jarees Washington": 0,
      "Ress Washington": 0,
      "Julio Faburrieta Garcia": 0,
      "Jefferson Granados": 0,
    },
    classifications: {
      Good: 0,
      Used: 0,
      Core: 0,
      Damaged: 0,
      Missing: 0,
      "Not Our Part": 0,
    },
    trend: [],
  };
}

// ===== RENDER DASHBOARD =====
function renderDashboard(data) {
  console.log("Rendering dashboard...");

  // Render scanners
  const scannerTable = document.getElementById("scanner_totals");
  if (scannerTable && data && data.scanners) {
    scannerTable.innerHTML = `
      <tr><th>Scanner</th><th>Count</th></tr>
      ${Object.entries(data.scanners)
        .map(([name, count]) => `<tr><td>${name}</td><td>${count}</td></tr>`)
        .join("")}
    `;
  }

  // Render classifications
  const classTable = document.getElementById("class_table");
  if (classTable && data && data.classifications) {
    classTable.innerHTML = `
      <tr><th>Classification</th><th>Count</th></tr>
      ${Object.entries(data.classifications)
        .map(([type, count]) => `<tr><td>${type}</td><td>${count}</td></tr>`)
        .join("")}
    `;
  }

  // Render Miss Inspections placeholder
  const missTable = document.getElementById("miss_table");
  if (missTable) {
    missTable.innerHTML = `<tr><td colspan="2">No missed inspections logged.</td></tr>`;
  }

  // Render charts
  renderCharts(data);
}

// ===== RENDER CHARTS =====
function renderCharts(data) {
  const classCtx = document.getElementById("class_chart");
  const trendCtx = document.getElementById("trend_chart");

  if (classCtx && data && data.classifications) {
    const labels = Object.keys(data.classifications);
    const values = Object.values(data.classifications);
    new Chart(classCtx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            label: "Classifications",
            data: values,
            backgroundColor: [
              "#007bff",
              "#6c757d",
              "#ffc107",
              "#dc3545",
              "#6610f2",
              "#198754",
            ],
          },
        ],
      },
    });
  }

  if (trendCtx && data && Array.isArray(data.trend)) {
    const labels = data.trend.map((t) => t.date);
    const values = data.trend.map((t) => t.total);
    new Chart(trendCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Daily Trend",
            data: values,
            backgroundColor: "#0d6efd",
          },
        ],
      },
    });
  }
}
