// -------------------------
// GLOBAL STATE
// -------------------------
const appState = {
  selectedDate: new Date().toISOString().slice(0, 10), // default today
  racks: JSON.parse(localStorage.getItem("racks")) || {},
  carriers: JSON.parse(localStorage.getItem("carriers")) || {},
  missInspections: JSON.parse(localStorage.getItem("missInspections")) || []
};

// -------------------------
// NAVIGATION
// -------------------------
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const panel = btn.getAttribute("data-panel");
    document.querySelectorAll(".panel").forEach(p => p.style.display = "none");
    document.getElementById(panel).style.display = "block";
  });
});

// -------------------------
// DATE PICKER
// -------------------------
document.getElementById("datePicker").value = appState.selectedDate;
document.getElementById("datePicker").addEventListener("change", (e) => {
  appState.selectedDate = e.target.value;
  refreshAll();
});

// -------------------------
// FETCH RETURNS API
// -------------------------
async function fetchReturnsData() {
  try {
    const res = await fetch("/.netlify/functions/returns");
    const data = await res.json();
    return data.filter(r => r.created_at.startsWith(appState.selectedDate));
  } catch (err) {
    console.error("API error:", err);
    return [];
  }
}

// -------------------------
// SCANNERS + CLASSIFICATIONS
// -------------------------
let scannerChart, classificationChart;

async function renderScanners() {
  const data = await fetchReturnsData();
  const counts = {};
  data.forEach(r => {
    const user = r.created_by || "Unknown";
    counts[user] = (counts[user] || 0) + 1;
  });

  const ctx = document.getElementById("scannerDonut").getContext("2d");
  if (scannerChart) scannerChart.destroy();
  scannerChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd"]
      }]
    }
  });

  document.getElementById("scannerUpdated").innerText =
    "Last updated: " + new Date().toLocaleTimeString();
}

async function renderClassifications() {
  const data = await fetchReturnsData();
  const cats = ["Good","Used","Core","Damage","Missing","Not Our Part"];
  const counts = Object.fromEntries(cats.map(c => [c, 0]));

  data.forEach(r => {
    if (cats.includes(r.description)) counts[r.description] += 1;
  });

  const ctx = document.getElementById("classDonut").getContext("2d");
  if (classificationChart) classificationChart.destroy();
  classificationChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: cats,
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#2ca02c","#ff7f0e","#1f77b4","#d62728","#8c564b","#9467bd"]
      }]
    }
  });

  document.getElementById("classUpdated").innerText =
    "Last updated: " + new Date().toLocaleTimeString();
}

// -------------------------
// RACKS (manual)
// -------------------------
document.getElementById("rackForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const today = appState.selectedDate;
  const racksData = {
    racks: +document.getElementById("racks").value || 0,
    coreRacks: +document.getElementById("coreRacks").value || 0,
    electric: +document.getElementById("electric").value || 0,
    coreElectric: +document.getElementById("coreElectric").value || 0,
    axlesGood: +document.getElementById("axlesGood").value || 0,
    axlesUsed: +document.getElementById("axlesUsed").value || 0,
    driveshaftsGood: +document.getElementById("driveshaftsGood").value || 0,
    driveshaftsUsed: +document.getElementById("driveshaftsUsed").value || 0,
    gearboxesGood: +document.getElementById("gearboxesGood").value || 0,
    gearboxesUsed: +document.getElementById("gearboxesUsed").value || 0
  };
  appState.racks[today] = racksData;
  localStorage.setItem("racks", JSON.stringify(appState.racks));
  renderRacks();
  e.target.reset();
});

function renderRacks() {
  const today = appState.selectedDate;
  const data = appState.racks[today];
  if (!data) return;

  const ctx = document.getElementById("racksDonut").getContext("2d");
  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Racks","Core Racks","Electric","Core Electric",
               "Axles Good","Axles Used","Driveshafts Good","Driveshafts Used",
               "Gearboxes Good","Gearboxes Used"],
      datasets: [{
        data: Object.values(data),
        backgroundColor: ["#1f77b4","#aec7e8","#ff7f0e","#ffbb78",
                          "#2ca02c","#98df8a","#d62728","#ff9896",
                          "#9467bd","#c5b0d5"]
      }]
    }
  });
  document.getElementById("racksUpdated").innerText =
    "Last updated: " + new Date().toLocaleTimeString();
}

// -------------------------
// MISS INSPECTIONS
// -------------------------
document.getElementById("missForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const trackingNumber = document.getElementById("missTracking").value.trim();
  const reason = document.getElementById("missReason").value.trim();
  const today = appState.selectedDate;

  if (!trackingNumber || !reason) return;

  let returnId = null;
  let scanner = "Unknown";

  try {
    const res = await fetch("/.netlify/functions/returns");
    const data = await res.json();
    const match = data.find(r => r.tracking_number === trackingNumber);
    if (match) {
      returnId = match.id;
      scanner = match.created_by || "Unknown";
    }
  } catch (err) {
    console.error("Lookup failed:", err);
  }

  const entry = { track_number: trackingNumber, return_id: returnId, scanner, reason, date: today };
  appState.missInspections.push(entry);
  localStorage.setItem("missInspections", JSON.stringify(appState.missInspections));

  renderMissInspections();
  e.target.reset();
});

function renderMissInspections() {
  const tbody = document.querySelector("#missTable tbody");
  tbody.innerHTML = "";

  appState.missInspections
    .filter(m => m.date === appState.selectedDate)
    .forEach((m) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.track_number || "—"}</td>
        <td>${m.return_id || "—"}</td>
        <td>${m.scanner || "Unknown"}</td>
        <td>${m.reason}</td>
        <td>${m.date}</td>
        <td><button onclick="viewPhotos('${m.track_number}','${m.return_id}')">View</button></td>
      `;
      tbody.appendChild(tr);
    });
}

async function viewPhotos(trackNumber, returnId) {
  const modal = document.getElementById("photoModal");
  const body = document.getElementById("photoModalBody");
  modal.style.display = "block";
  body.innerHTML = "<p>Loading photos...</p>";

  const candidates = [];
  if (trackNumber) candidates.push(trackNumber);
  if (returnId) candidates.push(returnId);

  try {
    let photos = [];
    for (const id of candidates) {
      const res = await fetch(`/.netlify/functions/photos?id=${id}`);
      const data = await res.json();
      if (data.photos && data.photos.length) {
        photos = photos.concat(data.photos);
      }
    }

    body.innerHTML = "";
    if (photos.length) {
      photos.forEach(url => {
        const img = document.createElement("img");
        img.src = url;
        body.appendChild(img);
      });
    } else {
      body.innerHTML = "<p>No photos found for this entry.</p>";
    }
  } catch (err) {
    console.error(err);
    body.innerHTML = "<p>Error loading photos.</p>";
  }
}

// -------------------------
// REFRESH LOOP
// -------------------------
function refreshAll() {
  renderScanners();
  renderClassifications();
  renderRacks();
  renderMissInspections();
}

refreshAll();
setInterval(renderScanners, 15000);
setInterval(renderClassifications, 15000);
setInterval(renderRacks, 30000);
