// ==========================
// Global State & Setup
// ==========================
let state = {
  returns: [],
  racks: JSON.parse(localStorage.getItem("racksData")) || {},
  carriers: JSON.parse(localStorage.getItem("carriersData")) || {},
  inspections: JSON.parse(localStorage.getItem("inspectionsData")) || []
};

let charts = {}; // keep track of all Chart.js instances

// ==========================
// Fetch Helpers (Netlify)
// ==========================
async function fetchReturnsData(date) {
  try {
    const url = date
      ? `/.netlify/functions/returns?date=${date}`
      : '/.netlify/functions/returns';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Returns fetch failed: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Error fetching returns:", err);
    return [];
  }
}

async function fetchPhotos(id) {
  try {
    const url = `/.netlify/functions/photos?id=${id}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Photos fetch failed: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Error fetching photos:", err);
    return [];
  }
}

// ==========================
// Date Helpers
// ==========================
function getSelectedDate() {
  const input = document.getElementById("globalDate");
  return input && input.value ? input.value : new Date().toISOString().slice(0,10);
}

function formatDateHeader(dateStr) {
  const opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  return new Date(dateStr).toLocaleDateString(undefined, opts);
}

// ==========================
// Rendering Panels
// ==========================
async function renderScanners() {
  const date = getSelectedDate();
  const data = await fetchReturnsData(date);
  state.returns = data;

  const counts = {};
  data.forEach(r => {
    const who = r.createdBy || "Unknown";
    counts[who] = (counts[who] || 0) + 1;
  });

  const ctx = document.getElementById("scannerChart").getContext("2d");
  if (charts.scanner) charts.scanner.destroy();
  charts.scanner = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{ data: Object.values(counts), backgroundColor: ["#2d89ef","#00aba9","#ffb900","#e81123","#7fba00","#ff8c00"] }]
    },
    options: { responsive: true }
  });

  document.getElementById("scannerUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
}

async function renderClassifications() {
  const date = getSelectedDate();
  const data = await fetchReturnsData(date);

  const cats = ["Good","Used","Core","Damage","Missing","Not Our Part"];
  const counts = cats.map(c => data.filter(r => r.description === c).length);

  const ctx = document.getElementById("classChart").getContext("2d");
  if (charts.class) charts.class.destroy();
  charts.class = new Chart(ctx, {
    type: "doughnut",
    data: { labels: cats, datasets: [{ data: counts, backgroundColor: ["#4caf50","#ffc107","#9c27b0","#f44336","#607d8b","#795548"] }] },
    options: { responsive: true }
  });

  document.getElementById("classUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
}

// ==========================
// Miss Inspections
// ==========================
async function renderMissInspections() {
  const tbody = document.getElementById("missTableBody");
  tbody.innerHTML = "";

  state.inspections.forEach((entry, idx) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${entry.tracking}</td>
      <td>${entry.returnId || "-"}</td>
      <td>${entry.scanner || "-"}</td>
      <td>${entry.reason}</td>
      <td>${entry.date}</td>
      <td><button onclick="viewPhotos('${entry.tracking}','${entry.returnId||""}')">View</button></td>
    `;
    tbody.appendChild(row);
  });
}

document.getElementById("missInspectionForm").addEventListener("submit", async e => {
  e.preventDefault();
  const tracking = document.getElementById("missTracking").value.trim();
  const reason = document.getElementById("missReason").value.trim();
  const date = getSelectedDate();

  const records = await fetchReturnsData(date);
  const rec = records.find(r => r.tracking_number === tracking);

  const entry = {
    tracking,
    returnId: rec ? rec.id : null,
    scanner: rec ? rec.createdBy : null,
    reason,
    date
  };

  state.inspections.push(entry);
  localStorage.setItem("inspectionsData", JSON.stringify(state.inspections));
  renderMissInspections();
  e.target.reset();
});

async function viewPhotos(tracking, returnId) {
  const photos = [];
  if (tracking) {
    const res = await fetchPhotos(tracking);
    photos.push(...res);
  }
  if ((!photos.length) && returnId) {
    const res = await fetchPhotos(returnId);
    photos.push(...res);
  }

  const gallery = document.getElementById("photoGallery");
  gallery.innerHTML = photos.length
    ? photos.map(url => `<img src="${url}" style="max-width:200px;margin:5px;">`).join("")
    : "<p>No photos found.</p>";

  document.getElementById("photoModal").style.display = "block";
}
document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("photoModal").style.display = "none";
});

// ==========================
// Reports
// ==========================
function printReport() {
  const date = getSelectedDate();
  document.getElementById("reportHeader").innerText = "Daily Report – " + formatDateHeader(date);
  window.print();
}

// ==========================
// Init
// ==========================
function init() {
  renderScanners();
  renderClassifications();
  renderMissInspections();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("globalDate").addEventListener("change", init);
  init();
  setInterval(init, 15000); // refresh every 15s
});
