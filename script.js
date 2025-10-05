// ==================== GLOBAL STATE ====================
let state = JSON.parse(localStorage.getItem("state")) || {
  scanners: {},
  carriers: {},
  racks: {},
  inspections: []
};

// Save state to localStorage
function saveState() {
  localStorage.setItem("state", JSON.stringify(state));
}

// ==================== NAVIGATION ====================
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".panel").forEach(p => p.style.display = "none");
    document.getElementById(btn.dataset.panel).style.display = "block";

    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// ==================== LIVE DATA (API) ====================
// Pull Detroit Axle API data through Netlify proxy
async function fetchReturnsData() {
  try {
    const response = await fetch("/.netlify/functions/returns");
    const data = await response.json();

    // Group by scanner
    const byScanner = {};
    const byClassification = {};

    data.forEach(item => {
      const scanner = item.createdBy || "Unknown";
      const classification = item.description || "Unclassified";

      if (!byScanner[scanner]) byScanner[scanner] = 0;
      if (!byClassification[classification]) byClassification[classification] = 0;

      byScanner[scanner]++;
      byClassification[classification]++;
    });

    renderScannerCharts(byScanner);
    renderClassificationCharts(byClassification);

    document.getElementById("scanner-last-updated").textContent =
      "Last updated: " + new Date().toLocaleTimeString();
    document.getElementById("class-last-updated").textContent =
      "Last updated: " + new Date().toLocaleTimeString();

  } catch (err) {
    console.error("Error fetching returns:", err);
  }
}

// Refresh scanners/classifications every 15s
setInterval(fetchReturnsData, 15000);
fetchReturnsData();

// ==================== CHART RENDERING ====================
function renderScannerCharts(data) {
  const ctx = document.getElementById("scannerDonut").getContext("2d");
  if (window.scannerChart) window.scannerChart.destroy();
  window.scannerChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(data),
      datasets: [{
        data: Object.values(data),
        backgroundColor: ["#0077cc", "#00aa55", "#ffaa00", "#cc0000"]
      }]
    }
  });
}

function renderClassificationCharts(data) {
  const ctx = document.getElementById("classDonut").getContext("2d");
  if (window.classChart) window.classChart.destroy();
  window.classChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(data),
      datasets: [{
        data: Object.values(data),
        backgroundColor: ["#0077cc", "#00aa55", "#ffaa00", "#cc0000", "#6666ff", "#ff66cc"]
      }]
    }
  });
}

// ==================== RACKS (MANUAL) ====================
document.getElementById("rackForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const today = new Date().toISOString().split("T")[0];
  state.racks[today] = {
    racks: +document.getElementById("racks").value,
    coreRacks: +document.getElementById("coreRacks").value,
    electric: +document.getElementById("electric").value,
    coreElectric: +document.getElementById("coreElectric").value,
    axlesGood: +document.getElementById("axlesGood").value,
    axlesUsed: +document.getElementById("axlesUsed").value,
    drivesGood: +document.getElementById("drivesGood").value,
    drivesUsed: +document.getElementById("drivesUsed").value,
    gearGood: +document.getElementById("gearGood").value,
    gearUsed: +document.getElementById("gearUsed").value
  };
  saveState();
  renderRacksCharts();
});

function renderRacksCharts() {
  const today = new Date().toISOString().split("T")[0];
  const data = state.racks[today] || {};
  // Example: just 1 donut here, add more like above if needed
  const ctx = document.getElementById("racksDonut").getContext("2d");
  if (window.racksChart) window.racksChart.destroy();
  window.racksChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Racks", "Core Racks"],
      datasets: [{
        data: [data.racks || 0, data.coreRacks || 0],
        backgroundColor: ["#0077cc", "#ffaa00"]
      }]
    }
  });
}

// ==================== MISS INSPECTIONS ====================
document.getElementById("missForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const tracking = document.getElementById("missTracking").value;
  const reason = document.getElementById("missReason").value;

  // Lookup details from API
  const res = await fetch("/.netlify/functions/returns");
  const data = await res.json();
  const found = data.find(r => r.trackingNumber == tracking);

  const scanner = found?.createdBy || "Unknown";
  const returnId = found?.id;

  // Build photo URLs through proxy
  const photos = [];
  if (returnId) {
    for (let i = 0; i < 5; i++) {
      photos.push(`/.netlify/functions/photos?id=${returnId}_${i}.jpg`);
    }
  }

  // Add to table
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${tracking}</td>
    <td>${scanner}</td>
    <td>${reason}</td>
    <td>${new Date().toLocaleTimeString()}</td>
    <td>${photos.map(p => `<img src="${p}" width="50">`).join("")}</td>
  `;
  document.getElementById("missTable").appendChild(row);

  state.inspections.push({ tracking, reason, scanner, time: Date.now(), photos });
  saveState();
});

