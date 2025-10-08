// ============================
// GLOBAL STATE & CONSTANTS
// ============================
const RETURNS_API = "/.netlify/functions/returns";
const PHOTOS_API = "/.netlify/functions/photos";

let scannersDailyChart;
let classificationsChart;
let racksChart;
let carriersChart;

let state = {
  racks: JSON.parse(localStorage.getItem("racks")) || [],
  carriers: JSON.parse(localStorage.getItem("carriers")) || [],
  inspections: JSON.parse(localStorage.getItem("inspections")) || []
};

// ============================
// DATE HELPERS
// ============================
function getSelectedDate() {
  const dateInput = document.getElementById("globalDate");
  if (!dateInput || !dateInput.value) {
    return new Date().toISOString().split("T")[0];
  }
  return dateInput.value;
}

// ============================
// FETCH HELPERS
// ============================
async function fetchReturnsData() {
  const date = getSelectedDate();
  try {
    const response = await fetch(`${RETURNS_API}?date=${date}`);
    if (!response.ok) throw new Error("Failed to fetch returns");
    return await response.json();
  } catch (err) {
    console.error("Error fetching returns:", err);
    return [];
  }
}

async function fetchPhotos(id) {
  try {
    const response = await fetch(`${PHOTOS_API}?id=${id}`);
    if (!response.ok) throw new Error("Failed to fetch photos");
    const data = await response.json();
    return data.photos || [];
  } catch (err) {
    console.error("Error fetching photos:", err);
    return [];
  }
}

// ============================
// NAVIGATION
// ============================
function showPanel(panelId) {
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  document.getElementById(panelId).classList.remove("hidden");
}

// ============================
// RENDER FUNCTIONS (CHARTS)
// ============================
function renderScannersChart(data) {
  const ctx = document.getElementById("scannersDailyChart").getContext("2d");
  if (scannersDailyChart) scannersDailyChart.destroy();
  scannersDailyChart = new Chart(ctx, {
    type: "bar",
    data,
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderClassificationsChart(data) {
  const ctx = document.getElementById("classificationsChart").getContext("2d");
  if (classificationsChart) classificationsChart.destroy();
  classificationsChart = new Chart(ctx, {
    type: "doughnut",
    data,
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderRacksChart(data) {
  const ctx = document.getElementById("racksChart").getContext("2d");
  if (racksChart) racksChart.destroy();
  racksChart = new Chart(ctx, {
    type: "bar",
    data,
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderCarriersChart(data) {
  const ctx = document.getElementById("carriersChart").getContext("2d");
  if (carriersChart) carriersChart.destroy();
  carriersChart = new Chart(ctx, {
    type: "pie",
    data,
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// ============================
// PANEL UPDATES
// ============================
async function updateScannersPanel() {
  const returns = await fetchReturnsData();
  const data = processScannersData(returns);
  renderScannersChart(data);
}

async function updateClassificationsPanel() {
  const returns = await fetchReturnsData();
  const data = processClassificationsData(returns);
  renderClassificationsChart(data);
}

function updateRacksPanel() {
  const data = processRacksData(state.racks);
  renderRacksChart(data);
  localStorage.setItem("racks", JSON.stringify(state.racks));
}

function updateCarriersPanel() {
  const data = processCarriersData(state.carriers);
  renderCarriersChart(data);
  localStorage.setItem("carriers", JSON.stringify(state.carriers));
}

function updateMissInspectionsPanel() {
  const tbody = document.querySelector("#inspectionsTable tbody");
  tbody.innerHTML = "";
  state.inspections.forEach((ins, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${ins.tracking}</td>
      <td>${ins.returnId || "-"}</td>
      <td>${ins.reason}</td>
      <td><button onclick="viewPhotos('${ins.tracking}', '${ins.returnId}')">View</button></td>
    `;
    tbody.appendChild(tr);
  });
  localStorage.setItem("inspections", JSON.stringify(state.inspections));
}

// ============================
// PHOTO VIEWER
// ============================
async function viewPhotos(tracking, returnId) {
  let photos = await fetchPhotos(tracking);
  if (photos.length === 0 && returnId) {
    photos = await fetchPhotos(returnId);
  }
  const container = document.getElementById("photoContainer");
  container.innerHTML = photos.length
    ? photos.map(url => `<img src="${url}" alt="photo">`).join("")
    : "<p>No photos found</p>";
  document.getElementById("photoModal").classList.remove("hidden");
}

// ============================
// FORM HANDLERS
// ============================
document.getElementById("racksForm").addEventListener("submit", e => {
  e.preventDefault();
  const rack = e.target.rack.value.trim();
  if (rack) {
    state.racks.push({ rack, date: getSelectedDate() });
    updateRacksPanel();
    e.target.reset();
  }
});

document.getElementById("carriersForm").addEventListener("submit", e => {
  e.preventDefault();
  const carrier = e.target.carrier.value.trim();
  if (carrier) {
    state.carriers.push({ carrier, date: getSelectedDate() });
    updateCarriersPanel();
    e.target.reset();
  }
});

document.getElementById("missInspectionForm").addEventListener("submit", e => {
  e.preventDefault();
  const tracking = e.target.tracking.value.trim();
  const reason = e.target.reason.value.trim();
  if (tracking && reason) {
    state.inspections.push({
      tracking,
      reason,
      returnId: null,
      date: getSelectedDate()
    });
    updateMissInspectionsPanel();
    e.target.reset();
  }
});

// ============================
// INITIALIZE + AUTO REFRESH
// ============================
async function refreshAllPanels() {
  await updateScannersPanel();
  await updateClassificationsPanel();
  updateRacksPanel();
  updateCarriersPanel();
  updateMissInspectionsPanel();
  document.getElementById("lastUpdated").textContent =
    "Last updated: " + new Date().toLocaleTimeString();
}

document.addEventListener("DOMContentLoaded", () => {
  refreshAllPanels();
  setInterval(refreshAllPanels, 15000);
  document.getElementById("globalDate").addEventListener("change", refreshAllPanels);
});
