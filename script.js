// Detroit Axle RRPD Dashboard - script.js
// Handles navigation, API fetch, global date filtering, charts, and logs

let appState = {
  selectedDate: new Date().toISOString().split("T")[0], // default = today
  returns: [],
  racks: JSON.parse(localStorage.getItem("racks")) || {},
  carriers: JSON.parse(localStorage.getItem("carriers")) || {},
  missInspections: JSON.parse(localStorage.getItem("missInspections")) || []
};

/* ---------------- GLOBAL DATE PICKER ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  const dateInput = document.getElementById("datePicker");
  if (dateInput) {
    dateInput.value = appState.selectedDate;
    dateInput.addEventListener("change", e => {
      appState.selectedDate = e.target.value;
      refreshAllPanels();
    });
  }

  setupNav();
  refreshAllPanels();
  setInterval(fetchReturnsData, 15000); // refresh every 15s
});

/* ---------------- NAVIGATION ---------------- */
function setupNav() {
  const buttons = document.querySelectorAll(".navbar button");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const panels = document.querySelectorAll(".panel");
      panels.forEach(p => p.classList.remove("active"));
      document.getElementById(btn.dataset.target).classList.add("active");
    });
  });
}

/* ---------------- FETCH RETURNS (API) ---------------- */
async function fetchReturnsData() {
  try {
    const res = await fetch("/.netlify/functions/returns");
    const data = await res.json();
    appState.returns = data;
    refreshAllPanels();
    updateTimestamp("scanners-updated");
    updateTimestamp("classifications-updated");
  } catch (err) {
    console.error("Error fetching returns:", err);
  }
}

/* ---------------- REFRESH ALL PANELS ---------------- */
function refreshAllPanels() {
  const filtered = appState.returns.filter(r => {
    if (!r.created_at) return false;
    return r.created_at.startsWith(appState.selectedDate);
  });

  renderScanners(filtered);
  renderClassifications(filtered);
  renderRacks();
  renderCarriers();
  renderMissInspections();
}

/* ---------------- SCANNERS PANEL ---------------- */
function renderScanners(data) {
  const counts = {};
  data.forEach(r => {
    const who = r.created_by || "Unknown";
    counts[who] = (counts[who] || 0) + 1;
  });

  const ctx = document.getElementById("scannerChart");
  if (!ctx) return;
  if (window.scannerChartObj) window.scannerChartObj.destroy();

  window.scannerChartObj = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#66b2ff","#4da6ff","#3399ff","#1a8cff","#0073e6"]
      }]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}

/* ---------------- CLASSIFICATIONS PANEL ---------------- */
function renderClassifications(data) {
  const counts = { Good:0, Used:0, Core:0, Damage:0, Missing:0, "Not Our Part":0 };

  data.forEach(r => {
    let c = (r.description || "").trim();
    if (counts[c] !== undefined) counts[c]++;
  });

  const ctx = document.getElementById("classificationChart");
  if (!ctx) return;
  if (window.classChartObj) window.classChartObj.destroy();

  window.classChartObj = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#2ecc71","#f1c40f","#9b59b6","#e74c3c","#e67e22","#95a5a6"]
      }]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}

/* ---------------- RACKS PANEL ---------------- */
function renderRacks() {
  const today = appState.selectedDate;
  const todayData = appState.racks[today] || { racks:0, coreRacks:0, electric:0, coreElectric:0, axlesGood:0, axlesUsed:0, driveshaftsGood:0, driveshaftsUsed:0, gearboxesGood:0, gearboxesUsed:0 };

  const ctx = document.getElementById("racksChart");
  if (!ctx) return;
  if (window.racksChartObj) window.racksChartObj.destroy();

  window.racksChartObj = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(todayData),
      datasets: [{
        data: Object.values(todayData),
        backgroundColor: "#0073e6"
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

/* ---------------- CARRIERS PANEL ---------------- */
function renderCarriers() {
  const today = appState.selectedDate;
  const todayData = appState.carriers[today] || { FedEx:0, UPS:0, USPS:0 };

  const ctx = document.getElementById("carrierChart");
  if (!ctx) return;
  if (window.carrierChartObj) window.carrierChartObj.destroy();

  window.carrierChartObj = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(todayData),
      datasets: [{
        data: Object.values(todayData),
        backgroundColor: ["#ff4d4d","#ffa64d","#66b2ff"]
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

/* ---------------- MISS INSPECTIONS ---------------- */
function renderMissInspections() {
  const tbody = document.querySelector("#missTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const today = appState.selectedDate;
  appState.missInspections.filter(m => m.date === today).forEach(m => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${m.track_number}</td>
      <td>${m.scanner}</td>
      <td>${m.reason}</td>
      <td>${m.date}</td>
      <td><button onclick="viewPhotos('${m.track_number}')">View Photos</button></td>
    `;
    tbody.appendChild(row);
  });
}

async function viewPhotos(trackNumber) {
  const modal = document.getElementById("photoModal");
  const body = document.getElementById("photoModalBody");
  modal.style.display = "block";
  body.innerHTML = "<p>Loading photos...</p>";

  try {
    // fetch via proxy, expects tracking-based images
    const res = await fetch(`/.netlify/functions/photos?id=${trackNumber}`);
    const data = await res.json();

    body.innerHTML = "";
    if (data && data.photos && data.photos.length) {
      data.photos.forEach(url => {
        const img = document.createElement("img");
        img.src = url;
        body.appendChild(img);
      });
    } else {
      body.innerHTML = "<p>No photos found for this tracking number.</p>";
    }
  } catch (err) {
    console.error(err);
    body.innerHTML = "<p>Error loading photos.</p>";
  }
}

/* ---------------- TIMESTAMP ---------------- */
function updateTimestamp(id) {
  const el = document.getElementById(id);
  if (el) {
    const now = new Date();
    el.innerText = "Last updated: " + now.toLocaleTimeString();
  }
}
