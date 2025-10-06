/* -----------------------------
   Global State & Helpers
------------------------------ */
let appState = {
  inspections: JSON.parse(localStorage.getItem("inspections")) || [],
  racks: JSON.parse(localStorage.getItem("racks")) || [],
  carriers: JSON.parse(localStorage.getItem("carriers")) || []
};

// Get selected date (fallback = today)
function getSelectedDate() {
  const picker = document.getElementById("globalDate");
  if (picker && picker.value) return picker.value;
  return new Date().toISOString().split("T")[0];
}

/* -----------------------------
   API Fetch via Netlify Function
------------------------------ */
async function fetchReturnsData() {
  const date = getSelectedDate();
  try {
    const res = await fetch(`/.netlify/functions/returns?date=${date}`);
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Fetch error:", err);
    return [];
  }
}

/* -----------------------------
   Refresh Panels
------------------------------ */
async function refreshAllPanels() {
  const data = await fetchReturnsData();
  renderScanners(data);
  renderClassifications(data);
  renderMissInspections(data);
  renderRacks();
  renderCarriers();
}

/* -----------------------------
   Render Functions
------------------------------ */
function renderScanners(data) {
  const ctx = document.getElementById("scannersChart").getContext("2d");
  const scanners = {};
  data.forEach(item => {
    const name = item.created_by || "Unknown";
    scanners[name] = (scanners[name] || 0) + 1;
  });

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(scanners),
      datasets: [{
        data: Object.values(scanners),
        backgroundColor: ["#007BFF", "#28A745", "#FFC107", "#DC3545"]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } }
    }
  });
}

function renderClassifications(data) {
  const ctx = document.getElementById("classificationsChart").getContext("2d");
  const classes = {};
  data.forEach(item => {
    const status = item.returnstatus_id || "Unknown";
    classes[status] = (classes[status] || 0) + 1;
  });

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(classes),
      datasets: [{
        label: "Count",
        data: Object.values(classes),
        backgroundColor: "#007BFF"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

function renderMissInspections(data) {
  const table = document.getElementById("missInspectionsTable");
  table.innerHTML = "";

  appState.inspections
    .filter(i => i.date === getSelectedDate())
    .forEach((insp, idx) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${insp.tracking}</td>
        <td>${insp.returnId || "-"}</td>
        <td>${insp.reason}</td>
        <td><button onclick="viewPhotos('${insp.tracking}', '${insp.returnId}')">View</button></td>
      `;
      table.appendChild(row);
    });
}

function renderRacks() {
  // Example donut
  const ctx = document.getElementById("racksChart").getContext("2d");
  const todays = appState.racks.filter(r => r.date === getSelectedDate());

  const racks = todays.reduce((acc, r) => {
    acc.total += r.count;
    return acc;
  }, { total: 0 });

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Racks"],
      datasets: [{
        data: [racks.total],
        backgroundColor: ["#28A745"]
      }]
    },
    options: { responsive: true }
  });
}

function renderCarriers() {
  const ctx = document.getElementById("carriersChart").getContext("2d");
  const todays = appState.carriers.filter(c => c.date === getSelectedDate());

  const carriers = todays.reduce((acc, c) => {
    acc[c.name] = (acc[c.name] || 0) + c.count;
    return acc;
  }, {});

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(carriers),
      datasets: [{
        label: "Shipments",
        data: Object.values(carriers),
        backgroundColor: "#17A2B8"
      }]
    },
    options: { responsive: true }
  });
}

/* -----------------------------
   Miss Inspections Photo Viewer
------------------------------ */
async function viewPhotos(tracking, returnId) {
  try {
    const res = await fetch(`/.netlify/functions/photos?id=${tracking}`);
    const urls = await res.json();

    const modal = document.getElementById("photoModal");
    const gallery = document.getElementById("photoGallery");
    gallery.innerHTML = "";

    if (urls.length === 0 && returnId) {
      // fallback by return ID
      const res2 = await fetch(`/.netlify/functions/photos?id=${returnId}`);
      const urls2 = await res2.json();
      urls2.forEach(u => {
        const img = document.createElement("img");
        img.src = u;
        gallery.appendChild(img);
      });
    } else {
      urls.forEach(u => {
        const img = document.createElement("img");
        img.src = u;
        gallery.appendChild(img);
      });
    }

    modal.style.display = "block";
  } catch (err) {
    console.error("Photo fetch failed", err);
  }
}

/* -----------------------------
   Form Handlers (Racks, Carriers, Inspections)
------------------------------ */
document.getElementById("racksForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const count = parseInt(document.getElementById("racksCount").value, 10);
  appState.racks.push({ date: getSelectedDate(), count });
  localStorage.setItem("racks", JSON.stringify(appState.racks));
  renderRacks();
});

document.getElementById("carriersForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("carrierName").value;
  const count = parseInt(document.getElementById("carrierCount").value, 10);
  appState.carriers.push({ date: getSelectedDate(), name, count });
  localStorage.setItem("carriers", JSON.stringify(appState.carriers));
  renderCarriers();
});

document.getElementById("inspectionForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const tracking = document.getElementById("inspTracking").value;
  const reason = document.getElementById("inspReason").value;
  const returnId = document.getElementById("inspReturnId").value || null;

  appState.inspections.push({
    date: getSelectedDate(),
    tracking,
    returnId,
    reason
  });
  localStorage.setItem("inspections", JSON.stringify(appState.inspections));
  renderMissInspections();
});

/* -----------------------------
   Init
------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  // Default date picker to today
  const picker = document.getElementById("globalDate");
  if (picker) picker.value = getSelectedDate();

  refreshAllPanels();

  // Re-render when date changes
  if (picker) {
    picker.addEventListener("change", () => {
      refreshAllPanels();
    });
  }

  // Auto-refresh live data every 15s
  setInterval(refreshAllPanels, 15000);
});
