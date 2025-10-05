// ======================
// Global State
// ======================
let state = JSON.parse(localStorage.getItem("state")) || {
  racks: {},
  carriers: {},
  miss: [],
  settings: { scannerGoal: 400, lastReset: null }
};

// Save state
function saveState() {
  localStorage.setItem("state", JSON.stringify(state));
}

// Format date key
function dateKey(date = new Date()) {
  return date.toISOString().split("T")[0];
}

// ======================
// Navigation
// ======================
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.getElementById(btn.dataset.panel).classList.add("active");
    btn.classList.add("active");
  });
});

// ======================
// Date Selector
// ======================
const globalDateInput = document.getElementById("globalDate");
globalDateInput.value = dateKey();
globalDateInput.addEventListener("change", () => {
  renderAll();
});

// ======================
// Charts Helpers
// ======================
Chart.defaults.font.family = "Segoe UI, sans-serif";
Chart.defaults.plugins.legend.position = "bottom";
Chart.defaults.plugins.tooltip.callbacks = {
  label: ctx => `${ctx.label}: ${ctx.formattedValue}`
};

// Destroy old chart before re-render
function destroyChart(chartVar) {
  if (chartVar) chartVar.destroy();
}

// Chart vars
let scannerDonutChart, scannerBarChart;
let carrierDonutChart, carrierBarChart;
let rackDonuts = [];
let weeklyRacksChart;
let classDonutChart, classBarChart;
let weeklyClassChart, monthlyClassChart;

// ======================
// API Fetch (via Netlify proxy)
// ======================
async function fetchReturnsData() {
  try {
    const res = await fetch("/.netlify/functions/returns");
    return await res.json();
  } catch (err) {
    console.error("API fetch error", err);
    return [];
  }
}

// ======================
// Render Functions
// ======================

// --- Scanners ---
async function renderScanners() {
  const data = await fetchReturnsData();
  const selectedDate = globalDateInput.value;

  const filtered = data.filter(r => r.created_at.startsWith(selectedDate));
  const counts = {};
  filtered.forEach(r => counts[r.createdBy] = (counts[r.createdBy] || 0) + 1);

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  destroyChart(scannerDonutChart);
  scannerDonutChart = new Chart(document.getElementById("scannerDonut"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: ["#0077c7", "#00c779", "#f4b400", "#db4437"] }] }
  });

  destroyChart(scannerBarChart);
  scannerBarChart = new Chart(document.getElementById("scannerBar"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Scans", data: values, backgroundColor: "#0077c7" }] }
  });

  document.getElementById("scannerUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
  document.getElementById("homeScans").innerText = values.reduce((a, b) => a + b, 0);
}

// --- Carriers (manual for now) ---
function renderCarriers() {
  const selectedDate = globalDateInput.value;
  const carriers = state.carriers[selectedDate] || { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };

  const labels = Object.keys(carriers);
  const values = Object.values(carriers);

  destroyChart(carrierDonutChart);
  carrierDonutChart = new Chart(document.getElementById("carrierDonut"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: ["#ff5722", "#4caf50", "#2196f3", "#9c27b0"] }] }
  });

  destroyChart(carrierBarChart);
  carrierBarChart = new Chart(document.getElementById("carrierBar"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Packages", data: values, backgroundColor: "#0077c7" }] }
  });

  document.getElementById("carrierUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
  document.getElementById("homeCarriers").innerText = values.reduce((a, b) => a + b, 0);
}

// --- Racks ---
document.getElementById("rackForm").addEventListener("submit", e => {
  e.preventDefault();
  const selectedDate = globalDateInput.value;
  state.racks[selectedDate] = {
    racks: +document.getElementById("racksInput").value,
    coreRacks: +document.getElementById("coreRacksInput").value,
    electric: +document.getElementById("electricInput").value,
    coreElectric: +document.getElementById("coreElectricInput").value,
    axlesGood: +document.getElementById("axlesGoodInput").value,
    axlesUsed: +document.getElementById("axlesUsedInput").value,
    driveGood: +document.getElementById("driveGoodInput").value,
    driveUsed: +document.getElementById("driveUsedInput").value,
    gearGood: +document.getElementById("gearGoodInput").value,
    gearUsed: +document.getElementById("gearUsedInput").value,
  };
  saveState();
  renderRacks();
});

document.getElementById("resetRacks").addEventListener("click", () => {
  if (confirm("Reset racks logs?")) {
    state.racks = {};
    state.settings.lastReset = new Date().toLocaleString();
    saveState();
    renderRacks();
  }
});

function renderRacks() {
  const selectedDate = globalDateInput.value;
  const r = state.racks[selectedDate] || {};

  // Daily donuts
  const configs = [
    { id: "rackDonut1", data: [r.racks || 0, r.coreRacks || 0], labels: ["Racks", "Core Racks"] },
    { id: "rackDonut2", data: [r.electric || 0, r.coreElectric || 0], labels: ["Electric", "Core Electric"] },
    { id: "axleDonut", data: [r.axlesGood || 0, r.axlesUsed || 0], labels: ["Axles Good", "Axles Used"] },
    { id: "driveDonut", data: [r.driveGood || 0, r.driveUsed || 0], labels: ["Driveshafts Good", "Driveshafts Used"] },
    { id: "gearDonut", data: [r.gearGood || 0, r.gearUsed || 0], labels: ["Gearboxes Good", "Gearboxes Used"] },
  ];

  rackDonuts.forEach(c => c.destroy());
  rackDonuts = configs.map(cfg => new Chart(document.getElementById(cfg.id), {
    type: "doughnut",
    data: { labels: cfg.labels, datasets: [{ data: cfg.data, backgroundColor: ["#0077c7", "#00c779"] }] }
  }));

  document.getElementById("rackUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
  document.getElementById("lastResetNote").innerText = state.settings.lastReset ? "Last reset: " + state.settings.lastReset : "";
}

// --- Classifications ---
async function renderClassifications() {
  const data = await fetchReturnsData();
  const selectedDate = globalDateInput.value;

  const filtered = data.filter(r => r.created_at.startsWith(selectedDate));
  const classes = ["Good", "Used", "Core", "Damage", "Missing", "Not Our Part"];
  const counts = {};
  classes.forEach(c => counts[c] = 0);
  filtered.forEach(r => {
    if (counts[r.description] !== undefined) counts[r.description]++;
  });

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  destroyChart(classDonutChart);
  classDonutChart = new Chart(document.getElementById("classDonut"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: ["#0077c7","#00c779","#f4b400","#db4437","#9c27b0","#795548"] }] }
  });

  destroyChart(classBarChart);
  classBarChart = new Chart(document.getElementById("classBar"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Items", data: values, backgroundColor: "#0077c7" }] }
  });

  document.getElementById("classUpdated").innerText = "Last updated: " + new Date().toLocaleTimeString();
}

// --- Miss Inspections ---
document.getElementById("missForm").addEventListener("submit", async e => {
  e.preventDefault();
  const tracking = document.getElementById("missTracking").value.trim();
  const reason = document.getElementById("missReason").value.trim();
  const log = { tracking, reason, scanner: "AutoFetch", time: new Date().toLocaleString() };
  state.miss.push(log);
  saveState();
  renderMiss();
  e.target.reset();
});

function renderMiss() {
  const tbody = document.getElementById("missLog");
  tbody.innerHTML = "";
  state.miss.forEach(log => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${log.tracking}</td><td>${log.scanner}</td><td>${log.reason}</td><td>${log.time}</td><td><button onclick="viewPhotos('${log.tracking}')">View Photos</button></td>`;
    tbody.appendChild(row);
  });
}

// Photo modal (proxy fetch)
function viewPhotos(tracking) {
  const modal = document.getElementById("photoModal");
  const container = document.getElementById("photoContainer");
  container.innerHTML = `<p>Photos for ${tracking} (via proxy)</p>`;
  // Example placeholder
  container.innerHTML += `<img src="/.netlify/functions/photos?id=${tracking}.jpg">`;
  modal.style.display = "flex";
}

document.querySelector(".close").onclick = () => {
  document.getElementById("photoModal").style.display = "none";
};

// --- Quiz ---
const quizQuestions = [
  { q: "What should you do if a part is classified as Damage?", a: "Mark as Damage and attach photo", options: ["Ignore", "Mark as Damage and attach photo", "Classify as Good"] }
];

function renderQuiz() {
  const div = document.getElementById("quiz");
  div.innerHTML = "";
  quizQuestions.forEach((q, i) => {
    const opts = q.options.map(o => `<label><input type="radio" name="q${i}" value="${o}"> ${o}</label>`).join("<br>");
    div.innerHTML += `<p>${q.q}</p>${opts}<hr>`;
  });
}
renderQuiz();

document.getElementById("submitQuiz").addEventListener("click", () => {
  let score = 0;
  quizQuestions.forEach((q,i) => {
    const ans = document.querySelector(`input[name=q${i}]:checked`);
    if (ans && ans.value === q.a) score++;
  });
  document.getElementById("quizResult").innerText = `Score: ${score}/${quizQuestions.length}`;
});

// ======================
// Render All
// ======================
async function renderAll() {
  await renderScanners();
  renderCarriers();
  renderRacks();
  await renderClassifications();
  renderMiss();
}
renderAll();

// Auto-refresh (Scanners & Classifications every 15s, others 30s)
setInterval(renderScanners, 15000);
setInterval(renderClassifications, 15000);
setInterval(renderCarriers, 30000);
setInterval(renderRacks, 30000);
