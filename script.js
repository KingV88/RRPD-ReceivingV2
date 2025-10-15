/* =========================================================
   RRPD RECEIVING — EVERYTHING BUILD
   Works with index.html + style.css from this thread.
   Chart.js v4.x required (CDN in index.html).
   ========================================================= */

/* ---------- Config ---------- */
const API_URL = "/.netlify/functions/returns";     // Netlify Function (proxy to returns.detroitaxle.com)
const REFRESH_INTERVAL = 15 * 60 * 1000;           // 15 minutes

/* ---------- LocalStorage Keys (manual/aux) ---------- */
const LS = {
  cache: "rrpd_cache_v2",               // last API snapshot
  scannersAllTime: "rrpd_scanners_all", // optional manual bump per scanner
  miss: "rrpd_miss_v2",                 // {tracking, reason, by?, at}
  racks: "rrpd_racks_v2",               // per-day: {date, rGood, rCore, erGood, erCore, axGood, axUsed, dsGood, dsUsed, gbGood, gbUsed}
  carriers: "rrpd_carriers_v2",         // per-day: {date, fedex, ups, usps, other}
  admin: "rrpd_admin_user_v1"           // "admin" if logged in
};

/* ---------- Elements ---------- */
const panels = document.querySelectorAll(".panel");
const navButtons = document.querySelectorAll(".nav-btn");
const toast = document.getElementById("toast");
const loader = document.getElementById("loader");
const lastRefresh = document.getElementById("last_refresh");

/* ---------- State ---------- */
let apiRows = [];            // raw array from API
let daily = {};              // per-day aggregates
let weekly = {};             // 7-day aggregates
let monthSeries = [];        // monthly classification trend
let charts = {};             // Chart.js instances registry
let isAdmin = false;

/* =========================================================
   Utilities
   ========================================================= */
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

function showLoader(show = true) {
  loader.style.display = show ? "block" : "none";
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function fmtDate(d) {
  return new Date(d).toLocaleString();
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function uniq(arr) { return Array.from(new Set(arr)); }

function sum(arr) { return arr.reduce((a,b)=>a+b,0); }

function colorSet(n) {
  // Distinct blues/teals/oranges/purples (enough for most lists)
  const base = [
    "#00bfff","#ffa600","#ff6361","#bc5090","#58508d",
    "#22c55e","#f59e0b","#3b82f6","#38bdf8","#a78bfa",
    "#ef4444","#10b981","#eab308","#0284c7","#64748b"
  ];
  if (n <= base.length) return base.slice(0, n);
  // Repeat if more needed
  const out = [];
  while (out.length < n) out.push(...base);
  return out.slice(0, n);
}

function ensureChart(canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (charts[canvasId]) { charts[canvasId].destroy(); }
  // Sharp charts
  config.options = config.options || {};
  config.options.responsive = true;
  config.options.maintainAspectRatio = false;
  config.options.devicePixelRatio = 2;
  charts[canvasId] = new Chart(ctx, config);
  return charts[canvasId];
}

/* =========================================================
   Navigation
   ========================================================= */
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-target");
    navButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    panels.forEach((p) => p.classList.remove("active"));
    const panel = document.getElementById(target);
    if (panel) panel.classList.add("active");
  });
});

/* =========================================================
   API Fetch + Processing
   ========================================================= */
async function fetchReturns() {
  showLoader(true);
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Network/Function error");
    const data = await res.json();
    // Save snapshot cache
    localStorage.setItem(LS.cache, JSON.stringify({ at: Date.now(), data }));
    buildFromAPI(data);
    showToast("Data refreshed");
  } catch (err) {
    console.warn("API unavailable, using cache or manual only:", err);
    const cached = JSON.parse(localStorage.getItem(LS.cache) || "{}");
    if (cached.data) {
      buildFromAPI(cached.data);
      showToast("Offline: using last cached data");
    } else {
      // no API, no cache — keep manual sections working
      renderAllManualPanels();
      showToast("Offline: manual panels only");
    }
  } finally {
    showLoader(false);
    if (lastRefresh) lastRefresh.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
  }
}

function buildFromAPI(rows) {
  apiRows = Array.isArray(rows) ? rows : [];

  // Normalize minimal fields we use:
  // created_at, createdBy, description, track_number
  // NOTE: classification we derive from 'description' if provided by API.
  const norm = apiRows.map(r => ({
    createdAt: r.created_at,
    createdBy: (r.createdBy || r.name || "Unknown").trim(),
    classification: (r.description || "Unclassified").trim(),
    tracking: r.track_number || ""
  })).filter(x => x.createdAt);

  // Daily (today)
  const tKey = todayKey();
  const todayRows = norm.filter(r => r.createdAt.slice(0,10) === tKey);

  // Weekly (last 7 days => day buckets)
  const weekMap = {}; // date -> { scanner: {}, class: {} }
  for (let i=6;i>=0;i--){
    weekMap[todayKey(daysAgo(i))] = { scanner:{}, class:{} };
  }
  norm.forEach(r => {
    const dk = r.createdAt.slice(0,10);
    if (weekMap[dk]) {
      weekMap[dk].scanner[r.createdBy] = (weekMap[dk].scanner[r.createdBy]||0)+1;
      weekMap[dk].class[r.classification] = (weekMap[dk].class[r.classification]||0)+1;
    }
  });

  daily = {
    scanners: countBy(todayRows, "createdBy"),
    classes:  countBy(todayRows, "classification")
  };

  weekly = weekMap;

  // Monthly classification trend (last 30 days)
  const last30 = [];
  for (let i=29;i>=0;i--) last30.push(todayKey(daysAgo(i)));
  const classSeries = {}; // class -> array of counts aligned to last30
  last30.forEach((dkey, idx)=>{
    const dayRows = norm.filter(r=> r.createdAt.slice(0,10)===dkey);
    const cMap = countBy(dayRows, "classification");
    Object.keys(cMap).forEach(k=>{
      classSeries[k] = classSeries[k] || Array(last30.length).fill(0);
      classSeries[k][idx] = cMap[k];
    });
  });
  monthSeries = { days: last30, series: classSeries };

  // Render live-driven panels
  renderDashboard();
  renderScannersPanel(todayRows);
  renderClassificationsPanel();
}

function countBy(rows, field) {
  const m={};
  rows.forEach(r=> m[r[field]] = (m[r[field]]||0)+1);
  return m;
}

/* =========================================================
   DASHBOARD (Daily/Weekly: Scanners + Classifications)
   ========================================================= */
function renderDashboard() {
  // SCANNERS DAILY
  const sNames = Object.keys(daily.scanners || {});
  const sVals  = sNames.map(n => daily.scanners[n]);
  ensureChart("chart_scanners_daily", {
    type: "doughnut",
    data: {
      labels: sNames,
      datasets: [{
        data: sVals,
        backgroundColor: colorSet(sNames.length)
      }]
    },
    options: { plugins: { legend: { position: "bottom" } } }
  });

  // SCANNERS WEEKLY (stacked bars per day)
  const weekDays = Object.keys(weekly);
  const allScanners = uniq(weekDays.flatMap(d => Object.keys(weekly[d].scanner)));
  const datasetsS = allScanners.map((name, i) => ({
    label: name,
    data: weekDays.map(d => weekly[d].scanner[name] || 0),
    backgroundColor: colorSet(allScanners.length)[i]
  }));
  ensureChart("chart_scanners_weekly", {
    type: "bar",
    data: { labels: weekDays, datasets: datasetsS },
    options: {
      plugins: { legend: { position: "bottom" } },
      responsive: true,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
    }
  });

  // CLASS DAILY
  const cNames = Object.keys(daily.classes || {});
  const cVals  = cNames.map(n => daily.classes[n]);
  ensureChart("chart_class_daily", {
    type: "pie",
    data: {
      labels: cNames,
      datasets: [{
        data: cVals,
        backgroundColor: colorSet(cNames.length)
      }]
    },
    options: { plugins: { legend: { position: "bottom" } } }
  });

  // CLASS WEEKLY (stacked)
  const allClasses = uniq(weekDays.flatMap(d => Object.keys(weekly[d].class)));
  const datasetsC = allClasses.map((name, i) => ({
    label: name,
    data: weekDays.map(d => weekly[d].class[name] || 0),
    backgroundColor: colorSet(allClasses.length)[i]
  }));
  ensureChart("chart_class_weekly", {
    type: "bar",
    data: { labels: weekDays, datasets: datasetsC },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
    }
  });
}

/* =========================================================
   SCANNERS PANEL (Daily + All-time + Log)
   ========================================================= */
function renderScannersPanel(todayRows) {
  // Daily breakdown (from daily.scanners)
  const sNames = Object.keys(daily.scanners || {});
  const sVals  = sNames.map(n => daily.scanners[n]);

  ensureChart("scanner_daily_chart", {
    type: "doughnut",
    data: {
      labels: sNames,
      datasets: [{ data: sVals, backgroundColor: colorSet(sNames.length) }]
    },
    options: { plugins: { legend: { position: "bottom" } } }
  });

  // All-time display:
  // We’ll combine API counts for the last cache with optional manual all-time bumps
  const manualAll = JSON.parse(localStorage.getItem(LS.scannersAllTime) || "{}"); // {name: extraCount}
  const namesAll = uniq([...sNames, ...Object.keys(manualAll)]);
  const valsAll = namesAll.map(n => (daily.scanners[n]||0) + (manualAll[n]||0));

  ensureChart("scanner_alltime_chart", {
    type: "bar",
    data: {
      labels: namesAll,
      datasets: [{ label: "All-time (API + Manual Adj)", data: valsAll, backgroundColor: "#00bfff" }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // Log (today’s raw events)
  const logDiv = document.getElementById("scanner_log");
  if (logDiv) {
    const rows = todayRows || [];
    logDiv.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Time</th><th>Scanner</th><th>Classification</th><th>Tracking</th></tr></thead>
        <tbody>
          ${rows.slice(-200).reverse().map(r=>`
            <tr>
              <td>${fmtDate(r.createdAt)}</td>
              <td>${r.createdBy}</td>
              <td>${r.classification}</td>
              <td>${r.tracking}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    `;
  }
}

/* =========================================================
   CLASSIFICATIONS PANEL (Daily + Monthly Trend + Log)
   ========================================================= */
function renderClassificationsPanel() {
  // Daily donut (reuse dashboard daily.classes)
  const cNames = Object.keys(daily.classes || {});
  const cVals = cNames.map(n => daily.classes[n]);
  ensureChart("class_chart_daily", {
    type: "doughnut",
    data: { labels: cNames, datasets: [{ data: cVals, backgroundColor: colorSet(cNames.length) }] },
    options: { plugins: { legend: { position: "bottom" } } }
  });

  // Monthly stacked trend
  const days = monthSeries.days || [];
  const classes = Object.keys(monthSeries.series || {});
  const datasets = classes.map((c,i)=>({
    label: c,
    data: monthSeries.series[c],
    backgroundColor: colorSet(classes.length)[i]
  }));
  ensureChart("class_chart_monthly", {
    type: "bar",
    data: { labels: days, datasets },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: { x: { stacked: true, ticks:{ maxTicksLimit: 12 } }, y: { stacked: true, beginAtZero: true } }
    }
  });

  // Log (last 200 events overall)
  const logDiv = document.getElementById("class_log");
  if (logDiv) {
    const rows = (apiRows || []).slice(-200).reverse().map(r=>({
      t: r.created_at, who: (r.createdBy||r.name||"Unknown").trim(), cls: (r.description||"Unclassified"), trk: r.track_number||""
    }));
    logDiv.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Time</th><th>Scanner</th><th>Classification</th><th>Tracking</th></tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr>
              <td>${fmtDate(r.t)}</td>
              <td>${r.who}</td>
              <td>${r.cls}</td>
              <td>${r.trk}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    `;
  }
}

/* =========================================================
   MISS INSPECTIONS (manual)
   ========================================================= */
function renderMiss() {
  const arr = JSON.parse(localStorage.getItem(LS.miss) || "[]");
  const box = document.getElementById("miss_table");
  if (!box) return;
  box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Time</th><th>Tracking</th><th>Reason</th></tr></thead>
      <tbody>
        ${arr.slice().reverse().map(r=>`
          <tr><td>${fmtDate(r.at)}</td><td>${r.tracking}</td><td>${r.reason}</td></tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

document.getElementById("miss_add")?.addEventListener("click", () => {
  const tracking = document.getElementById("miss_tracking").value.trim();
  const reason = document.getElementById("miss_reason").value.trim();
  if (!tracking || !reason) return showToast("Enter tracking and reason");
  const arr = JSON.parse(localStorage.getItem(LS.miss) || "[]");
  arr.push({ tracking, reason, at: Date.now() });
  localStorage.setItem(LS.miss, JSON.stringify(arr));
  renderMiss();
  document.getElementById("miss_form").reset();
  showToast("Miss inspection saved");
});

/* =========================================================
   MANUAL INPUT: Racks / E-Racks / Axles / Driveshafts / Gearboxes
   ========================================================= */
function getRacksArr() {
  return JSON.parse(localStorage.getItem(LS.racks) || "[]");
}
function setRacksArr(arr) {
  localStorage.setItem(LS.racks, JSON.stringify(arr));
}

function mergeRacksEntry(dateKey, patch) {
  const arr = getRacksArr();
  const idx = arr.findIndex(r => r.date === dateKey);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...patch };
  else arr.push({ date: dateKey, rGood:0,rCore:0,erGood:0,erCore:0,axGood:0,axUsed:0,dsGood:0,dsUsed:0,gbGood:0,gbUsed:0, ...patch });
  setRacksArr(arr);
}

function renderManualTable() {
  const arr = getRacksArr().slice().reverse();
  const box = document.getElementById("manual_table");
  if (!box) return;
  box.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Date</th><th>Racks</th><th>E-Racks</th><th>Axles</th><th>Drive Shafts</th><th>Gearboxes</th>
        </tr>
      </thead>
      <tbody>
        ${arr.map(r=>`
          <tr>
            <td>${r.date}</td>
            <td>${r.rGood} good / ${r.rCore} core</td>
            <td>${r.erGood} good / ${r.erCore} core</td>
            <td>${r.axGood} good / ${r.axUsed} used</td>
            <td>${r.dsGood} good / ${r.dsUsed} used</td>
            <td>${r.gbGood} good / ${r.gbUsed} used</td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderRacksChartsForDate(dateKey) {
  const arr = getRacksArr();
  const row = arr.find(r => r.date === dateKey);
  if (!row) return;

  // Five donuts side-by-side (already in index via panel layout):
  ensureChart("donut_racks", {
    type: "doughnut",
    data: { labels: ["Good","Core"], datasets:[{ data:[Math.max(0,row.rGood), Math.max(0,row.rCore)], backgroundColor: ["#22c55e","#ef4444"] }]}
  });
  ensureChart("donut_eracks", {
    type: "doughnut",
    data: { labels: ["Good","Core"], datasets:[{ data:[Math.max(0,row.erGood), Math.max(0,row.erCore)], backgroundColor: ["#10b981","#f97316"] }]}
  });
  ensureChart("donut_axles", {
    type: "doughnut",
    data: { labels: ["Good","Used"], datasets:[{ data:[Math.max(0,row.axGood), Math.max(0,row.axUsed)], backgroundColor: ["#0ea5e9","#f59e0b"] }]}
  });
  ensureChart("donut_ds", {
    type: "doughnut",
    data: { labels: ["Good","Used"], datasets:[{ data:[Math.max(0,row.dsGood), Math.max(0,row.dsUsed)], backgroundColor: ["#6366f1","#eab308"] }]}
  });
  ensureChart("donut_gb", {
    type: "doughnut",
    data: { labels: ["Good","Used"], datasets:[{ data:[Math.max(0,row.gbGood), Math.max(0,row.gbUsed)], backgroundColor: ["#3b82f6","#f43f5e"] }]}
  });

  // Weekly stacked chart (sum last 7 days)
  const days = [];
  for (let i=6;i>=0;i--) days.push(todayKey(daysAgo(i)));
  const map = {}; // day -> {RackGood, RackCore, ERGood, ERCore, AxGood, AxUsed, DSGood, DSUsed, GBGood, GBUsed}
  days.forEach(d=> map[d] = {rG:0,rC:0,erG:0,erC:0,axG:0,axU:0,dsG:0,dsU:0,gbG:0,gbU:0});
  getRacksArr().forEach(r=>{
    if (map[r.date]) {
      map[r.date].rG+=+r.rGood||0; map[r.date].rC+=+r.rCore||0;
      map[r.date].erG+=+r.erGood||0; map[r.date].erC+=+r.erCore||0;
      map[r.date].axG+=+r.axGood||0; map[r.date].axU+=+r.axUsed||0;
      map[r.date].dsG+=+r.dsGood||0; map[r.date].dsU+=+r.dsUsed||0;
      map[r.date].gbG+=+r.gbGood||0; map[r.date].gbU+=+r.gbUsed||0;
    }
  });

  ensureChart("racks_weekly_chart", {
    type: "bar",
    data: {
      labels: days,
      datasets: [
        {label:"Racks Good", data: days.map(d=>map[d].rG), backgroundColor:"#16a34a"},
        {label:"Racks Core", data: days.map(d=>map[d].rC), backgroundColor:"#ef4444"},
        {label:"E-Racks Good", data: days.map(d=>map[d].erG), backgroundColor:"#10b981"},
        {label:"E-Racks Core", data: days.map(d=>map[d].erC), backgroundColor:"#f97316"},
        {label:"Axles Good", data: days.map(d=>map[d].axG), backgroundColor:"#0ea5e9"},
        {label:"Axles Used", data: days.map(d=>map[d].axU), backgroundColor:"#f59e0b"},
        {label:"DriveShaft Good", data: days.map(d=>map[d].dsG), backgroundColor:"#6366f1"},
        {label:"DriveShaft Used", data: days.map(d=>map[d].dsU), backgroundColor:"#eab308"},
        {label:"Gearboxes Good", data: days.map(d=>map[d].gbG), backgroundColor:"#3b82f6"},
        {label:"Gearboxes Used", data: days.map(d=>map[d].gbU), backgroundColor:"#f43f5e"}
      ]
    },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: { x: { stacked:true }, y: { stacked:true, beginAtZero:true } }
    }
  });
}

// Manual form handlers
document.getElementById("manual_submit")?.addEventListener("click", () => {
  if (!isAdmin) return showToast("Admin only");
  const cat = document.getElementById("manual_category").value;
  const good = parseInt(document.getElementById("manual_good").value || 0);
  const used = parseInt(document.getElementById("manual_used").value || 0);
  const dkey = todayKey();

  const patch = {};
  if (cat === "racks")       { patch.rGood = good; patch.rCore = used; }
  if (cat === "eracks")      { patch.erGood = good; patch.erCore = used; }
  if (cat === "axles")       { patch.axGood = good; patch.axUsed = used; }
  if (cat === "driveshafts") { patch.dsGood = good; patch.dsUsed = used; }
  if (cat === "gearboxes")   { patch.gbGood = good; patch.gbUsed = used; }

  mergeRacksEntry(dkey, patch);
  renderManualTable();
  renderRacksChartsForDate(dkey);
  document.getElementById("manual_form").reset();
  showToast("Saved for today");
});

document.getElementById("manual_reset")?.addEventListener("click", () => {
  if (!isAdmin) return showToast("Admin only");
  if (!confirm("Reset ALL manual logs?")) return;
  setRacksArr([]);
  renderManualTable();
  // Clear charts
  ["donut_racks","donut_eracks","donut_axles","donut_ds","donut_gb","racks_weekly_chart"].forEach(id=>{
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  });
  showToast("Manual logs cleared");
});

/* =========================================================
   CARRIERS (manual) — daily donut + weekly stacked
   ========================================================= */
function getCarriersArr() {
  return JSON.parse(localStorage.getItem(LS.carriers) || "[]");
}
function setCarriersArr(arr) {
  localStorage.setItem(LS.carriers, JSON.stringify(arr));
}

function upsertCarriers(dateKey, patch) {
  const arr = getCarriersArr();
  const idx = arr.findIndex(r=> r.date === dateKey);
  if (idx>=0) arr[idx] = { ...arr[idx], ...patch };
  else arr.push({ date: dateKey, fedex:0, ups:0, usps:0, other:0, ...patch });
  setCarriersArr(arr);
}

function renderCarriers(dateKey) {
  const arr = getCarriersArr();
  const row = arr.find(r=> r.date===dateKey) || {fedex:0,ups:0,usps:0,other:0};

  ensureChart("carriers_donut", {
    type: "doughnut",
    data: {
      labels: ["FedEx","UPS","USPS","Other"],
      datasets: [{ data: [row.fedex,row.ups,row.usps,row.other], backgroundColor: ["#0ea5e9","#f59e0b","#10b981","#94a3b8"] }]
    },
    options: { plugins: { legend: { position:"bottom" } } }
  });

  const days = [];
  for (let i=6;i>=0;i--) days.push(todayKey(daysAgo(i)));
  const map = {}; days.forEach(d=> map[d]={fedex:0,ups:0,usps:0,other:0});
  getCarriersArr().forEach(r=>{ if(map[r.date]){ map[r.date].fedex+=+r.fedex||0; map[r.date].ups+=+r.ups||0; map[r.date].usps+=+r.usps||0; map[r.date].other+=+r.other||0; }});
  ensureChart("carriers_weekly", {
    type: "bar",
    data: {
      labels: days,
      datasets: [
        {label:"FedEx", data: days.map(d=>map[d].fedex), backgroundColor:"#0ea5e9"},
        {label:"UPS",   data: days.map(d=>map[d].ups),   backgroundColor:"#f59e0b"},
        {label:"USPS",  data: days.map(d=>map[d].usps),  backgroundColor:"#10b981"},
        {label:"Other", data: days.map(d=>map[d].other), backgroundColor:"#94a3b8"}
      ]
    },
    options: {
      plugins: { legend: { position:"bottom" } },
      scales: { x: { stacked:true }, y: { stacked:true, beginAtZero:true } }
    }
  });
}

/* =========================================================
   Admin (simple)
   ========================================================= */
document.getElementById("admin_login")?.addEventListener("click", () => {
  const u = document.getElementById("admin_user").value.trim();
  const p = document.getElementById("admin_pass").value.trim();
  if (u === "admin" && p === "rrpd123") {
    isAdmin = true;
    localStorage.setItem(LS.admin, u);
    document.getElementById("admin_status").textContent = "Admin: Logged In";
    showToast("Admin logged in");
  } else {
    showToast("Invalid credentials");
  }
});

document.getElementById("admin_logout")?.addEventListener("click", () => {
  isAdmin = false;
  localStorage.removeItem(LS.admin);
  document.getElementById("admin_status").textContent = "Admin: Logged Out";
  showToast("Logged out");
});

/* =========================================================
   Manual “All-time” scanner adjust (optional mini-UI)
   ========================================================= */
// You can add a small UI later to bump all-time totals securely.
// For now, keep API-driven + this stored object:
function bumpScannerAllTime(name, delta) {
  if (!isAdmin) return showToast("Admin only");
  const obj = JSON.parse(localStorage.getItem(LS.scannersAllTime) || "{}");
  obj[name] = (obj[name] || 0) + (Number(delta)||0);
  localStorage.setItem(LS.scannersAllTime, JSON.stringify(obj));
  showToast(`Adjusted ${name} by ${delta}`);
}

/* =========================================================
   Buttons
   ========================================================= */
document.getElementById("manual_refresh")?.addEventListener("click", fetchReturns);

/* =========================================================
   Render-only (when API is offline) to avoid blank UI
   ========================================================= */
function renderAllManualPanels() {
  renderMiss();
  renderManualTable();
  renderRacksChartsForDate(todayKey());
  renderCarriers(todayKey());
}

/* =========================================================
   INIT
   ========================================================= */
window.addEventListener("load", () => {
  // Restore admin
  isAdmin = !!localStorage.getItem(LS.admin);

  // Always render manual panels (so they’re not blank)
  renderAllManualPanels();

  // Kick API fetch + schedule refresh
  fetchReturns();
  setInterval(fetchReturns, REFRESH_INTERVAL);

  showToast("RRPD Dashboard Ready");
});
