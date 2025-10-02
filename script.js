// -------------------- STATE --------------------
let state = JSON.parse(localStorage.getItem("state")) || {
  scanners: {},
  carriers: {},
  racks: {},
  inspections: {},
  scannerGoal: 400,
  ratioGoal: 100
};

function saveState() {
  localStorage.setItem("state", JSON.stringify(state));
}

// -------------------- NAVIGATION --------------------
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.getElementById(btn.dataset.panel).classList.add("active");
  });
});

// -------------------- HELPERS --------------------
function todayKey() {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
}

// -------------------- SCANNERS --------------------
document.getElementById("scannerForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("scannerName").value.trim();
  const count = parseInt(document.getElementById("scannerCount").value, 10);

  if (!state.scanners[todayKey()]) state.scanners[todayKey()] = {};
  if (!state.scanners[todayKey()][name]) state.scanners[todayKey()][name] = 0;

  state.scanners[todayKey()][name] += count;
  saveState();
  renderScanners();
  e.target.reset();
});

function renderScanners() {
  const today = state.scanners[todayKey()] || {};
  const totalScans = Object.values(today).reduce((a, b) => a + b, 0);

  // Update Home dashboard
  document.getElementById("scansToday").textContent = totalScans;
  const percentGoal = Math.min((totalScans / state.scannerGoal) * 100, 100);
  document.getElementById("scannerGoalProgress").style.width = percentGoal + "%";

  // Daily Donut
  const donutCtx = document.getElementById("scannerDonut").getContext("2d");
  if (window.scannerDonutChart) window.scannerDonutChart.destroy();
  window.scannerDonutChart = new Chart(donutCtx, {
    type: "doughnut",
    data: {
      labels: Object.keys(today),
      datasets: [{ data: Object.values(today), backgroundColor: ["#0077cc", "#00b894", "#fdcb6e", "#d63031"] }]
    }
  });

  // Daily Bar
  const dailyCtx = document.getElementById("scannerDailyChart").getContext("2d");
  if (window.scannerDailyChart) window.scannerDailyChart.destroy();
  window.scannerDailyChart = new Chart(dailyCtx, {
    type: "bar",
    data: {
      labels: Object.keys(today),
      datasets: [{ label: "Scans Today", data: Object.values(today), backgroundColor: "#0077cc" }]
    }
  });

  // Weekly Chart
  const weekKeys = Object.keys(state.scanners).slice(-7);
  const weeklyTotals = weekKeys.map(k => Object.values(state.scanners[k]).reduce((a, b) => a + b, 0));
  const weeklyCtx = document.getElementById("scannerWeeklyChart").getContext("2d");
  if (window.scannerWeeklyChart) window.scannerWeeklyChart.destroy();
  window.scannerWeeklyChart = new Chart(weeklyCtx, {
    type: "bar",
    data: {
      labels: weekKeys,
      datasets: [{ label: "Weekly Scans", data: weeklyTotals, backgroundColor: "#00b894" }]
    }
  });
}

// -------------------- CARRIERS --------------------
document.getElementById("carrierForm").addEventListener("submit", e => {
  e.preventDefault();
  const carriers = {
    fedex: parseInt(document.getElementById("fedex").value || 0, 10),
    ups: parseInt(document.getElementById("ups").value || 0, 10),
    usps: parseInt(document.getElementById("usps").value || 0, 10),
    other: parseInt(document.getElementById("other").value || 0, 10),
  };

  state.carriers[todayKey()] = carriers;
  saveState();
  renderCarriers();
  e.target.reset();
});

function renderCarriers() {
  const today = state.carriers[todayKey()] || {};
  const totalReceived = Object.values(today).reduce((a, b) => a + b, 0);
  const totalScanned = Object.values(state.scanners[todayKey()] || {}).reduce((a, b) => a + b, 0);
  const ratio = totalReceived ? Math.round((totalScanned / totalReceived) * 100) : 0;

  // Update Home ratio
  document.getElementById("ratioStat").textContent = ratio + "%";
  document.getElementById("ratioProgress").style.width = Math.min(ratio, 100) + "%";

  // Donut
  const donutCtx = document.getElementById("carrierDonut").getContext("2d");
  if (window.carrierDonutChart) window.carrierDonutChart.destroy();
  window.carrierDonutChart = new Chart(donutCtx, {
    type: "doughnut",
    data: {
      labels: Object.keys(today),
      datasets: [{ data: Object.values(today), backgroundColor: ["#e17055", "#6c5ce7", "#0984e3", "#fab1a0"] }]
    }
  });

  // Daily Bar
  const barCtx = document.getElementById("carrierDailyChart").getContext("2d");
  if (window.carrierDailyChart) window.carrierDailyChart.destroy();
  window.carrierDailyChart = new Chart(barCtx, {
    type: "bar",
    data: {
      labels: Object.keys(today),
      datasets: [{ label: "Deliveries Today", data: Object.values(today), backgroundColor: "#6c5ce7" }]
    }
  });

  // Weekly Chart
  const weekKeys = Object.keys(state.carriers).slice(-7);
  const weeklyTotals = weekKeys.map(k => Object.values(state.carriers[k]).reduce((a, b) => a + b, 0));
  const weeklyCtx = document.getElementById("carrierWeeklyChart").getContext("2d");
  if (window.carrierWeeklyChart) window.carrierWeeklyChart.destroy();
  window.carrierWeeklyChart = new Chart(weeklyCtx, {
    type: "bar",
    data: {
      labels: weekKeys,
      datasets: [{ label: "Weekly Deliveries", data: weeklyTotals, backgroundColor: "#fd79a8" }]
    }
  });
}

// -------------------- GOALS --------------------
document.getElementById("saveScannerGoal").addEventListener("click", () => {
  const g = parseInt(document.getElementById("scannerGoalInput").value, 10);
  if (!isNaN(g)) {
    state.scannerGoal = g;
    saveState();
    renderScanners();
  }
});

// -------------------- INSPECTIONS --------------------
document.getElementById("inspectionForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("inspectionScanner").value.trim();
  const reason = document.getElementById("inspectionReason").value.trim();
  if (!state.inspections[todayKey()]) state.inspections[todayKey()] = [];
  state.inspections[todayKey()].push({ name, reason });
  saveState();
  renderInspections();
  e.target.reset();
});

function renderInspections() {
  const today = state.inspections[todayKey()] || [];
  const reasonCounts = {};
  today.forEach(i => reasonCounts[i.reason] = (reasonCounts[i.reason] || 0) + 1);

  // Donut
  const ctx = document.getElementById("inspectionDonut").getContext("2d");
  if (window.inspectionDonutChart) window.inspectionDonutChart.destroy();
  window.inspectionDonutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(reasonCounts),
      datasets: [{ data: Object.values(reasonCounts), backgroundColor: ["#d63031", "#fdcb6e", "#0984e3"] }]
    }
  });

  // Table
  const table = document.getElementById("inspectionTable");
  table.innerHTML = "<tr><th>Scanner</th><th>Reason</th></tr>";
  today.forEach(r => {
    table.innerHTML += `<tr><td>${r.name}</td><td>${r.reason}</td></tr>`;
  });
}

// -------------------- DATE --------------------
document.getElementById("reportDate").textContent = new Date().toLocaleDateString();

// -------------------- INITIAL RENDER --------------------
renderScanners();
renderCarriers();
renderInspections();
