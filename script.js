/* ===========================
   Global State & Helpers
=========================== */
let state = {
  racks: JSON.parse(localStorage.getItem("racksData")) || {},
  carriers: JSON.parse(localStorage.getItem("carriersData")) || {},
  inspections: JSON.parse(localStorage.getItem("missInspections")) || [],
};

function getSelectedDate() {
  const input = document.getElementById("globalDate");
  if (!input) return new Date().toISOString().split("T")[0];
  return input.value || new Date().toISOString().split("T")[0];
}

function formatDateForHeader(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/* ===========================
   Navigation
=========================== */
function showPanel(id) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  document.querySelectorAll(".navbar button").forEach(b => b.classList.remove("active"));
  document.querySelector(`.navbar button[data-target='${id}']`).classList.add("active");
}

/* ===========================
   Data Fetch (via Netlify)
=========================== */
async function fetchReturns() {
  const date = getSelectedDate();
  try {
    const res = await fetch(`/.netlify/functions/returns?date=${date}`);
    if (!res.ok) throw new Error("Failed to fetch returns");
    return await res.json();
  } catch (err) {
    console.error("Error fetching returns:", err);
    return [];
  }
}

/* ===========================
   Scanners Panel
=========================== */
async function renderScanners() {
  const data = await fetchReturns();
  const scanners = {};
  data.forEach(r => {
    if (!scanners[r.scanner]) scanners[r.scanner] = 0;
    scanners[r.scanner]++;
  });

  const ctx = document.getElementById("scannersChart").getContext("2d");
  if (window.scannersChart) window.scannersChart.destroy();
  window.scannersChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(scanners),
      datasets: [{
        data: Object.values(scanners),
        backgroundColor: ["#007BFF", "#00d4ff", "#28a745", "#ffc107", "#dc3545"],
      }]
    },
    options: { responsive: true }
  });

  document.getElementById("scannersLastUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
}

/* ===========================
   Classifications Panel
=========================== */
async function renderClassifications() {
  const data = await fetchReturns();
  const counts = { Good: 0, Used: 0, Damage: 0, Missing: 0, Core: 0, "Not Our Part": 0 };

  data.forEach(r => {
    if (counts[r.classification] !== undefined) counts[r.classification]++;
  });

  const ctx = document.getElementById("classificationsChart").getContext("2d");
  if (window.classificationsChart) window.classificationsChart.destroy();
  window.classificationsChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#28a745", "#17a2b8", "#ffc107", "#dc3545", "#6c757d", "#007BFF"],
      }]
    },
    options: { responsive: true }
  });

  document.getElementById("classificationsLastUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
}

/* ===========================
   Racks Panel
=========================== */
function saveRacksLog(e) {
  e.preventDefault();
  const date = getSelectedDate();
  const entry = {
    racks: parseInt(document.getElementById("racksInput").value) || 0,
    coreRacks: parseInt(document.getElementById("coreRacksInput").value) || 0,
    electric: parseInt(document.getElementById("electricInput").value) || 0,
    coreElectric: parseInt(document.getElementById("coreElectricInput").value) || 0,
    axlesGood: parseInt(document.getElementById("axlesGoodInput").value) || 0,
    axlesUsed: parseInt(document.getElementById("axlesUsedInput").value) || 0,
    driveshaftGood: parseInt(document.getElementById("driveshaftGoodInput").value) || 0,
    driveshaftUsed: parseInt(document.getElementById("driveshaftUsedInput").value) || 0,
    gearboxGood: parseInt(document.getElementById("gearboxGoodInput").value) || 0,
    gearboxUsed: parseInt(document.getElementById("gearboxUsedInput").value) || 0,
  };
  state.racks[date] = entry;
  localStorage.setItem("racksData", JSON.stringify(state.racks));
  renderRacks();
}

function renderRacks() {
  const date = getSelectedDate();
  const data = state.racks[date] || {};
  const ctx = document.getElementById("racksChart").getContext("2d");
  if (window.racksChart) window.racksChart.destroy();
  window.racksChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Racks", "Core Racks", "Electric", "Core Electric", "Axles Good", "Axles Used", "Driveshaft Good", "Driveshaft Used", "Gearbox Good", "Gearbox Used"],
      datasets: [{
        data: [
          data.racks || 0,
          data.coreRacks || 0,
          data.electric || 0,
          data.coreElectric || 0,
          data.axlesGood || 0,
          data.axlesUsed || 0,
          data.driveshaftGood || 0,
          data.driveshaftUsed || 0,
          data.gearboxGood || 0,
          data.gearboxUsed || 0,
        ],
        backgroundColor: ["#007BFF","#0056b3","#17a2b8","#0dcaf0","#28a745","#20c997","#ffc107","#fd7e14","#6f42c1","#dc3545"],
      }]
    },
    options: { responsive: true }
  });

  document.getElementById("racksLastUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
}

/* ===========================
   Miss Inspections
=========================== */
async function saveMissInspection(e) {
  e.preventDefault();
  const tracking = document.getElementById("trackingInput").value.trim();
  const reason = document.getElementById("reasonInput").value.trim();
  if (!tracking || !reason) return alert("Tracking number and reason required.");

  const returns = await fetchReturns();
  const match = returns.find(r => r.tracking_number === tracking);
  const entry = {
    tracking,
    returnId: match ? match.id : null,
    scanner: match ? match.scanner : "Unknown",
    reason,
    date: getSelectedDate()
  };

  state.inspections.push(entry);
  localStorage.setItem("missInspections", JSON.stringify(state.inspections));
  renderMissInspections();
}

async function renderMissInspections() {
  const date = getSelectedDate();
  const tbody = document.getElementById("missInspectionsTableBody");
  tbody.innerHTML = "";

  state.inspections.filter(i => i.date === date).forEach((ins, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${ins.tracking}</td>
      <td>${ins.returnId || "-"}</td>
      <td>${ins.scanner}</td>
      <td>${ins.reason}</td>
      <td><button onclick="viewPhotos('${ins.tracking}','${ins.returnId}')">View</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function viewPhotos(tracking, returnId) {
  try {
    const res = await fetch(`/.netlify/functions/photos?id=${tracking}`);
    const data = await res.json();
    const photos = data.photos || [];
    const modalBody = document.getElementById("photosModalBody");
    modalBody.innerHTML = "";
    if (photos.length === 0 && returnId) {
      const res2 = await fetch(`/.netlify/functions/photos?id=${returnId}`);
      const data2 = await res2.json();
      data2.photos.forEach(url => {
        const img = document.createElement("img");
        img.src = url;
        modalBody.appendChild(img);
      });
    } else {
      photos.forEach(url => {
        const img = document.createElement("img");
        img.src = url;
        modalBody.appendChild(img);
      });
    }
    document.getElementById("photosModal").style.display = "flex";
  } catch (err) {
    console.error("Error loading photos:", err);
  }
}

/* ===========================
   Reports (Print)
=========================== */
function printReport() {
  const date = getSelectedDate();
  const pretty = formatDateForHeader(date);
  const header = document.getElementById("reportHeader");
  header.innerText = `Daily Report — ${pretty}`;
  window.print();
}

/* ===========================
   Initialization
=========================== */
function refreshAllPanels() {
  renderScanners();
  renderClassifications();
  renderRacks();
  renderMissInspections();
}

document.addEventListener("DOMContentLoaded", () => {
  // Default date = today
  document.getElementById("globalDate").value = getSelectedDate();

  // Navigation
  document.querySelectorAll(".navbar button").forEach(b => {
    b.addEventListener("click", () => showPanel(b.dataset.target));
  });

  // Forms
  document.getElementById("racksForm").addEventListener("submit", saveRacksLog);
  document.getElementById("missInspectionForm").addEventListener("submit", saveMissInspection);

  // Date change refresh
  document.getElementById("globalDate").addEventListener("change", refreshAllPanels);

  // Init
  refreshAllPanels();

  // Auto-refresh live data
  setInterval(() => {
    renderScanners();
    renderClassifications();
  }, 15000);
});
