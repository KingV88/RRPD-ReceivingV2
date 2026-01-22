/* =========================
   RRPD Receiving Dashboard
   FINAL COMPLETE BUILD
   ========================= */

let WH = {
  rows: [],
  meta: { loadedAt: null, fileName: null },
  columns: {},
  computed: null
};

let MANIFEST = {
  rows: [],
  fileName: null,
  trackingSet: new Set()
};

const LS_KEYS = {
  manualCounts: "rrpd_manual_counts_v2",
  logs: "rrpd_logs_v2"
};

const TRACKING_CLASSIFICATIONS = new Set([
  "return label",
  "packing slip"
]);

/* ---------- Utilities ---------- */

function nowStamp() {
  const d = new Date();
  return d.toLocaleString();
}

function norm(s) {
  return String(s ?? "").trim();
}

function normLower(s) {
  return norm(s).toLowerCase();
}

function isEmpty(v) {
  return norm(v) === "" || normLower(v) === "null" || normLower(v) === "undefined";
}

function safeInt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x) : 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Excel/CSV sometimes turns long numbers into 1.96367E+11
function normalizePossibleScientific(val) {
  const s = norm(val);
  if (!s) return "";
  // If it looks like scientific notation, convert to full integer string
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) {
    const num = Number(s);
    if (Number.isFinite(num)) {
      // convert to integer string without decimals
      return Math.trunc(num).toString();
    }
  }
  return s;
}

/* ---------- Column Detection ---------- */

function detectColumns(headerRow) {
  // We try common names. If missing, we fall back to best guesses.
  const headers = headerRow.map(h => normLower(h));

  const find = (cands) => {
    for (const c of cands) {
      const idx = headers.indexOf(c);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  // Tracking identifiers often exist in multiple columns; we will try several.
  const idxTracking = find([
    "tracking", "tracking number", "tracking#", "tracking id", "label tracking",
    "return tracking", "shipment tracking", "carrier tracking"
  ]);

  // Sometimes the first column contains the box tracking; if tracking header isn't found, we’ll guess column 0.
  const idxMaybeFirst = 0;

  const idxClassification = find(["classification", "type", "scan type", "document type", "label type"]);
  const idxPart = find(["part number", "part", "pn", "sku"]);
  const idxDescription = find(["description", "item description", "notes", "comment"]);
  const idxCondition = find(["condition", "return condition", "status"]);
  const idxCarrier = find(["carrier", "shipper"]);
  const idxDate = find(["date", "scan date", "created", "timestamp"]);
  const idxUser = find(["user", "operator", "employee"]);

  return {
    idxTracking,
    idxMaybeFirst,
    idxClassification,
    idxPart,
    idxDescription,
    idxCondition,
    idxCarrier,
    idxDate,
    idxUser,
    headers
  };
}

function getCell(row, idx) {
  if (idx == null || idx < 0) return "";
  return row[idx];
}

/* ---------- Carrier Classification ---------- */

function classifyCarrier(trackingStr) {
  const t = normalizePossibleScientific(trackingStr).replace(/\s+/g, "");
  if (!t) return "Other";

  // UPS: starts with 1Z
  if (/^1Z/i.test(t)) return "UPS";

  // USPS: often 92/93/94/95... (20-22+ digits), or 420 prefix
  if (/^420\d+/.test(t)) return "USPS";
  if (/^(92|93|94|95)\d{18,}/.test(t)) return "USPS";

  // FedEx:
  // - SmartPost / some FedEx labels start with 96...
  // - "shortened version" you mentioned: 797...
  if (/^96\d{13,}/.test(t)) return "FedEx";
  if (/^797\d{9,}/.test(t)) return "FedEx";

  // FedEx Ground can be 12/15/20/22 digits too, but we keep conservative:
  // If it is numeric and length between 12-22, and not matching USPS rules, call it FedEx (best guess).
  if (/^\d+$/.test(t) && t.length >= 12 && t.length <= 22) return "FedEx";

  return "Other";
}

/* ---------- Multipliers / Parts Pieces ---------- */

function extractMultiplier(s) {
  const str = norm(s);
  if (!str) return 1;

  // x10 or 10x, and also "... x 10"
  // We cap at 50.
  let m = 1;

  const m1 = str.match(/x\s*(\d{1,3})\b/i);
  const m2 = str.match(/\b(\d{1,3})\s*x\b/i);

  if (m1) m = Number(m1[1]);
  else if (m2) m = Number(m2[1]);

  if (!Number.isFinite(m) || m <= 0) m = 1;
  return clamp(Math.trunc(m), 1, 50);
}

function isTrackingClassification(classificationVal) {
  const c = normLower(classificationVal);
  return TRACKING_CLASSIFICATIONS.has(c);
}

/* Auto loose-part grouping (very simple heuristic) */
function loosePartGroup(partStr) {
  const p = norm(partStr).toUpperCase();
  if (!p) return "Unknown";

  // Detroit Axle-style prefixes seen in your images: X####, E####, K####, ES####, EV#### etc.
  const m = p.match(/^(ES|EV|K|X)\d+/);
  if (m) return m[0].slice(0, 2) === "ES" || m[0].slice(0, 2) === "EV" ? m[0].slice(0, 2) : m[0][0];

  // Numeric PN
  if (/^\d{6,}/.test(p)) return "Numeric PN";

  return "Other PN";
}

/* ---------- Core Compute ---------- */

function computeAll() {
  const rows = WH.rows;
  const col = WH.columns;

  const totalScans = rows.length;

  // We treat tracking-id for grouping as:
  // 1) tracking column if exists
  // 2) else column 0 (common in your sample)
  function getBoxTracking(row) {
    const primary = normalizePossibleScientific(getCell(row, col.idxTracking));
    const fallback = normalizePossibleScientific(getCell(row, col.idxMaybeFirst));
    return norm(primary) || norm(fallback);
  }

  // For “part number”, it can be in Part column, or sometimes in Tracking column for part rows.
  function getPartNumber(row) {
    const a = norm(getCell(row, col.idxPart));
    const b = normalizePossibleScientific(getCell(row, col.idxTracking));
    // If tracking looks like UPS/USPS/FedEx, don't treat as PN.
    const bt = getBoxTracking(row);
    if (a) return a;
    if (b && b !== bt) return b;
    return "";
  }

  const carrierCounts = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
  const trackingSamples = [];
  const trackingRows = []; // {tracking, carrier}
  const trackingIdCounts = new Map(); // tracking -> count occurrences among tracking rows
  const uniqueTrackingByCarrier = { FedEx: new Set(), UPS: new Set(), USPS: new Set(), Other: new Set() };

  // Parts
  let totalPartsPieces = 0;
  const partsByCondition = new Map(); // condition -> pieces
  const looseGroups = new Map(); // group -> pieces
  const partsByBox = new Map(); // tracking -> pieces (sum)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const classification = getCell(row, col.idxClassification);
    const condition = getCell(row, col.idxCondition);
    const boxTracking = getBoxTracking(row);

    // A: Tracking rows (Return Label / Packing Slip)
    if (isTrackingClassification(classification)) {
      const trackingId = boxTracking;
      if (!trackingId) continue;

      const carrier = classifyCarrier(trackingId);
      carrierCounts[carrier]++;

      trackingRows.push({ tracking: trackingId, carrier });
      trackingIdCounts.set(trackingId, (trackingIdCounts.get(trackingId) ?? 0) + 1);
      uniqueTrackingByCarrier[carrier].add(trackingId);

      // samples
      if (trackingSamples.length < 25) {
        trackingSamples.push(`${carrier} • ${trackingId}`);
      }
      continue;
    }

    // B: Parts rows (everything else)
    // Count pieces using multiplier cap 50
    const pn = getPartNumber(row) || getCell(row, col.idxDescription) || "";
    const mult = extractMultiplier(pn);
    totalPartsPieces += mult;

    // parts by condition
    const condKey = norm(condition) || "Unclassified";
    partsByCondition.set(condKey, (partsByCondition.get(condKey) ?? 0) + mult);

    // loose groups
    const grp = loosePartGroup(getPartNumber(row) || "");
    looseGroups.set(grp, (looseGroups.get(grp) ?? 0) + mult);

    // parts per box (tracking id is still the box tracking from col 0 or tracking column)
    if (boxTracking) {
      partsByBox.set(boxTracking, (partsByBox.get(boxTracking) ?? 0) + mult);
    }
  }

  // Unique tracking across all tracking rows
  const uniqueTracking = new Set(trackingRows.map(r => r.tracking));

  // Repeated tracking numbers: count how many IDs appear >1 (tracking rows only)
  let repeatedTrackingIds = 0;
  const repeatedList = [];
  for (const [trk, c] of trackingIdCounts.entries()) {
    if (c > 1) repeatedTrackingIds++;
    if (c > 1) repeatedList.push({ tracking: trk, scans: c, carrier: classifyCarrier(trk) });
  }
  repeatedList.sort((a, b) => b.scans - a.scans);

  // Boxes with multiple parts: part pieces per box > 1
  let boxesWithMultipleParts = 0;
  for (const [, pieces] of partsByBox.entries()) {
    if (pieces > 1) boxesWithMultipleParts++;
  }

  // Ratios (example)
  const ratios = [
    { metric: "Parts : Unique Tracking", value: uniqueTracking.size ? (totalPartsPieces / uniqueTracking.size).toFixed(2) : "0.00" },
    { metric: "Tracking Rows : Total Scans", value: totalScans ? ((trackingRows.length / totalScans) * 100).toFixed(1) + "%" : "0.0%" }
  ];

  WH.computed = {
    totalScans,
    carrierCounts,
    uniqueTrackingCount: uniqueTracking.size,
    uniqueTrackingByCarrier,
    trackingSamples,
    repeatedTrackingIds,
    repeatedTop: repeatedList.slice(0, 50),
    totalPartsPieces,
    boxesWithMultipleParts,
    partsByCondition,
    looseGroups,
    ratios
  };

  renderAll();
}

/* ---------- Rendering ---------- */

let chartCarrierBar = null;
let chartCarrierPie = null;
let chartCondDonut = null;

function renderAll() {
  const c = WH.computed;
  if (!c) return;

  // Metrics
  setText("mFedex", c.carrierCounts.FedEx);
  setText("mUps", c.carrierCounts.UPS);
  setText("mUsps", c.carrierCounts.USPS);
  setText("mOther", c.carrierCounts.Other);

  setText("mTotalScans", c.totalScans);
  setText("mUniqueTracking", c.uniqueTrackingCount);
  setText("mTotalParts", c.totalPartsPieces);
  setText("mMultiPartsBoxes", c.boxesWithMultipleParts);
  setText("mRepeatedTracking", c.repeatedTrackingIds);

  // Samples
  const samples = document.getElementById("trackingSamples");
  samples.innerHTML = "";
  c.trackingSamples.forEach(s => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = s;
    samples.appendChild(div);
  });

  // Repeat table
  const rptBody = document.querySelector("#repeatTable tbody");
  rptBody.innerHTML = "";
  c.repeatedTop.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family: ui-monospace, Menlo, Consolas, monospace;">${escapeHtml(r.tracking)}</td>
      <td class="num">${r.scans}</td>
      <td>${r.carrier}</td>
    `;
    rptBody.appendChild(tr);
  });

  // Carrier table + pie
  const carrierTableBody = document.querySelector("#carrierTable tbody");
  carrierTableBody.innerHTML = "";
  const carriers = ["FedEx", "UPS", "USPS", "Other"];
  carriers.forEach(name => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${name}</td>
      <td class="num">${c.carrierCounts[name]}</td>
      <td class="num">${c.uniqueTrackingByCarrier[name].size}</td>
    `;
    carrierTableBody.appendChild(tr);
  });

  // Condition totals
  const condBody = document.querySelector("#condTable tbody");
  condBody.innerHTML = "";
  const condArr = Array.from(c.partsByCondition.entries())
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v);
  condArr.forEach(x => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(x.k)}</td><td class="num">${x.v}</td>`;
    condBody.appendChild(tr);
  });

  // Loose Parts auto table
  const lpBody = document.querySelector("#loosePartsAutoTable tbody");
  lpBody.innerHTML = "";
  const lpArr = Array.from(c.looseGroups.entries())
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v);
  lpArr.forEach(x => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(x.k)}</td><td class="num">${x.v}</td>`;
    lpBody.appendChild(tr);
  });

  // Ratios
  const ratioBody = document.querySelector("#ratioTable tbody");
  ratioBody.innerHTML = "";
  c.ratios.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(r.metric)}</td><td class="num">${escapeHtml(r.value)}</td>`;
    ratioBody.appendChild(tr);
  });

  renderCharts();
  renderManifest();
  renderLogsTable();

  // Buttons
  document.getElementById("saveLogBtn").disabled = WH.rows.length === 0;
  document.getElementById("exportBtn").disabled = WH.rows.length === 0;
}

function renderCharts() {
  const c = WH.computed;
  if (!c) return;

  const carriers = ["FedEx", "UPS", "USPS", "Other"];
  const carrierValues = carriers.map(k => c.carrierCounts[k]);

  // Bar
  const barCtx = document.getElementById("carrierBar");
  if (chartCarrierBar) chartCarrierBar.destroy();
  chartCarrierBar = new Chart(barCtx, {
    type: "bar",
    data: {
      labels: carriers,
      datasets: [{ label: "Tracking Count", data: carrierValues }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });

  // Pie
  const pieCtx = document.getElementById("carrierPie");
  if (chartCarrierPie) chartCarrierPie.destroy();
  chartCarrierPie = new Chart(pieCtx, {
    type: "pie",
    data: {
      labels: carriers,
      datasets: [{ data: carrierValues }]
    },
    options: { responsive: true }
  });

  // Condition donut
  const condLabels = Array.from(c.partsByCondition.keys());
  const condValues = condLabels.map(k => c.partsByCondition.get(k));
  const donutCtx = document.getElementById("condDonut");
  if (chartCondDonut) chartCondDonut.destroy();
  chartCondDonut = new Chart(donutCtx, {
    type: "doughnut",
    data: {
      labels: condLabels.length ? condLabels : ["Unclassified"],
      datasets: [{ data: condValues.length ? condValues : [0] }]
    },
    options: { responsive: true }
  });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- Tabs ---------- */

function initTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const target = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      document.getElementById(`tab-${target}`).classList.add("active");
    });
  });
}

/* ---------- CSV Loading ---------- */

function parseCsvFile(file, onDone) {
  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    complete: (res) => {
      const data = res.data || [];
      onDone(data);
    }
  });
}

function loadWH(file) {
  parseCsvFile(file, (raw) => {
    if (!raw.length) return;

    WH.meta.loadedAt = new Date();
    WH.meta.fileName = file.name;

    // Assume first row is header
    const header = raw[0];
    const rows = raw.slice(1);

    WH.columns = detectColumns(header);
    WH.rows = rows;

    document.getElementById("whStatus").textContent =
      `WH CSV loaded • ${rows.length} rows • ${nowStamp()} • ${file.name}`;

    computeAll();
  });
}

function loadManifest(file) {
  parseCsvFile(file, (raw) => {
    if (!raw.length) return;

    MANIFEST.fileName = file.name;
    MANIFEST.rows = raw.slice(1);
    MANIFEST.trackingSet = new Set();

    // Try to detect a tracking-like column in manifest:
    const header = raw[0].map(h => normLower(h));
    let idx = header.indexOf("tracking");
    if (idx < 0) idx = header.indexOf("tracking number");
    if (idx < 0) idx = 0; // fallback first column

    for (const r of MANIFEST.rows) {
      const t = normalizePossibleScientific(getCell(r, idx));
      if (!t) continue;
      MANIFEST.trackingSet.add(norm(t));
    }

    document.getElementById("manifestClear").disabled = false;
    renderManifest();
  });
}

/* ---------- Manifest Checker ---------- */

function renderManifest() {
  const c = WH.computed;

  const manRows = MANIFEST.rows.length;
  const manUnique = MANIFEST.trackingSet.size;

  setText("manRows", manRows);
  setText("manUnique", manUnique);

  if (!c || c.uniqueTrackingCount === 0 || manUnique === 0) {
    setText("manMatched", 0);
    setText("manMissing", 0);
    setText("manExtra", 0);
    document.getElementById("missingList").innerHTML = "";
    document.getElementById("extraList").innerHTML = "";
    return;
  }

  // WH tracking set (tracking rows only)
  const whTracking = new Set();
  for (const name of ["FedEx", "UPS", "USPS", "Other"]) {
    for (const t of c.uniqueTrackingByCarrier[name]) whTracking.add(t);
  }

  const missing = [];
  const extra = [];

  for (const t of whTracking) {
    if (!MANIFEST.trackingSet.has(t)) missing.push(t);
  }

  for (const t of MANIFEST.trackingSet) {
    if (!whTracking.has(t)) extra.push(t);
  }

  setText("manMatched", whTracking.size - missing.length);
  setText("manMissing", missing.length);
  setText("manExtra", extra.length);

  const missingList = document.getElementById("missingList");
  missingList.innerHTML = "";
  missing.slice(0, 50).forEach(t => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = t;
    missingList.appendChild(div);
  });

  const extraList = document.getElementById("extraList");
  extraList.innerHTML = "";
  extra.slice(0, 50).forEach(t => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = t;
    extraList.appendChild(div);
  });
}

/* ---------- Manual Counts ---------- */

function loadManualCounts() {
  try {
    const raw = localStorage.getItem(LS_KEYS.manualCounts);
    if (!raw) return { carriers: {}, looseParts: {} };
    const obj = JSON.parse(raw);
    return {
      carriers: obj.carriers || {},
      looseParts: obj.looseParts || {}
    };
  } catch {
    return { carriers: {}, looseParts: {} };
  }
}

function saveManualCounts(obj) {
  localStorage.setItem(LS_KEYS.manualCounts, JSON.stringify(obj));
}

function renderManualCounts() {
  const mc = loadManualCounts();

  const cBody = document.querySelector("#mcCarrierTable tbody");
  cBody.innerHTML = "";
  Object.entries(mc.carriers).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(k)}</td>
      <td class="num">${v}</td>
      <td class="num"><button class="btn danger" data-del-carrier="${escapeHtml(k)}">Del</button></td>
    `;
    cBody.appendChild(tr);
  });

  const lBody = document.querySelector("#mcLooseTable tbody");
  lBody.innerHTML = "";
  Object.entries(mc.looseParts).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(k)}</td>
      <td class="num">${v}</td>
      <td class="num"><button class="btn danger" data-del-loose="${escapeHtml(k)}">Del</button></td>
    `;
    lBody.appendChild(tr);
  });

  // Delete handlers
  document.querySelectorAll("[data-del-carrier]").forEach(btn=>{
    btn.onclick = () => {
      const key = btn.getAttribute("data-del-carrier");
      const obj = loadManualCounts();
      delete obj.carriers[key];
      saveManualCounts(obj);
      renderManualCounts();
    };
  });

  document.querySelectorAll("[data-del-loose]").forEach(btn=>{
    btn.onclick = () => {
      const key = btn.getAttribute("data-del-loose");
      const obj = loadManualCounts();
      delete obj.looseParts[key];
      saveManualCounts(obj);
      renderManualCounts();
    };
  });
}

/* ---------- Logs ---------- */

function loadLogs() {
  try {
    const raw = localStorage.getItem(LS_KEYS.logs);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveLogs(arr) {
  localStorage.setItem(LS_KEYS.logs, JSON.stringify(arr));
}

function addLogSnapshot() {
  const c = WH.computed;
  if (!c) return;

  const snapshot = {
    at: new Date().toISOString(),
    displayAt: nowStamp(),
    totalScans: c.totalScans,
    uniqueTracking: c.uniqueTrackingCount,
    totalParts: c.totalPartsPieces,
    fedex: c.carrierCounts.FedEx,
    ups: c.carrierCounts.UPS,
    usps: c.carrierCounts.USPS,
    other: c.carrierCounts.Other,
    boxesMultiParts: c.boxesWithMultipleParts,
    fileName: WH.meta.fileName || ""
  };

  const logs = loadLogs();
  logs.unshift(snapshot);
  saveLogs(logs);
  renderLogsTable();
}

function renderLogsTable() {
  const body = document.querySelector("#logsTable tbody");
  body.innerHTML = "";

  const logs = loadLogs();
  logs.forEach((l, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(l.displayAt)}</td>
      <td class="num">${l.totalScans}</td>
      <td class="num">${l.uniqueTracking}</td>
      <td class="num">${l.totalParts}</td>
      <td class="num">${l.fedex}</td>
      <td class="num">${l.ups}</td>
      <td class="num">${l.usps}</td>
      <td class="num">${l.other}</td>
      <td class="num">${l.boxesMultiParts}</td>
      <td class="num"><button class="btn danger" data-log-del="${idx}">Del</button></td>
    `;
    body.appendChild(tr);
  });

  document.querySelectorAll("[data-log-del]").forEach(btn => {
    btn.onclick = () => {
      const i = Number(btn.getAttribute("data-log-del"));
      const logs = loadLogs();
      logs.splice(i, 1);
      saveLogs(logs);
      renderLogsTable();
    };
  });
}

function exportLogsCsv() {
  const logs = loadLogs();
  if (!logs.length) {
    alert("No logs to export.");
    return;
  }

  const cols = [
    "displayAt","fileName","totalScans","uniqueTracking","totalParts",
    "fedex","ups","usps","other","boxesMultiParts"
  ];

  const lines = [cols.join(",")];
  for (const l of logs) {
    const row = cols.map(k => `"${String(l[k] ?? "").replaceAll('"', '""')}"`);
    lines.push(row.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  saveAs(blob, `RRPD_Logs_${new Date().toISOString().slice(0,10)}.csv`);
}

/* ---------- Export Modal (Fixes click-lock bug) ---------- */

function openExportModal() {
  const c = WH.computed;
  if (!c) return;

  const mc = loadManualCounts();

  // Build preview text
  const preview = [];
  preview.push(`Date: ${new Date().toISOString().slice(0,10)}`);
  preview.push(`Computed: ${nowStamp()}`);
  preview.push("");
  preview.push("Tracking Summary (Total Scans - Tracking Rows Only)");
  preview.push(`  FedEx: ${c.carrierCounts.FedEx}`);
  preview.push(`  UPS:   ${c.carrierCounts.UPS}`);
  preview.push(`  USPS:  ${c.carrierCounts.USPS}`);
  preview.push(`  Other: ${c.carrierCounts.Other}`);
  preview.push("");
  preview.push(`Total Scans: ${c.totalScans}`);
  preview.push(`Unique Tracking Numbers: ${c.uniqueTrackingCount}`);
  preview.push(`Repeated Tracking Numbers: ${c.repeatedTrackingIds}`);
  preview.push(`Total Parts (Pieces): ${c.totalPartsPieces}`);
  preview.push(`Boxes With Multiple Parts: ${c.boxesWithMultipleParts}`);
  preview.push("");

  // Conditions (top 10)
  preview.push("Return Conditions (Top)");
  const condArr = Array.from(c.partsByCondition.entries())
    .map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v).slice(0,10);
  if (!condArr.length) preview.push("  (none)");
  for (const x of condArr) preview.push(`  ${x.k}: ${x.v}`);

  preview.push("");
  preview.push("Manual Counts");
  preview.push(`  Carriers entries: ${Object.keys(mc.carriers).length}`);
  preview.push(`  Loose Parts entries: ${Object.keys(mc.looseParts).length}`);

  document.getElementById("exportPreview").textContent = preview.join("\n");
  document.getElementById("exportSubtitle").textContent =
    `${WH.meta.fileName || "WH CSV"} • ${c.totalScans} rows`;

  // modal on
  const backdrop = document.getElementById("modalBackdrop");
  const modal = document.getElementById("exportModal");

  backdrop.style.display = "block";
  backdrop.style.pointerEvents = "auto";
  modal.style.display = "flex";

  // reset confirm
  const cb = document.getElementById("exportConfirm");
  cb.checked = false;
  document.getElementById("exportPdf").disabled = true;
  document.getElementById("exportExcel").disabled = true;

  // lock background scroll
  document.body.style.overflow = "hidden";
}

function closeExportModal() {
  const modal = document.getElementById("exportModal");
  const backdrop = document.getElementById("modalBackdrop");

  modal.style.display = "none";
  backdrop.style.display = "none";
  backdrop.style.pointerEvents = "none";

  // Restore interaction
  document.body.style.overflow = "auto";
  document.body.style.pointerEvents = "auto";
}

function wireModal() {
  document.getElementById("exportCancel").onclick = closeExportModal;
  document.getElementById("modalX").onclick = closeExportModal;
  document.getElementById("modalBackdrop").onclick = closeExportModal;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeExportModal();
  });

  document.getElementById("exportConfirm").addEventListener("change", (e) => {
    const ok = !!e.target.checked;
    document.getElementById("exportPdf").disabled = !ok;
    document.getElementById("exportExcel").disabled = !ok;
  });

  document.getElementById("exportPdf").onclick = async () => {
    await exportPdf();
    closeExportModal();
  };

  document.getElementById("exportExcel").onclick = async () => {
    await exportExcel();
    closeExportModal();
  };
}

/* ---------- PDF Export ---------- */

async function fetchLogoDataUrl() {
  // Load logo from same domain; if missing, skip
  try {
    const resp = await fetch("detroit-axle-logo.png", { cache: "no-store" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function exportPdf() {
  const c = WH.computed;
  if (!c) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

  const logo = await fetchLogoDataUrl();
  if (logo) {
    // place logo at top-left
    doc.addImage(logo, "PNG", 40, 28, 44, 44);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("RRPD Summary", 100, 52);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Date: ${new Date().toISOString().slice(0,10)}   Generated: ${nowStamp()}`, 40, 90);

  const mc = loadManualCounts();

  const table1 = [
    ["FedEx", c.carrierCounts.FedEx],
    ["UPS", c.carrierCounts.UPS],
    ["USPS", c.carrierCounts.USPS],
    ["Other", c.carrierCounts.Other],
    ["Total Scans", c.totalScans],
    ["Unique Tracking Numbers", c.uniqueTrackingCount],
    ["Repeated Tracking Numbers", c.repeatedTrackingIds],
    ["Total Parts (Pieces)", c.totalPartsPieces],
    ["Boxes With Multiple Parts", c.boxesWithMultipleParts],
  ];

  doc.autoTable({
    startY: 110,
    head: [["Metric", "Value"]],
    body: table1,
    theme: "grid",
    styles: { fontSize: 10 },
    headStyles: { fillColor: [12, 32, 64] }
  });

  const condArr = Array.from(c.partsByCondition.entries())
    .map(([k,v])=>[k, v]).sort((a,b)=>b[1]-a[1]).slice(0, 15);

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 18,
    head: [["Return Condition", "Parts (Pieces)"]],
    body: condArr.length ? condArr : [["(none)", "0"]],
    theme: "grid",
    styles: { fontSize: 10 },
    headStyles: { fillColor: [12, 32, 64] }
  });

  // Manual counts summary (not manifest/logs)
  const manualRows = [];
  for (const [k,v] of Object.entries(mc.carriers)) manualRows.push([`Carrier: ${k}`, v]);
  for (const [k,v] of Object.entries(mc.looseParts)) manualRows.push([`Loose Part: ${k}`, v]);

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 18,
    head: [["Manual Entry", "Count"]],
    body: manualRows.length ? manualRows : [["(none)", ""]],
    theme: "grid",
    styles: { fontSize: 10 },
    headStyles: { fillColor: [12, 32, 64] }
  });

  doc.save(`RRPD_Summary_${new Date().toISOString().slice(0,10)}.pdf`);
}

/* ---------- Excel Export ---------- */

async function exportExcel() {
  const c = WH.computed;
  if (!c) return;

  const mc = loadManualCounts();
  const wb = new ExcelJS.Workbook();
  wb.creator = "RRPD Dashboard";
  wb.created = new Date();

  const ws = wb.addWorksheet("RRPD Summary", { views: [{ state: "frozen", ySplit: 6 }] });

  // Column widths
  ws.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 18 }
  ];

  // Theme fills (dark blue)
  const fillHeader = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0C2040" } };
  const fillAlt = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102447" } };
  const fontWhite = { color: { argb: "FFE8F0FF" }, bold: true };

  // Logo
  const logoDataUrl = await fetchLogoDataUrl();
  if (logoDataUrl) {
    const imgId = wb.addImage({ base64: logoDataUrl, extension: "png" });
    ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 110, height: 55 } });
  }

  // Title
  ws.mergeCells("A1:B1");
  ws.getCell("A1").value = "RRPD Summary";
  ws.getCell("A1").font = { size: 16, bold: true, color: { argb: "FFE8F0FF" } };
  ws.getCell("A1").fill = fillHeader;
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 28;

  ws.mergeCells("A2:B2");
  ws.getCell("A2").value = `Date: ${new Date().toISOString().slice(0,10)}   Generated: ${nowStamp()}`;
  ws.getCell("A2").fill = fillHeader;
  ws.getCell("A2").font = { color: { argb: "FFE8F0FF" }, italic: true };
  ws.getCell("A2").alignment = { vertical: "middle", horizontal: "center" };

  // Header row for table
  ws.getRow(4).values = ["Metric", "Value"];
  ws.getRow(4).eachCell(cell => {
    cell.fill = fillHeader;
    cell.font = fontWhite;
    cell.border = { bottom: { style: "thin", color: { argb: "FF2B7CFF" } } };
  });

  const rows = [
    ["FedEx", c.carrierCounts.FedEx],
    ["UPS", c.carrierCounts.UPS],
    ["USPS", c.carrierCounts.USPS],
    ["Other", c.carrierCounts.Other],
    ["Total Scans", c.totalScans],
    ["Unique Tracking Numbers", c.uniqueTrackingCount],
    ["Repeated Tracking Numbers", c.repeatedTrackingIds],
    ["Total Parts (Pieces)", c.totalPartsPieces],
    ["Boxes With Multiple Parts", c.boxesWithMultipleParts]
  ];

  let r = 5;
  for (const [m, v] of rows) {
    ws.getCell(`A${r}`).value = m;
    ws.getCell(`B${r}`).value = v;
    if (r % 2 === 1) {
      ws.getCell(`A${r}`).fill = fillAlt;
      ws.getCell(`B${r}`).fill = fillAlt;
    }
    ws.getCell(`A${r}`).font = { color: { argb: "FFE8F0FF" } };
    ws.getCell(`B${r}`).font = { color: { argb: "FFE8F0FF" }, bold: true };
    r++;
  }

  // Conditions sheet
  const ws2 = wb.addWorksheet("Return Conditions");
  ws2.columns = [
    { header: "Condition", key: "condition", width: 35 },
    { header: "Parts (Pieces)", key: "parts", width: 18 }
  ];
  ws2.getRow(1).eachCell(c => { c.fill = fillHeader; c.font = fontWhite; });

  const condArr = Array.from(c.partsByCondition.entries()).sort((a,b)=>b[1]-a[1]);
  for (const [k,v] of condArr) ws2.addRow({ condition: k, parts: v });

  // Manual counts sheet
  const ws3 = wb.addWorksheet("Manual Counts");
  ws3.columns = [
    { header: "Type", key: "type", width: 18 },
    { header: "Name", key: "name", width: 30 },
    { header: "Count", key: "count", width: 12 }
  ];
  ws3.getRow(1).eachCell(c => { c.fill = fillHeader; c.font = fontWhite; });

  for (const [k,v] of Object.entries(mc.carriers)) ws3.addRow({ type: "Carrier", name: k, count: v });
  for (const [k,v] of Object.entries(mc.looseParts)) ws3.addRow({ type: "Loose Part", name: k, count: v });
  if (!Object.keys(mc.carriers).length && !Object.keys(mc.looseParts).length) {
    ws3.addRow({ type: "(none)", name: "", count: "" });
  }

  // Make all sheets dark background feel by styling used range lightly (simple)
  [ws, ws2, ws3].forEach(sheet => {
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = cell.border || { bottom: { style: "thin", color: { argb: "FF1A3A6B" } } };
        cell.alignment = cell.alignment || { vertical: "middle" };
      });
      if (rowNumber > 1 && rowNumber !== 4 && sheet === ws) return;
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf]), `RRPD_Summary_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ---------- Init + Wire ---------- */

function initManualControls() {
  renderManualCounts();

  document.getElementById("mcCarrierAdd").onclick = () => {
    const name = norm(document.getElementById("mcCarrierName").value);
    const val = safeInt(document.getElementById("mcCarrierVal").value);
    if (!name) return;

    const obj = loadManualCounts();
    obj.carriers[name] = (obj.carriers[name] ?? 0) + Math.max(0, val);
    saveManualCounts(obj);

    document.getElementById("mcCarrierName").value = "";
    document.getElementById("mcCarrierVal").value = "";
    renderManualCounts();
  };

  document.getElementById("mcLooseAdd").onclick = () => {
    const name = norm(document.getElementById("mcLooseName").value);
    const val = safeInt(document.getElementById("mcLooseVal").value);
    if (!name) return;

    const obj = loadManualCounts();
    obj.looseParts[name] = (obj.looseParts[name] ?? 0) + Math.max(0, val);
    saveManualCounts(obj);

    document.getElementById("mcLooseName").value = "";
    document.getElementById("mcLooseVal").value = "";
    renderManualCounts();
  };

  document.getElementById("mcClear").onclick = () => {
    if (!confirm("Clear manual counts only?")) return;
    saveManualCounts({ carriers: {}, looseParts: {} });
    renderManualCounts();
  };
}

function initButtons() {
  document.getElementById("whFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    loadWH(f);
  });

  document.getElementById("exportBtn").onclick = openExportModal;

  document.getElementById("saveLogBtn").onclick = () => {
    addLogSnapshot();
    alert("Saved to Logs.");
  };

  document.getElementById("manifestFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    loadManifest(f);
  });

  document.getElementById("manifestClear").onclick = () => {
    MANIFEST = { rows: [], fileName: null, trackingSet: new Set() };
    document.getElementById("manifestClear").disabled = true;
    renderManifest();
  };

  document.getElementById("logsExportCsv").onclick = exportLogsCsv;

  document.getElementById("logsClear").onclick = () => {
    if (!confirm("Clear ALL logs? This cannot be undone.")) return;
    saveLogs([]);
    renderLogsTable();
  };
}

function init() {
  initTabs();
  wireModal();
  initButtons();
  initManualControls();
  renderLogsTable();
}

init();
