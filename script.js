console.log("RRPD v3 script loaded");

/* ---------- DOM ---------- */
const statusEl = document.getElementById("status_text");
const updatedSmall = document.getElementById("updated_small");

const whCsvInput = document.getElementById("wh_csv_input");
const whUploadBtn = document.getElementById("wh_upload_btn");

const saveLogBtn = document.getElementById("save_log_btn");
const exportBtn = document.getElementById("export_btn");

/* Dashboard KPI */
const kpiFedEx = document.getElementById("kpi_fedex");
const kpiUPS = document.getElementById("kpi_ups");
const kpiUSPS = document.getElementById("kpi_usps");
const kpiOther = document.getElementById("kpi_other");
const kpiTotalScans = document.getElementById("kpi_total_scans");
const kpiTotalParts = document.getElementById("kpi_total_parts");
const kpiUniqueTracking = document.getElementById("kpi_unique_tracking");
const kpiDupes = document.getElementById("kpi_dupes");

const trackingSamplesEl = document.getElementById("tracking_samples");

/* Manifest */
const manifestCsvInput = document.getElementById("manifest_csv_input");
const manifestRunBtn = document.getElementById("manifest_run");
const manifestClearBtn = document.getElementById("manifest_clear");

const kpiManifestTotal = document.getElementById("kpi_manifest_total");
const kpiWhFedexUnique = document.getElementById("kpi_wh_fedex_unique");
const kpiMissingInWh = document.getElementById("kpi_missing_in_wh");
const kpiExtraInWh = document.getElementById("kpi_extra_in_wh");

const manifestMissingList = document.getElementById("manifest_missing_list");
const manifestExtraList = document.getElementById("manifest_extra_list");

/* Logs */
const logsListEl = document.getElementById("logs_list");
const logDetailsEl = document.getElementById("log_details");
const logsClearBtn = document.getElementById("logs_clear");

/* Export modal */
const exportModal = document.getElementById("export_modal");
const exportClose = document.getElementById("export_close");
const exportPreview = document.getElementById("export_preview");
const exportConfirm = document.getElementById("export_confirm");
const exportPDFBtn = document.getElementById("export_pdf");
const exportExcelBtn = document.getElementById("export_excel");

/* ---------- State ---------- */
let charts = {};
const LS_KEYS = {
  manual: "rrpd_manual_counts_v3",
  carriers: "rrpd_carrier_log_v3",
  loose: "rrpd_loose_parts_v3",
  logs: "rrpd_logs_v3"
};

let state = {
  whRows: [],
  computed: null,
  loadedAt: null,

  manual: {},
  carrierLog: [],
  looseParts: [],

  logs: [],

  manifest: {
    loaded: false,
    fedexManifestSet: new Set(),
    missingInWh: [],
    extraInWh: []
  }
};

/* ---------- Tabs ---------- */
function wireTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabs = document.querySelectorAll(".tab");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      tabButtons.forEach(b => b.classList.remove("active"));
      tabs.forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(target)?.classList.add("active");
    });
  });
}

/* ---------- Local Storage ---------- */
function loadLocal() {
  try {
    state.manual = JSON.parse(localStorage.getItem(LS_KEYS.manual) || "{}");
    state.carrierLog = JSON.parse(localStorage.getItem(LS_KEYS.carriers) || "[]");
    state.looseParts = JSON.parse(localStorage.getItem(LS_KEYS.loose) || "[]");
    state.logs = JSON.parse(localStorage.getItem(LS_KEYS.logs) || "[]");
  } catch {
    state.manual = {};
    state.carrierLog = [];
    state.looseParts = [];
    state.logs = [];
  }
}
function saveLocal() {
  localStorage.setItem(LS_KEYS.manual, JSON.stringify(state.manual));
  localStorage.setItem(LS_KEYS.carriers, JSON.stringify(state.carrierLog));
  localStorage.setItem(LS_KEYS.loose, JSON.stringify(state.looseParts));
  localStorage.setItem(LS_KEYS.logs, JSON.stringify(state.logs));
}

/* ---------- Helpers ---------- */
function fmtInt(n) {
  return (Number(n) || 0).toLocaleString();
}
function nowISO() {
  return new Date().toISOString();
}
function dateStampLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function safeStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}
function normalizeTracking(v) {
  // keep as text, strip spaces and trailing .0, fix scientific-looking strings by leaving as-is
  let t = safeStr(v);
  t = t.replace(/\s+/g, "");
  t = t.replace(/\.0$/, "");
  return t;
}

/* Carrier rules (yours) */
function classifyCarrier(trackingRaw) {
  const t = normalizeTracking(trackingRaw).toUpperCase();
  if (!t) return "Other";
  if (t.startsWith("1Z")) return "UPS";
  if (t.startsWith("420")) return "USPS";
  if (t.startsWith("96") || t.startsWith("797")) return "FedEx";
  return "Other";
}

/* multiplier x2 / 2x / x3 / 3x ... */
function extractMultiplier(text) {
  const s = String(text || "");
  const m1 = s.match(/(?:^|[^0-9])x\s*(\d{1,2})(?!\d)/i);
  if (m1) return Math.max(1, parseInt(m1[1], 10));
  const m2 = s.match(/(\d{1,2})\s*x(?!\d)/i);
  if (m2) return Math.max(1, parseInt(m2[1], 10));
  return 1;
}

/* Determine if row is tracking-only */
function isReturnLabelOrPackingSlip(partText, descText) {
  const s = `${partText || ""} ${descText || ""}`.toLowerCase();
  return s.includes("return label") || s.includes("packing slip");
}

/* Try column aliases so different exports still work */
function getFirstField(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== null && String(row[c]).trim() !== "") return row[c];
  }
  return "";
}

/* ---------- Chart ---------- */
function makeChart(id, type, labels, values, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();

  const palette = ["#00bfff", "#36cfc9", "#ffd666", "#ff7875", "#9254de", "#5cdbd3", "#73d13d", "#ffa940"];
  const bg = (values?.length > 1) ? values.map((_, i) => palette[i % palette.length]) : "#00bfff";

  charts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: bg,
        borderColor: "#001529",
        borderWidth: 1.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#f5f8ff", font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed?.y ?? ctx.parsed}`
          }
        }
      },
      scales: (type === "doughnut" || type === "pie") ? {} : {
        x: { ticks: { color: "#f5f8ff" } },
        y: { beginAtZero: true, ticks: { color: "#f5f8ff" } }
      }
    }
  });
}

/* ---------- Compute from WH CSV ---------- */
function computeFromWhRows(rows) {
  const carrierScanCounts = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
  const trackingScanCounts = new Map(); // tracking -> scan rows count
  const trackingCarrier = new Map();    // tracking -> carrier
  const uniqueTrackingSet = new Set();

  const conditionParts = {}; // PN Description -> parts (multiplier-aware)
  let totalParts = 0;

  const samples = [];

  // Build per-tracking parts as well (optional future use)
  // const partsByTracking = new Map();

  for (const r of rows) {
    const tracking = normalizeTracking(getFirstField(r, [
      "Track Number", "Tracking Number", "tracking_number", "track_number", "Tracking", "TRACKING"
    ]));
    if (!tracking) continue;

    const carrier = classifyCarrier(tracking);
    carrierScanCounts[carrier] = (carrierScanCounts[carrier] || 0) + 1;

    uniqueTrackingSet.add(tracking);
    trackingScanCounts.set(tracking, (trackingScanCounts.get(tracking) || 0) + 1);
    if (!trackingCarrier.has(tracking)) trackingCarrier.set(tracking, carrier);

    // Part fields
    const partNumber = safeStr(getFirstField(r, [
      "Part Number", "part_number", "PN", "pn", "Deposco PN", "deposco_pn"
    ]));
    const pnDesc = safeStr(getFirstField(r, [
      "PN Description", "pn_description", "Description", "description"
    ]));

    // Rule: Return Label / Packing Slip are TRACKING ONLY, NOT parts
    const trackOnly = isReturnLabelOrPackingSlip(partNumber, pnDesc);

    // Always collect samples (for verification)
    samples.push({ carrier, tracking });

    if (!trackOnly) {
      const mult = extractMultiplier(partNumber || pnDesc);
      totalParts += mult;

      const key = pnDesc || "Unclassified";
      conditionParts[key] = (conditionParts[key] || 0) + mult;

      // if (!partsByTracking.has(tracking)) partsByTracking.set(tracking, 0);
      // partsByTracking.set(tracking, partsByTracking.get(tracking) + mult);
    }
  }

  const totalScans = Object.values(carrierScanCounts).reduce((a, b) => a + b, 0);

  // Duplicates (tracking IDs that appear more than once)
  const dupes = [];
  for (const [t, c] of trackingScanCounts.entries()) {
    if (c > 1) dupes.push({ tracking: t, scans: c, carrier: trackingCarrier.get(t) || classifyCarrier(t) });
  }
  dupes.sort((a, b) => b.scans - a.scans);

  // Latest 25 samples
  const last25 = samples.slice(-25).reverse();

  // FedEx unique set for manifest compare
  const whFedexUnique = new Set();
  for (const t of uniqueTrackingSet.values()) {
    if (classifyCarrier(t) === "FedEx") whFedexUnique.add(t);
  }

  return {
    carrierScanCounts,
    totalScans,
    totalParts,
    uniqueTrackingCount: uniqueTrackingSet.size,
    repeatedTrackingCount: dupes.length,
    dupesTop: dupes.slice(0, 100),
    samples: last25,
    conditionParts,
    whFedexUnique
  };
}

/* ---------- Render Dashboard ---------- */
function renderDashboard(computed) {
  kpiFedEx.textContent = fmtInt(computed.carrierScanCounts.FedEx || 0);
  kpiUPS.textContent = fmtInt(computed.carrierScanCounts.UPS || 0);
  kpiUSPS.textContent = fmtInt(computed.carrierScanCounts.USPS || 0);
  kpiOther.textContent = fmtInt(computed.carrierScanCounts.Other || 0);

  kpiTotalScans.textContent = fmtInt(computed.totalScans || 0);
  kpiTotalParts.textContent = fmtInt(computed.totalParts || 0);

  kpiUniqueTracking.textContent = fmtInt(computed.uniqueTrackingCount || 0);
  kpiDupes.textContent = fmtInt(computed.repeatedTrackingCount || 0);

  // Samples
  trackingSamplesEl.innerHTML = "";
  computed.samples.forEach(s => {
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `<span>${s.tracking}</span><span>${s.carrier}</span>`;
    trackingSamplesEl.appendChild(div);
  });

  // dupes table
  const tbody = document.querySelector("#table_dupes tbody");
  tbody.innerHTML = "";
  computed.dupesTop.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${d.tracking}</td><td>${fmtInt(d.scans)}</td><td>${d.carrier}</td>`;
    tbody.appendChild(tr);
  });

  // carrier scans chart
  makeChart(
    "chart_carriers",
    "bar",
    ["FedEx", "UPS", "USPS", "Other"],
    [
      computed.carrierScanCounts.FedEx || 0,
      computed.carrierScanCounts.UPS || 0,
      computed.carrierScanCounts.USPS || 0,
      computed.carrierScanCounts.Other || 0
    ],
    "Total Scans"
  );
}

/* ---------- Render Return Conditions ---------- */
function renderConditions(computed) {
  const entries = Object.entries(computed.conditionParts || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const labels = entries.map(e => e[0]);
  const values = entries.map(e => e[1]);

  makeChart("chart_conditions", "doughnut", labels, values, "Parts");

  const tbody = document.querySelector("#table_conditions tbody");
  tbody.innerHTML = "";
  entries.forEach(([cond, parts]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${cond}</td><td>${fmtInt(parts)}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------- Manual Counts ---------- */
const MANUAL_FIELDS = [
  "Good Racks",
  "Core Racks",
  "Good Electric Racks",
  "Core Electric Racks",
  "Good Axles",
  "Used Axles",
  "Good Drive Shafts",
  "Used Drive Shafts",
  "Good Gear boxes",
  "Used Gear boxes"
];

function renderManual() {
  const grid = document.getElementById("manual_grid");
  grid.innerHTML = "";

  MANUAL_FIELDS.forEach(key => {
    const wrap = document.createElement("div");
    wrap.className = "manual-item";
    wrap.innerHTML = `
      <label>${key}</label>
      <input type="number" min="0" data-manual-key="${key}" value="${Number(state.manual[key] || 0)}" />
    `;
    grid.appendChild(wrap);
  });

  const note = document.getElementById("manual_saved_note");
  note.textContent = state.manual._savedAt ? `Saved manual: ${state.manual._savedAt}` : "";

  renderRatios();
}

function renderRatios() {
  const tbody = document.querySelector("#table_ratios tbody");
  tbody.innerHTML = "";

  function ratio(a, b) {
    const A = Number(state.manual[a] || 0);
    const B = Number(state.manual[b] || 0);
    if (!B) return 0;
    return +(A / B).toFixed(2);
  }

  const rows = [
    ["Good : Core Racks", ratio("Good Racks", "Core Racks")],
    ["Good : Core Electric Racks", ratio("Good Electric Racks", "Core Electric Racks")],
    ["Good : Used Axles", ratio("Good Axles", "Used Axles")],
    ["Good : Used Drive Shafts", ratio("Good Drive Shafts", "Used Drive Shafts")],
    ["Good : Used Gear boxes", ratio("Good Gear boxes", "Used Gear boxes")]
  ];

  rows.forEach(([name, val]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${val}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------- Carrier Log ---------- */
function renderCarrierLog() {
  const tbody = document.querySelector("#table_carriers tbody");
  tbody.innerHTML = "";

  state.carrierLog.forEach((row, idx) => {
    const status = row.completedAt ? "Completed" : "Open";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.carrier}</td>
      <td>${fmtInt(row.qty)}</td>
      <td>${row.receivedDate || ""}</td>
      <td>${status}</td>
      <td>${row.completedAt ? new Date(row.completedAt).toLocaleString() : ""}</td>
      <td>
        <button class="btn small" data-action="complete" data-idx="${idx}">
          ${row.completedAt ? "Completed ✓" : "Complete"}
        </button>
        <button class="btn small danger" data-action="delete" data-idx="${idx}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const totals = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
  state.carrierLog.forEach(r => {
    const c = r.carrier || "Other";
    totals[c] = (totals[c] || 0) + (Number(r.qty) || 0);
  });

  makeChart(
    "chart_carrier_log",
    "bar",
    ["FedEx", "UPS", "USPS", "Other"],
    [totals.FedEx, totals.UPS, totals.USPS, totals.Other],
    "Received Qty"
  );
}

/* ---------- Loose Parts ---------- */
function renderLooseParts() {
  const tbody = document.querySelector("#table_loose tbody");
  tbody.innerHTML = "";

  const totals = {};
  state.looseParts.forEach(r => {
    totals[r.condition] = (totals[r.condition] || 0) + 1;
  });

  // newest first
  const sorted = [...state.looseParts].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  sorted.forEach(row => {
    const idx = state.looseParts.findIndex(x => x.id === row.id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.date || ""}</td>
      <td>${row.part || ""}</td>
      <td>${row.condition || ""}</td>
      <td><button class="btn small danger" data-loose-del="${idx}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  const totalsBody = document.querySelector("#table_loose_totals tbody");
  totalsBody.innerHTML = "";
  Object.keys(totals).sort().forEach(k => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${fmtInt(totals[k])}</td>`;
    totalsBody.appendChild(tr);
  });
}

/* ---------- Logs (Snapshots stored on-site) ---------- */
function buildSnapshot(reason = "Manual Save") {
  if (!state.computed) return null;

  // Carrier log totals
  const carrierLogTotals = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
  let carrierCompleted = 0;
  state.carrierLog.forEach(r => {
    carrierLogTotals[r.carrier] = (carrierLogTotals[r.carrier] || 0) + (Number(r.qty) || 0);
    if (r.completedAt) carrierCompleted += 1;
  });

  // Loose totals
  const looseTotals = {};
  state.looseParts.forEach(r => {
    looseTotals[r.condition] = (looseTotals[r.condition] || 0) + 1;
  });

  // Manual totals
  const manualCounts = {};
  MANUAL_FIELDS.forEach(k => manualCounts[k] = Number(state.manual[k] || 0));

  const snap = {
    id: crypto.randomUUID(),
    date: dateStampLocal(),
    createdAt: nowISO(),
    reason,
    summary: {
      trackingScans: { ...state.computed.carrierScanCounts },
      totalScans: state.computed.totalScans,
      uniqueTracking: state.computed.uniqueTrackingCount,
      repeatedTracking: state.computed.repeatedTrackingCount,

      totalParts: state.computed.totalParts,
      returnConditionsParts: { ...state.computed.conditionParts },

      manualCounts,
      carrierLogTotals,
      carrierLogEntries: state.carrierLog.length,
      carrierLogCompleted: carrierCompleted,

      looseTotals,
      looseEntries: state.looseParts.length
    }
  };

  return snap;
}

function renderLogs() {
  logsListEl.innerHTML = "";
  const sorted = [...state.logs].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (!sorted.length) {
    logsListEl.innerHTML = `<div class="row"><span>No logs saved yet.</span></div>`;
    logDetailsEl.textContent = "No log selected.";
    return;
  }

  sorted.forEach(s => {
    const div = document.createElement("div");
    div.className = "row";
    div.style.cursor = "pointer";
    div.innerHTML = `
      <span>${s.date} • ${new Date(s.createdAt).toLocaleString()}</span>
      <span>Total Parts: ${fmtInt(s.summary?.totalParts || 0)}</span>
    `;
    div.addEventListener("click", () => {
      logDetailsEl.textContent = JSON.stringify(s, null, 2);
    });
    logsListEl.appendChild(div);
  });

  // default show latest
  logDetailsEl.textContent = JSON.stringify(sorted[0], null, 2);
}

/* ---------- Export (PDF/Excel only — logs NOT included) ---------- */
function summaryText(snapshot) {
  const s = snapshot.summary;
  const lines = [];
  lines.push(`RRPD Summary`);
  lines.push(`Date: ${snapshot.date}`);
  lines.push(`Computed: ${new Date(snapshot.createdAt).toLocaleString()}`);
  lines.push("");
  lines.push(`Tracking (Total Scans)`);
  lines.push(`FedEx: ${fmtInt(s.trackingScans.FedEx || 0)}`);
  lines.push(`UPS: ${fmtInt(s.trackingScans.UPS || 0)}`);
  lines.push(`USPS: ${fmtInt(s.trackingScans.USPS || 0)}`);
  lines.push(`Other: ${fmtInt(s.trackingScans.Other || 0)}`);
  lines.push(`Total Scans: ${fmtInt(s.totalScans || 0)}`);
  lines.push(`Unique Tracking: ${fmtInt(s.uniqueTracking || 0)}`);
  lines.push(`Repeated Tracking: ${fmtInt(s.repeatedTracking || 0)}`);
  lines.push("");
  lines.push(`Parts (excludes Return Label / Packing Slip)`);
  lines.push(`Total Parts: ${fmtInt(s.totalParts || 0)}`);
  lines.push("");
  lines.push(`Return Conditions (Parts)`);
  const condEntries = Object.entries(s.returnConditionsParts || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  condEntries.slice(0, 15).forEach(([k, v]) => lines.push(`${k}: ${fmtInt(v)}`));
  lines.push("");
  lines.push(`Manual Counts`);
  MANUAL_FIELDS.forEach(k => lines.push(`${k}: ${fmtInt(s.manualCounts?.[k] || 0)}`));
  lines.push("");
  lines.push(`Carrier Log Totals (manual)`);
  ["FedEx","UPS","USPS","Other"].forEach(k => lines.push(`${k}: ${fmtInt(s.carrierLogTotals?.[k] || 0)}`));
  lines.push(`Carrier Log Entries: ${fmtInt(s.carrierLogEntries || 0)} (Completed: ${fmtInt(s.carrierLogCompleted || 0)})`);
  lines.push("");
  lines.push(`Loose Parts`);
  lines.push(`Loose Entries: ${fmtInt(s.looseEntries || 0)}`);
  Object.entries(s.looseTotals || {}).forEach(([k, v]) => lines.push(`${k}: ${fmtInt(v)}`));
  return lines.join("\n");
}

function getLogoDataURL() {
  const img = document.getElementById("da_logo");
  if (!img) return null;
  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || 128;
    c.height = img.naturalHeight || 128;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  } catch { return null; }
}

function exportPDF(snapshot) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  doc.setFillColor(4, 26, 51);
  doc.rect(0, 0, 612, 90, "F");

  const logo = getLogoDataURL();
  if (logo) {
    try { doc.addImage(logo, "PNG", 36, 18, 54, 54); } catch {}
  }

  doc.setTextColor(245, 248, 255);
  doc.setFontSize(18);
  doc.text(`RRPD Summary`, 110, 44);
  doc.setFontSize(11);
  doc.text(`Date: ${snapshot.date}`, 110, 64);
  doc.text(`Computed: ${new Date(snapshot.createdAt).toLocaleString()}`, 110, 80);
  doc.setTextColor(0, 0, 0);

  const s = snapshot.summary;

  doc.autoTable({
    startY: 110,
    head: [["Tracking (Total Scans)", "Value"]],
    body: [
      ["FedEx", s.trackingScans.FedEx || 0],
      ["UPS", s.trackingScans.UPS || 0],
      ["USPS", s.trackingScans.USPS || 0],
      ["Other", s.trackingScans.Other || 0],
      ["Total Scans", s.totalScans || 0],
      ["Unique Tracking", s.uniqueTracking || 0],
      ["Repeated Tracking", s.repeatedTracking || 0],
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [0, 116, 217], textColor: [245, 248, 255] }
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head: [["Parts", "Value"]],
    body: [
      ["Total Parts (excludes Return Label / Packing Slip)", s.totalParts || 0]
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [0, 116, 217], textColor: [245, 248, 255] }
  });

  const condEntries = Object.entries(s.returnConditionsParts || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, 30)
    .map(([k, v]) => [k, v]);

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head: [["Return Conditions (Parts)", "Parts"]],
    body: condEntries,
    styles: { fontSize: 10 },
    headStyles: { fillColor: [0, 116, 217], textColor: [245, 248, 255] }
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head: [["Manual Counts", "Value"]],
    body: MANUAL_FIELDS.map(k => [k, Number(s.manualCounts?.[k] || 0)]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [0, 116, 217], textColor: [245, 248, 255] }
  });

  doc.save(`RRPD_Summary_${snapshot.date}.pdf`);
}

function exportExcel(snapshot) {
  const wb = XLSX.utils.book_new();
  const s = snapshot.summary;

  const summaryRows = [
    ["RRPD Summary", ""],
    ["Date", snapshot.date],
    ["Computed", new Date(snapshot.createdAt).toLocaleString()],
    ["", ""],
    ["Tracking (Total Scans)", "Value"],
    ["FedEx", s.trackingScans.FedEx || 0],
    ["UPS", s.trackingScans.UPS || 0],
    ["USPS", s.trackingScans.USPS || 0],
    ["Other", s.trackingScans.Other || 0],
    ["Total Scans", s.totalScans || 0],
    ["Unique Tracking", s.uniqueTracking || 0],
    ["Repeated Tracking", s.repeatedTracking || 0],
    ["", ""],
    ["Parts", "Value"],
    ["Total Parts (excludes Return Label / Packing Slip)", s.totalParts || 0],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1["!cols"] = [{ wch: 42 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  const condRows = [["Condition", "Parts"]];
  Object.entries(s.returnConditionsParts || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .forEach(([k, v]) => condRows.push([k, v]));
  const ws2 = XLSX.utils.aoa_to_sheet(condRows);
  ws2["!cols"] = [{ wch: 32 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Return Conditions");

  const manualRows = [["Metric", "Value"]];
  MANUAL_FIELDS.forEach(k => manualRows.push([k, Number(s.manualCounts?.[k] || 0)]));
  const ws3 = XLSX.utils.aoa_to_sheet(manualRows);
  ws3["!cols"] = [{ wch: 32 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Manual Counts");

  // Carriers log (manual)
  const clRows = [["Carrier", "Qty", "Received Date", "Status", "Completed At"]];
  state.carrierLog.forEach(r => {
    clRows.push([
      r.carrier,
      Number(r.qty || 0),
      r.receivedDate || "",
      r.completedAt ? "Completed" : "Open",
      r.completedAt ? new Date(r.completedAt).toLocaleString() : ""
    ]);
  });
  const ws4 = XLSX.utils.aoa_to_sheet(clRows);
  ws4["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Carriers");

  // Loose parts
  const lpRows = [["Date", "Part", "Condition"]];
  state.looseParts.forEach(r => lpRows.push([r.date || "", r.part || "", r.condition || ""]));
  const ws5 = XLSX.utils.aoa_to_sheet(lpRows);
  ws5["!cols"] = [{ wch: 14 }, { wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws5, "Loose Parts");

  XLSX.writeFile(wb, `RRPD_Summary_${snapshot.date}.xlsx`);
}

/* ---------- Export Modal ---------- */
function openExportModal() {
  const snap = buildSnapshot("Export");
  if (!snap) return;

  exportPreview.textContent = summaryText(snap);
  exportConfirm.checked = false;
  exportPDFBtn.disabled = true;
  exportExcelBtn.disabled = true;

  exportModal.classList.add("show");
  exportModal.setAttribute("aria-hidden", "false");

  exportConfirm.onchange = () => {
    const ok = exportConfirm.checked;
    exportPDFBtn.disabled = !ok;
    exportExcelBtn.disabled = !ok;
  };

  exportPDFBtn.onclick = () => { exportPDF(snap); closeExportModal(); };
  exportExcelBtn.onclick = () => { exportExcel(snap); closeExportModal(); };
}
function closeExportModal() {
  exportModal.classList.remove("show");
  exportModal.setAttribute("aria-hidden", "true");
}

/* ---------- CSV Parse ---------- */
function parseCSVFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: results => resolve(results.data || []),
      error: err => reject(err)
    });
  });
}

/* ---------- WH Upload ---------- */
async function handleWhUpload(file) {
  statusEl.textContent = "Loading WH CSV…";
  try {
    const rows = await parseCSVFile(file);
    state.whRows = rows;
    state.loadedAt = nowISO();

    state.computed = computeFromWhRows(rows);

    const ts = new Date();
    statusEl.textContent = `WH CSV loaded • ${fmtInt(rows.length)} rows • ${ts.toLocaleString()}`;
    updatedSmall.textContent = `Last loaded: ${ts.toLocaleString()}`;

    exportBtn.disabled = false;
    saveLogBtn.disabled = false;

    renderDashboard(state.computed);
    renderConditions(state.computed);

    // Update manifest KPI baseline
    kpiWhFedexUnique.textContent = fmtInt(state.computed.whFedexUnique.size);

  } catch (e) {
    console.error(e);
    statusEl.textContent = "WH CSV load failed — check file format.";
  }
}

/* ---------- Manifest Compare (CSV) ---------- */
function extractTrackingCandidatesFromRow(rowObj) {
  // Grab ALL cell values, try to find tracking-like strings
  const vals = Object.values(rowObj || {});
  const out = [];
  for (const v of vals) {
    const t = normalizeTracking(v);
    if (!t) continue;

    // Filter obvious non-tracking (too short)
    if (t.length < 6) continue;

    // Keep only FedEx according to your rule (96... or 797...)
    if (classifyCarrier(t) === "FedEx") out.push(t);
  }
  return out;
}

async function runManifestCompare() {
  if (!state.computed) {
    alert("Upload WH CSV first.");
    return;
  }
  const file = manifestCsvInput.files?.[0];
  if (!file) {
    alert("Upload a FedEx Manifest CSV.");
    return;
  }

  manifestMissingList.innerHTML = "";
  manifestExtraList.innerHTML = "";

  try {
    const manifestRows = await parseCSVFile(file);

    const manifestFedexSet = new Set();
    for (const r of manifestRows) {
      extractTrackingCandidatesFromRow(r).forEach(t => manifestFedexSet.add(t));
    }

    const whFedexSet = state.computed.whFedexUnique;

    const missing = [];
    for (const t of manifestFedexSet.values()) {
      if (!whFedexSet.has(t)) missing.push(t);
    }

    const extra = [];
    for (const t of whFedexSet.values()) {
      if (!manifestFedexSet.has(t)) extra.push(t);
    }

    missing.sort();
    extra.sort();

    // KPIs
    kpiManifestTotal.textContent = fmtInt(manifestFedexSet.size);
    kpiWhFedexUnique.textContent = fmtInt(whFedexSet.size);
    kpiMissingInWh.textContent = fmtInt(missing.length);
    kpiExtraInWh.textContent = fmtInt(extra.length);

    // Render lists
    manifestMissingList.innerHTML = missing.length
      ? missing.map(t => `<div class="row"><span>${t}</span></div>`).join("")
      : `<div class="row"><span>None</span></div>`;

    manifestExtraList.innerHTML = extra.length
      ? extra.map(t => `<div class="row"><span>${t}</span></div>`).join("")
      : `<div class="row"><span>None</span></div>`;

  } catch (e) {
    console.error(e);
    alert("Manifest CSV failed to parse.");
  }
}

function clearManifestUI() {
  manifestCsvInput.value = "";
  kpiManifestTotal.textContent = "0";
  kpiMissingInWh.textContent = "0";
  kpiExtraInWh.textContent = "0";
  manifestMissingList.innerHTML = "";
  manifestExtraList.innerHTML = "";
}

/* ---------- Wire UI ---------- */
function wireUpload() {
  whUploadBtn.addEventListener("click", () => whCsvInput.click());
  whCsvInput.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) handleWhUpload(file);
  });
}

function wireExport() {
  exportBtn.addEventListener("click", openExportModal);
  exportClose.addEventListener("click", closeExportModal);
  exportModal.addEventListener("click", e => {
    if (e.target === exportModal) closeExportModal();
  });
}

function wireSaveLogs() {
  saveLogBtn.addEventListener("click", () => {
    const snap = buildSnapshot("Save to Logs");
    if (!snap) return;
    state.logs.push(snap);
    saveLocal();
    renderLogs();
    alert("Saved to Logs.");
  });

  logsClearBtn.addEventListener("click", () => {
    if (!confirm("Clear logs on this browser?")) return;
    state.logs = [];
    saveLocal();
    renderLogs();
  });
}

function wireManualButtons() {
  document.getElementById("manual_save").addEventListener("click", () => {
    document.querySelectorAll("[data-manual-key]").forEach(inp => {
      const key = inp.getAttribute("data-manual-key");
      state.manual[key] = Number(inp.value || 0);
    });
    state.manual._savedAt = new Date().toLocaleString();
    saveLocal();
    renderManual();
  });

  document.getElementById("manual_clear").addEventListener("click", () => {
    if (!confirm("Clear manual counts on this browser?")) return;
    state.manual = {};
    saveLocal();
    renderManual();
  });
}

function wireCarrierLog() {
  const add = document.getElementById("carrier_add");
  const clear = document.getElementById("carrier_clear");

  add.addEventListener("click", () => {
    const carrier = document.getElementById("carrier_name").value.trim();
    const qty = Number(document.getElementById("carrier_qty").value || 0);
    const receivedDate = document.getElementById("carrier_received").value || "";

    if (!carrier || qty <= 0 || !receivedDate) return;

    state.carrierLog.push({
      id: crypto.randomUUID(),
      carrier,
      qty,
      receivedDate,
      createdAt: nowISO(),
      completedAt: null
    });

    saveLocal();
    renderCarrierLog();
    document.getElementById("carrier_qty").value = "";
  });

  clear.addEventListener("click", () => {
    if (!confirm("Clear carrier log on this browser?")) return;
    state.carrierLog = [];
    saveLocal();
    renderCarrierLog();
  });

  document.querySelector("#table_carriers tbody").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const idx = Number(btn.dataset.idx);
    const action = btn.dataset.action;
    if (Number.isNaN(idx) || !state.carrierLog[idx]) return;

    if (action === "delete") {
      state.carrierLog.splice(idx, 1);
      saveLocal();
      renderCarrierLog();
      return;
    }

    if (action === "complete") {
      const row = state.carrierLog[idx];
      row.completedAt = row.completedAt ? null : nowISO();
      saveLocal();
      renderCarrierLog();
    }
  });
}

function wireLooseParts() {
  const add = document.getElementById("loose_add");
  const clear = document.getElementById("loose_clear");

  add.addEventListener("click", () => {
    const part = document.getElementById("loose_part").value.trim();
    const condition = document.getElementById("loose_condition").value.trim();
    const date = document.getElementById("loose_date").value || "";

    if (!part || !condition || !date) return;

    state.looseParts.push({
      id: crypto.randomUUID(),
      part,
      condition,
      date,
      createdAt: nowISO()
    });

    saveLocal();
    renderLooseParts();
    document.getElementById("loose_part").value = "";
  });

  clear.addEventListener("click", () => {
    if (!confirm("Clear loose parts on this browser?")) return;
    state.looseParts = [];
    saveLocal();
    renderLooseParts();
  });

  document.querySelector("#table_loose tbody").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const idx = Number(btn.dataset.looseDel);
    if (Number.isNaN(idx) || !state.looseParts[idx]) return;
    state.looseParts.splice(idx, 1);
    saveLocal();
    renderLooseParts();
  });
}

function wireManifest() {
  manifestRunBtn.addEventListener("click", runManifestCompare);
  manifestClearBtn.addEventListener("click", clearManifestUI);
}

/* ---------- Init ---------- */
function init() {
  wireTabs();
  loadLocal();

  // Render local pages
  renderManual();
  renderCarrierLog();
  renderLooseParts();
  renderLogs();

  // Wire actions
  wireUpload();
  wireExport();
  wireSaveLogs();
  wireManualButtons();
  wireCarrierLog();
  wireLooseParts();
  wireManifest();

  // Disable actions until WH loaded
  exportBtn.disabled = true;
  saveLogBtn.disabled = true;

  // If logs exist, show latest
  if (state.logs.length) {
    logDetailsEl.textContent = JSON.stringify(
      [...state.logs].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0],
      null, 2
    );
  } else {
    logDetailsEl.textContent = "No log selected.";
  }
}

document.addEventListener("DOMContentLoaded", init);
