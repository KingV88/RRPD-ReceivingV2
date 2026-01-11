console.log("RRPD v2 script loaded");

const statusEl = document.getElementById("status_text");
const updatedSmall = document.getElementById("updated_small");

const csvInput = document.getElementById("csv_input");
const uploadBtn = document.getElementById("upload_btn");
const exportBtn = document.getElementById("export_btn");

const exportModal = document.getElementById("export_modal");
const exportClose = document.getElementById("export_close");
const exportPreview = document.getElementById("export_preview");
const exportConfirm = document.getElementById("export_confirm");
const exportPDFBtn = document.getElementById("export_pdf");
const exportExcelBtn = document.getElementById("export_excel");

const kpiFedEx = document.getElementById("kpi_fedex");
const kpiUPS = document.getElementById("kpi_ups");
const kpiUSPS = document.getElementById("kpi_usps");
const kpiOther = document.getElementById("kpi_other");
const kpiTotal = document.getElementById("kpi_total");
const kpiDupes = document.getElementById("kpi_dupes");

const trackingSamplesEl = document.getElementById("tracking_samples");

let charts = {};
let state = {
  loadedAt: null,
  rows: [],
  computed: null,
  manual: {},
  carrierLog: [],
  looseParts: [],
  snapshots: []
};

/* ---------------- Tabs ---------------- */
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

/* ---------------- Local Storage ---------------- */
const LS_KEYS = {
  manual: "rrpd_manual_counts_v2",
  carriers: "rrpd_carrier_log_v2",
  loose: "rrpd_loose_parts_v2",
  snapshots: "rrpd_snapshots_v2"
};

function loadLocal() {
  try {
    state.manual = JSON.parse(localStorage.getItem(LS_KEYS.manual) || "{}");
    state.carrierLog = JSON.parse(localStorage.getItem(LS_KEYS.carriers) || "[]");
    state.looseParts = JSON.parse(localStorage.getItem(LS_KEYS.loose) || "[]");
    state.snapshots = JSON.parse(localStorage.getItem(LS_KEYS.snapshots) || "[]");
  } catch {
    state.manual = {};
    state.carrierLog = [];
    state.looseParts = [];
    state.snapshots = [];
  }
}

function saveLocal() {
  localStorage.setItem(LS_KEYS.manual, JSON.stringify(state.manual));
  localStorage.setItem(LS_KEYS.carriers, JSON.stringify(state.carrierLog));
  localStorage.setItem(LS_KEYS.loose, JSON.stringify(state.looseParts));
  localStorage.setItem(LS_KEYS.snapshots, JSON.stringify(state.snapshots));
}

/* ---------------- Helpers ---------------- */
function fmtInt(n) {
  return (Number(n) || 0).toLocaleString();
}

function nowISO() {
  return new Date().toISOString();
}

function dateStampLocal() {
  // YYYY-MM-DD in local time
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function classifyCarrier(trackingRaw) {
  const t = String(trackingRaw || "").trim().toUpperCase();

  // UPS: 1Z...
  if (t.startsWith("1Z")) return "UPS";

  // USPS (common in your screenshots): starts 420...
  if (t.startsWith("420")) return "USPS";

  // FedEx (your rule): starts 96... OR short 797...
  if (t.startsWith("96") || t.startsWith("797")) return "FedEx";

  return "Other";
}

function extractMultiplier(text) {
  // supports: x2, X2, 2x, 3x, x10, etc
  const s = String(text || "");
  const m1 = s.match(/(?:^|[^0-9])x\s*(\d{1,2})(?!\d)/i);
  if (m1) return Math.max(1, parseInt(m1[1], 10));

  const m2 = s.match(/(\d{1,2})\s*x(?!\d)/i);
  if (m2) return Math.max(1, parseInt(m2[1], 10));

  return 1;
}

function stripMultiplier(text) {
  // remove trailing or embedded xN / Nx for cleaner grouping if needed
  return String(text || "")
    .replace(/x\s*\d{1,2}/ig, "")
    .replace(/\d{1,2}\s*x/ig, "")
    .trim();
}

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

/* ---------------- Chart ---------------- */
function makeChart(id, type, labels, values, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();

  const palette = ["#00bfff", "#36cfc9", "#ffd666", "#ff7875", "#9254de", "#5cdbd3", "#73d13d", "#ffa940"];

  const bg = Array.isArray(values) && values.length > 1
    ? values.map((_, i) => palette[i % palette.length])
    : "#00bfff";

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
            // FIX: no more object/object
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y ?? ctx.parsed}`
          }
        }
      },
      scales: (type === "doughnut" || type === "pie")
        ? {}
        : {
          x: { ticks: { color: "#f5f8ff" } },
          y: { beginAtZero: true, ticks: { color: "#f5f8ff" } }
        }
    }
  });
}

/* ---------------- Compute from CSV ---------------- */
function computeFromRows(rows) {
  // rows expected fields (from WH CSV):
  // Track Number, Part Number, PN Description, Created at, etc.
  const carrierScanCounts = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
  const trackingCounts = new Map(); // tracking -> scans
  const trackingCarrier = new Map(); // tracking -> carrier (first seen)
  const conditionParts = {}; // PN Description -> multiplier-aware parts count
  const conditionRows = {};  // PN Description -> row count (optional)
  const sample = [];

  for (const r of rows) {
    const tracking = safeStr(r["Track Number"]);
    if (!tracking) continue;

    const carrier = classifyCarrier(tracking);
    carrierScanCounts[carrier] = (carrierScanCounts[carrier] || 0) + 1;

    trackingCounts.set(tracking, (trackingCounts.get(tracking) || 0) + 1);
    if (!trackingCarrier.has(tracking)) trackingCarrier.set(tracking, carrier);

    // return conditions
    const desc = safeStr(r["PN Description"]) || "Unclassified";
    conditionRows[desc] = (conditionRows[desc] || 0) + 1;

    // multiplier-aware parts count uses Part Number (your rule)
    const pnRaw = safeStr(r["Part Number"]);
    const mult = extractMultiplier(pnRaw);
    conditionParts[desc] = (conditionParts[desc] || 0) + mult;

    // samples (latest 25)
    sample.push({ carrier, tracking });
  }

  // dupe tracking ids (unique tracking IDs that appear more than once)
  const dupes = [];
  for (const [t, c] of trackingCounts.entries()) {
    if (c > 1) dupes.push({ tracking: t, scans: c, carrier: trackingCarrier.get(t) || classifyCarrier(t) });
  }
  dupes.sort((a, b) => b.scans - a.scans);

  // latest 25 samples (end of file = most recent)
  const last25 = sample.slice(-25).reverse();

  const totalScans = Object.values(carrierScanCounts).reduce((a, b) => a + b, 0);

  return {
    carrierScanCounts,
    totalScans,
    repeatedTrackingCount: dupes.length,
    dupesTop: dupes.slice(0, 80),
    samples: last25,
    conditionParts,
    conditionRows
  };
}

/* ---------------- Render ---------------- */
function renderDashboard(computed) {
  kpiFedEx.textContent = fmtInt(computed.carrierScanCounts.FedEx || 0);
  kpiUPS.textContent = fmtInt(computed.carrierScanCounts.UPS || 0);
  kpiUSPS.textContent = fmtInt(computed.carrierScanCounts.USPS || 0);
  kpiOther.textContent = fmtInt(computed.carrierScanCounts.Other || 0);

  kpiTotal.textContent = fmtInt(computed.totalScans || 0);
  kpiDupes.textContent = fmtInt(computed.repeatedTrackingCount || 0);

  // samples
  trackingSamplesEl.innerHTML = "";
  computed.samples.forEach(s => {
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `<span><span class="badge">${s.carrier}</span> &nbsp; ${s.tracking}</span>`;
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

  // carrier chart
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

function renderConditions(computed) {
  // Sort by parts desc
  const entries = Object.entries(computed.conditionParts || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0));
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

/* ---------------- Manual Counts ---------------- */
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

/* ---------------- Carrier Log ---------------- */
function renderCarrierLog() {
  const tbody = document.querySelector("#table_carriers tbody");
  tbody.innerHTML = "";

  state.carrierLog.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const status = row.completedAt ? "Completed" : "Open";
    tr.innerHTML = `
      <td>${row.carrier}</td>
      <td>${fmtInt(row.qty)}</td>
      <td>${row.receivedDate || ""}</td>
      <td>${status}</td>
      <td>${row.completedAt ? new Date(row.completedAt).toLocaleString() : ""}</td>
      <td>
        <button class="btn small" data-action="complete" data-idx="${idx}">${row.completedAt ? "Completed ✓" : "Complete"}</button>
        <button class="btn small danger" data-action="delete" data-idx="${idx}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // chart: total qty per carrier
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

/* ---------------- Loose Parts ---------------- */
function renderLooseParts() {
  const tbody = document.querySelector("#table_loose tbody");
  tbody.innerHTML = "";

  // newest first
  const sorted = [...state.looseParts].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  sorted.forEach((row, idxSorted) => {
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
}

/* ---------------- Snapshots ---------------- */
function renderSnapshotsList() {
  const el = document.getElementById("snapshot_list");
  el.innerHTML = "";

  // newest first
  const sorted = [...state.snapshots].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (!sorted.length) {
    el.innerHTML = `<div class="row"><span class="badge">No snapshots yet</span></div>`;
    return;
  }

  sorted.forEach(s => {
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `
      <span><span class="badge">${s.date}</span> ${new Date(s.createdAt).toLocaleString()}</span>
      <span class="badge">Total Scans: ${fmtInt(s.summary?.tracking?.totalScans || 0)}</span>
    `;
    el.appendChild(div);
  });
}

/* ---------------- Export (Preview -> PDF/Excel) ---------------- */
function buildSummarySnapshot() {
  const date = dateStampLocal();
  const createdAt = nowISO();

  const computed = state.computed;
  const tracking = {
    fedex: computed?.carrierScanCounts?.FedEx || 0,
    ups: computed?.carrierScanCounts?.UPS || 0,
    usps: computed?.carrierScanCounts?.USPS || 0,
    other: computed?.carrierScanCounts?.Other || 0,
    totalScans: computed?.totalScans || 0,
    repeatedTrackingNumbers: computed?.repeatedTrackingCount || 0
  };

  // top return conditions (parts)
  const condEntries = Object.entries(computed?.conditionParts || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0));

  const conditionsTop = condEntries.slice(0, 12).map(([k, v]) => ({ condition: k, parts: v }));
  const conditionsAll = condEntries.map(([k, v]) => ({ condition: k, parts: v }));

  // manual totals
  const manual = { ...state.manual };
  delete manual._savedAt;

  const manualTotals = MANUAL_FIELDS.reduce((sum, k) => sum + (Number(state.manual[k] || 0)), 0);

  const carriersLogCount = state.carrierLog.length;
  const loosePartsCount = state.looseParts.length;

  return {
    date,
    createdAt,
    summary: {
      tracking,
      returnConditionsTop: conditionsTop,
      returnConditionsAll: conditionsAll,
      manualCounts: manual,
      manualEntries: MANUAL_FIELDS.length,
      manualTotals,
      carriersLogCount,
      loosePartsCount
    }
  };
}

function summaryText(snapshot) {
  const s = snapshot.summary;
  const lines = [];
  lines.push(`RRPD Summary`);
  lines.push(`Date: ${snapshot.date}`);
  lines.push(`Computed: ${new Date(snapshot.createdAt).toLocaleString()}`);
  lines.push("");
  lines.push(`Tracking Summary (Total Scans)`);
  lines.push(`FedEx: ${fmtInt(s.tracking.fedex)}`);
  lines.push(`UPS: ${fmtInt(s.tracking.ups)}`);
  lines.push(`USPS: ${fmtInt(s.tracking.usps)}`);
  lines.push(`Other: ${fmtInt(s.tracking.other)}`);
  lines.push(`Total Scans: ${fmtInt(s.tracking.totalScans)}`);
  lines.push(`Repeated Tracking Numbers: ${fmtInt(s.tracking.repeatedTrackingNumbers)}`);
  lines.push("");
  lines.push(`Return Conditions (Top)`);
  s.returnConditionsTop.forEach(r => lines.push(`${r.condition}: ${fmtInt(r.parts)}`));
  lines.push("");
  lines.push(`Manual Counts`);
  Object.entries(s.manualCounts).forEach(([k, v]) => lines.push(`${k}: ${fmtInt(v)}`));
  lines.push("");
  lines.push(`Entries`);
  lines.push(`Carriers entries: ${fmtInt(s.carriersLogCount)}`);
  lines.push(`Loose Parts entries: ${fmtInt(s.loosePartsCount)}`);
  return lines.join("\n");
}

function openExportModal() {
  if (!state.computed) return;

  const snap = buildSummarySnapshot();
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

  exportPDFBtn.onclick = () => {
    saveSnapshot(snap);
    exportPDF(snap);
    closeExportModal();
  };

  exportExcelBtn.onclick = () => {
    saveSnapshot(snap);
    exportExcel(snap);
    closeExportModal();
  };
}

function closeExportModal() {
  exportModal.classList.remove("show");
  exportModal.setAttribute("aria-hidden", "true");
}

function saveSnapshot(snap) {
  state.snapshots.push(snap);
  saveLocal();
  renderSnapshotsList();
}

function getLogoDataURL() {
  // For PDF/Excel: grab <img> and draw to canvas
  const img = document.getElementById("da_logo");
  if (!img) return null;

  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || 128;
    c.height = img.naturalHeight || 128;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}

function exportPDF(snapshot) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  // background header band
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

  // Tracking table
  doc.autoTable({
    startY: 110,
    head: [["Tracking (Total Scans)", "Value"]],
    body: [
      ["FedEx", s.tracking.fedex],
      ["UPS", s.tracking.ups],
      ["USPS", s.tracking.usps],
      ["Other", s.tracking.other],
      ["Total Scans", s.tracking.totalScans],
      ["Repeated Tracking Numbers", s.tracking.repeatedTrackingNumbers]
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [0, 116, 217], textColor: [245, 248, 255] }
  });

  // Conditions
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head: [["Return Conditions (Parts, multiplier-aware)", "Parts"]],
    body: s.returnConditionsAll.slice(0, 30).map(r => [r.condition, r.parts]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [0, 116, 217], textColor: [245, 248, 255] }
  });

  // Manual counts
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head: [["Manual Counts", "Value"]],
    body: MANUAL_FIELDS.map(k => [k, Number(s.manualCounts[k] || 0)]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [0, 116, 217], textColor: [245, 248, 255] }
  });

  // Entries
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head: [["Entries", "Count"]],
    body: [
      ["Carriers entries", s.carriersLogCount],
      ["Loose Parts entries", s.loosePartsCount]
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [0, 116, 217], textColor: [245, 248, 255] }
  });

  doc.save(`RRPD_Summary_${snapshot.date}.pdf`);
}

function exportExcel(snapshot) {
  const wb = XLSX.utils.book_new();
  const s = snapshot.summary;

  // Sheet 1: Summary
  const summaryRows = [
    ["RRPD Summary", ""],
    ["Date", snapshot.date],
    ["Computed", new Date(snapshot.createdAt).toLocaleString()],
    ["", ""],
    ["Tracking (Total Scans)", "Value"],
    ["FedEx", s.tracking.fedex],
    ["UPS", s.tracking.ups],
    ["USPS", s.tracking.usps],
    ["Other", s.tracking.other],
    ["Total Scans", s.tracking.totalScans],
    ["Repeated Tracking Numbers", s.tracking.repeatedTrackingNumbers],
    ["", ""],
    ["Entries", "Count"],
    ["Carriers entries", s.carriersLogCount],
    ["Loose Parts entries", s.loosePartsCount]
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);

  // Make tracking numbers not turn into scientific notation (for any future sheets)
  // (we don’t export raw tracking list, but we still set base formatting)
  ws1["!cols"] = [{ wch: 30 }, { wch: 30 }];

  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  // Sheet 2: Return Conditions
  const condRows = [["Condition", "Parts"]];
  s.returnConditionsAll.forEach(r => condRows.push([r.condition, r.parts]));
  const ws2 = XLSX.utils.aoa_to_sheet(condRows);
  ws2["!cols"] = [{ wch: 28 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Return Conditions");

  // Sheet 3: Manual Counts
  const manualRows = [["Metric", "Value"]];
  MANUAL_FIELDS.forEach(k => manualRows.push([k, Number(s.manualCounts[k] || 0)]));
  const ws3 = XLSX.utils.aoa_to_sheet(manualRows);
  ws3["!cols"] = [{ wch: 30 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Manual Counts");

  // Sheet 4: Carriers Log
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

  // Sheet 5: Loose Parts
  const lpRows = [["Date", "Part", "Condition"]];
  state.looseParts.forEach(r => lpRows.push([r.date || "", r.part || "", r.condition || ""]));
  const ws5 = XLSX.utils.aoa_to_sheet(lpRows);
  ws5["!cols"] = [{ wch: 14 }, { wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws5, "Loose Parts");

  XLSX.writeFile(wb, `RRPD_Summary_${snapshot.date}.xlsx`);
}

/* ---------------- CSV Load ---------------- */
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

async function handleUpload(file) {
  statusEl.textContent = "Loading CSV…";
  try {
    const rows = await parseCSVFile(file);

    // Normalize: ensure key names match exactly from WH export
    state.rows = rows;
    state.loadedAt = nowISO();
    state.computed = computeFromRows(rows);

    const ts = new Date();
    statusEl.textContent = `WH CSV loaded • ${fmtInt(rows.length)} rows • ${ts.toLocaleString()}`;
    if (updatedSmall) updatedSmall.textContent = `Last loaded: ${ts.toLocaleString()}`;

    exportBtn.disabled = false;

    renderDashboard(state.computed);
    renderConditions(state.computed);

  } catch (e) {
    console.error(e);
    statusEl.textContent = "CSV load failed — check file format.";
  }
}

/* ---------------- Wire UI ---------------- */
function wireUpload() {
  uploadBtn.addEventListener("click", () => csvInput.click());
  csvInput.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  });
}

function wireExport() {
  exportBtn.addEventListener("click", openExportModal);
  exportClose.addEventListener("click", closeExportModal);
  exportModal.addEventListener("click", e => {
    if (e.target === exportModal) closeExportModal();
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
    if (!confirm("Clear manual counts on this computer?")) return;
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
    if (!confirm("Clear carrier log on this computer?")) return;
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
      // toggle complete
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
    if (!confirm("Clear loose parts on this computer?")) return;
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

/* ---------------- Init ---------------- */
function init() {
  wireTabs();
  wireUpload();
  wireExport();

  loadLocal();
  renderManual();
  renderCarrierLog();
  renderLooseParts();
  renderSnapshotsList();

  wireManualButtons();
  wireCarrierLog();
  wireLooseParts();
}

document.addEventListener("DOMContentLoaded", init);
