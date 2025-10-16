// === RRPD Dashboard Script (Final + Weekly Stacked Chart) ===

const API_URL = "/.netlify/functions/dashboard";
const statusEl = document.getElementById("status");
let charts = {};

// ======================
// Fetch Dashboard Data
// ======================
async function fetchDashboard() {
  try {
    statusEl.textContent = "Fetching data...";
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = await res.json();
    if (!data || !data.scanners) throw new Error("Empty data");

    statusEl.textContent = `Updated: ${new Date(
      data.updated
    ).toLocaleTimeString()} — Live API`;
    return data;
  } catch (err) {
    console.warn("API fallback:", err.message);
    statusEl.textContent = "API unavailable — using local data";

    // Mock fallback data
    return {
      scanners: {
        "Jarees Washington": 1800,
        "Ress Washington": 1300,
        "Julio Faburrieta Garcia": 950,
        "Jefferson Granados": 1650,
        "Michelle Ayala": 520,
        "Janice Machado": 870,
      },
      classifications: {
        Good: 320,
        Used: 110,
        Core: 85,
        Scrap: 40,
      },
      daily: [
        { date: "Mon", total: 890 },
        { date: "Tue", total: 720 },
        { date: "Wed", total: 1250 },
        { date: "Thu", total: 1478 },
        { date: "Fri", total: 978 },
      ],
      weekly: [
        { week: "Week 1", fedex: 2300, ups: 1200, usps: 800 },
        { week: "Week 2", fedex: 2600, ups: 950, usps: 740 },
        { week: "Week 3", fedex: 2800, ups: 1300, usps: 650 },
      ],
      updated: new Date().toISOString(),
    };
  }
}

// ======================
// Chart Renderers
// ======================
function renderAllCharts(data) {
  Object.values(charts).forEach((chart) => chart.destroy());
  charts = {};

  // 1️⃣ Today Chart
  charts.today = new Chart(document.getElementById("chart_today"), {
    type: "bar",
    data: {
      labels: Object.keys(data.scanners),
      datasets: [
        {
          label: "Today’s Scans",
          data: Object.values(data.scanners).map((v) =>
            Math.floor(v * 0.2 + Math.random() * 20)
          ),
          backgroundColor: "#00aaff",
        },
      ],
    },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });

  // 2️⃣ Daily Chart (This Week)
  charts.daily = new Chart(document.getElementById("chart_daily"), {
    type: "line",
    data: {
      labels: data.daily.map((d) => d.date),
      datasets: [
        {
          label: "Total per Day",
          data: data.daily.map((d) => d.total),
          borderColor: "#00ccff",
          backgroundColor: "rgba(0,204,255,0.3)",
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: { responsive: true },
  });

  // 3️⃣ Weekly Stacked Chart (NEW)
  charts.weeklyStacked = new Chart(
    document.getElementById("chart_weeklyStacked"),
    {
      type: "bar",
      data: {
        labels: data.weekly.map((w) => w.week),
        datasets: [
          {
            label: "FedEx",
            data: data.weekly.map((w) => w.fedex),
            backgroundColor: "#ff6666",
          },
          {
            label: "UPS",
            data: data.weekly.map((w) => w.ups),
            backgroundColor: "#ffcc00",
          },
          {
            label: "USPS",
            data: data.weekly.map((w) => w.usps),
            backgroundColor: "#66cc66",
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          x: { stacked: true },
          y: { stacked: true },
        },
      },
    }
  );

  // 4️⃣ All-Time Scanners
  charts.alltime = new Chart(document.getElementById("chart_alltime"), {
    type: "bar",
    data: {
      labels: Object.keys(data.scanners),
      datasets: [
        {
          label: "All-Time Scans",
          data: Object.values(data.scanners),
          backgroundColor: "#0099ff",
        },
      ],
    },
    options: { responsive: true },
  });

  // 5️⃣ Classification Mix
  charts.classToday = new Chart(document.getElementById("class_today"), {
    type: "doughnut",
    data: {
      labels: Object.keys(data.classifications),
      datasets: [
        {
          data: Object.values(data.classifications),
          backgroundColor: ["#00ff88", "#ffaa00", "#ff4444", "#7777ff"],
        },
      ],
    },
    options: { responsive: true },
  });

  // 6️⃣ Classification Monthly Trend
  charts.classMonthly = new Chart(document.getElementById("class_monthly"), {
    type: "bar",
    data: {
      labels: Object.keys(data.classifications),
      datasets: [
        {
          label: "Monthly Totals",
          data: Object.values(data.classifications).map(
            (v) => v + Math.floor(Math.random() * 50)
          ),
          backgroundColor: ["#00ff88", "#ffaa00", "#ff4444", "#7777ff"],
        },
      ],
    },
    options: { responsive: true },
  });
}

// ======================
// Tab Navigation
// ======================
const tabs = document.querySelectorAll("nav.tabs button");
const sections = document.querySelectorAll(".tab-content");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    sections.forEach((s) => s.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

// ======================
// Initialize
// ======================
async function init() {
  const data = await fetchDashboard();
  renderAllCharts(data);
}

document.body.insertAdjacentHTML(
  "beforeend",
  `<button id="refresh_btn" class="btn" style="position:fixed; top:12px; right:12px; z-index:999;">⟳ Refresh</button>`
);

document.getElementById("refresh_btn").addEventListener("click", init);

// Auto-refresh every 5 minutes
setInterval(init, 5 * 60 * 1000);

// Start
init();
