// State
let state = JSON.parse(localStorage.getItem("state")) || {
  scanners: {},
  carriers: {},
  racks: {},
  inspections: [],
  scannerGoal: 400,
  ratioGoal: 100
};

// Save helper
function saveState() {
  localStorage.setItem("state", JSON.stringify(state));
}

// Panel navigation
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.panel).classList.add("active");
  });
});

// Scanner form
document.getElementById("scannerForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("scannerName").value;
  const count = parseInt(document.getElementById("scannerCount").value);
  const today = new Date().toISOString().split("T")[0];
  if (!state.scanners[today]) state.scanners[today] = {};
  state.scanners[today][name] = (state.scanners[today][name] || 0) + count;
  saveState();
  render();
  e.target.reset();
});

// Carrier form
document.getElementById("carrierForm").addEventListener("submit", e => {
  e.preventDefault();
  const fedex = parseInt(document.getElementById("fedex").value) || 0;
  const ups = parseInt(document.getElementById("ups").value) || 0;
  const usps = parseInt(document.getElementById("usps").value) || 0;
  const other = parseInt(document.getElementById("other").value) || 0;
  const today = new Date().toISOString().split("T")[0];
  state.carriers[today] = { fedex, ups, usps, other };
  saveState();
  render();
  e.target.reset();
});

// Save scanner goal
document.getElementById("saveScannerGoal").addEventListener("click", () => {
  const goal = parseInt(document.getElementById("scannerGoalInput").value);
  if (goal > 0) {
    state.scannerGoal = goal;
    saveState();
    render();
  }
});

// Render functions
function render() {
  const today = new Date().toISOString().split("T")[0];
  const scans = state.scanners[today] || {};
  const totalScans = Object.values(scans).reduce((a,b)=>a+b,0);
  const carriers = state.carriers[today] || {};
  const totalReceived = Object.values(carriers).reduce((a,b)=>a+b,0);

  // Home stats
  document.getElementById("scansToday").textContent = totalScans;
  let percentGoal = Math.min(100, (totalScans/state.scannerGoal)*100);
  document.getElementById("scannerGoalProgress").style.width = percentGoal+"%";
  document.getElementById("scannerPanelGoalProgress").style.width = percentGoal+"%";

  const ratio = totalReceived ? Math.round((totalScans/totalReceived)*100) : 0;
  document.getElementById("ratioStat").textContent = ratio+"%";
  document.getElementById("ratioProgress").style.width = ratio+"%";

  // Charts (basic demo versions)
  if (window.scannerDonutChart) window.scannerDonutChart.destroy();
  const ctx1 = document.getElementById("scannerDonut").getContext("2d");
  window.scannerDonutChart = new Chart(ctx1, {
    type: "doughnut",
    data: {
      labels: Object.keys(scans),
      datasets: [{ data: Object.values(scans), backgroundColor:["#0077cc","#00cc77","#ffaa00"] }]
    }
  });

  if (window.carrierDonutChart) window.carrierDonutChart.destroy();
  const ctx2 = document.getElementById("carrierDonut").getContext("2d");
  window.carrierDonutChart = new Chart(ctx2, {
    type: "doughnut",
    data: {
      labels: Object.keys(carriers),
      datasets: [{ data: Object.values(carriers), backgroundColor:["#0077cc","#00cc77","#ffaa00","#cc0044"] }]
    }
  });
}

// Initial render
render();
