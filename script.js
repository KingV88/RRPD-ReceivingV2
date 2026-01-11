console.log("RRPD script loaded");

const statusEl = document.getElementById("status_text");
const updatedSmall = document.getElementById("updated_small");

const whCsvInput = document.getElementById("wh_csv");
const exportBtn = document.getElementById("btn_export_snapshot");

let charts = {};

// --------- Storage Keys ---------
const KEYS = {
  MANUAL: "rrpd_manual_counts_v1",
  CARRIERS: "rrpd_carriers_v1",
  LOOSE: "rrpd_loose_parts_v1",
  LAST_SNAPSHOT: "rrpd_last_snapshot_v1",
};

// --------- Utilities ---------
function nowISO() { return new Date().toISOString(); }
function todayISODate() { return new Date().toISOString().slice(0, 10); }

function setStatus(msg) {
  statusEl.textContent = msg;
  if (updatedSmall) updatedSmall.textContent = msg;
}

function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}
function loadJSON(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    if (!s) return fallback;
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function normalizeTracking(raw) {
  return String(raw || "").trim().replace(/\s+/g, "").toUpperCase();
}

// Carrier rules (LOCKED to your operation)
function isFedEx(trk) {
  const s = normalizeTracking(trk);
  if (!/^\d+$/.test(s)) return false;
  return s.startsWith("96") || s.startsWith("797");
}
function isUPS(trk) {
  return normalizeTracking(trk).startsWith("1Z");
}
function isUSPS(trk) {
  const s = normalizeTracking(trk);
  if (!/^\d+$/.test(s)) return false;
  return s.startsWith("420") || (s.startsWith("9") && !s.startsWith("96"));
}
function classifyCarrier(trk) {
  const s = normalizeTracking(trk);
  if (!s) return "Other";
  if (isFedEx(s)) return "FedEx";
  if (isUPS(s)) return "UPS";
  if (isUSPS(s)) return "USPS";
  return "Other";
}

// Extract tracking from row; includes Return Label logic
function extractTrackingFromRow(row) {
  const t =
    row["Tracking Number"] ??
    row["Track Number"] ??
    row["tracking_number"] ??
    row["track_number"] ??
    "";

  const tracking = normalizeTracking(t);
  if (tracking) return tracking;

  const desc = String(row["PN Description"] ?? row["pn_description"] ?? row["Description"] ?? "").toLowerCase();
  const part = normalizeTracking(row["Part Number"] ?? row["part_number"] ?? row["Part"] ?? "");

  // Return Label tracking sometimes is in part number
  if (desc.includes("return label") && part) return part;

  return "";
}

// Multiplier parse: x2, 2x, x3, 3x, "x 2"
function parseMultiplier(text) {
  const s = String(text || "").toLowerCase();

  // x2 / x 2 / x-2
  let m = s.match(/x\s*([2-9])/i);
  if (m) return parseInt(m[1], 10);

  // 2x / 3x
  m = s.match(/([2-9])\s*x/i);
  if (m) return parseInt(m[1], 10);

  return 1;
}

// CSV parser (handles quotes)
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== "") rows.push(row);

  if (!rows.length) return [];

  const header = rows[0].map(h => String(h || "").trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = rows[r][c] ?? "";
    }
    out.push(obj);
  }
  return out;
}

// --------- Chart helper ---------
function makeChart(id, type, labels, values, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor:
            type === "doughnut"
              ? ["#00bfff", "#36cfc9", "#ffd666", "#ff7875", "#9254de", "#5cdbd3", "#13c2c2", "#1890ff"]
              : "#00bfff",
          borderColor: type === "doughnut" ? "#001529" : "#007acc",
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#f5f8ff", font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}` } }
      },
      scales:
        type === "doughnut"
          ? {}
          : {
              x: { ticks: { color: "#f5f8ff" } },
              y: { beginAtZero: true, ticks: { color: "#f5f8ff" } }
            }
    }
  });
}

// --------- Data processing from WH CSV ---------
function computeFromRecords(records) {
  // Carrier scan counts (TOTAL SCANS)
  const carrierCounts = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
  const trackingFreq = new Map();
  const samples = [];

  // Conditions totals (PARTS, multiplier-aware)
  const conditions = {};

  for (const row of records) {
    const trk = extractTrackingFromRow(row);
    if (trk) {
      const carrier = classifyCarrier(trk);
      carrierCounts[carrier]++;

      trackingFreq.set(trk, (trackingFreq.get(trk) || 0) + 1);
      if (samples.length < 25) samples.push(`${carrier} • ${trk}`);
    }

    // Condition + multiplier-aware parts count
    const condition =
      (row["Condition"] ??
        row["Return Condition"] ??
        row["classification"] ??
        row["Classification"] ??
        row["Return"] ??
        "Unclassified") + "";

    const desc = row["PN Description"] ?? row["Description"] ?? "";
    const mult = parseMultiplier(desc);

    const key = String(condition || "Unclassified").trim() || "Unclassified";
    conditions[key] = (conditions[key] || 0) + mult;
  }

  const repeatedTrackingNumbers = [...trackingFreq.values()].filter(v => v > 1).length;
  const totalScans = carrierCounts.FedEx + carrierCounts.UPS + carrierCounts.USPS + carrierCounts.Other;

  return {
    carrierCounts,
    totalScans,
    repeatedTrackingNumbers,
    conditions,
    trackingSamples: samples
  };
}

// --------- Manual counts ---------
const DEFAULT_MANUAL_CATEGORIES = [
  "Good Racks", "Core Racks",
  "Good Electric Racks", "Core Electric Racks",
  "Good Axles", "Used Axles",
  "Good Drive Shafts", "Used Drive Shafts",
  "Good Gear boxes", "Used Gear boxes"
];

function loadManualCounts() {
  const data = loadJSON(KEYS.MANUAL, {});
  for (const k of DEFAULT_MANUAL_CATEGORIES) if (!(k in data)) data[k] = 0;
  return data;
}

function saveManualCounts(obj) {
  saveJSON(KEYS.MANUAL, obj);
}

function calcManualTotalsAndRatios(manual) {
  const get = (k) => Number(manual[k] || 0);

  const totalRacks = get("Good Racks") + get("Core Racks");
  const totalElecRacks = get("Good Electric Racks") + get("Core Electric Racks");
  const totalAxles = get("Good Axles") + get("Used Axles");
  const totalDrive = get("Good Drive Shafts") + get("Used Drive Shafts");
  const totalGear = get("Good Gear boxes") + get("Used Gear boxes");

  const ratio = (a, b) => b === 0 ? "—" : (a / b).toFixed(2);

  const totals = [
    ["Total Racks", totalRacks],
    ["Total Electric Racks", totalElecRacks],
    ["Total Axles", totalAxles],
    ["Total Drive Shafts", totalDrive],
    ["Total Gear boxes", totalGear],
  ];

  const ratios = [
    ["Good : Core Racks", ratio(get("Good Racks"), get("Core Racks"))],
    ["Good : Core Electric Racks", ratio(get("Good Electric Racks"), get("Core Electric Racks"))],
    ["Good : Used Axles", ratio(get("Good Axles"), get("Used Axles"))],
    ["Good : Used Drive Shafts", ratio(get("Good Drive Shafts"), get("Used Drive Shafts"))],
    ["Good : Used Gear boxes", ratio(get("Good Gear boxes"), get("Used Gear boxes"))],
  ];

  return { totals, ratios };
}

function renderManualTables() {
  const manual = loadManualCounts();

  // Current values
  const tb = document.querySelector("#table_manual tbody");
  tb.innerHTML = "";
  for (const k of DEFAULT_MANUAL_CATEGORIES) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${Number(manual[k] || 0)}</td>`;
    tb.appendChild(tr);
  }

  const { totals, ratios } = calcManualTotalsAndRatios(manual);

  // Totals
  const tbt = document.querySelector("#table_manual_totals tbody");
  tbt.innerHTML = "";
  totals.forEach(([k, v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
    tbt.appendChild(tr);
  });

  // Ratios
  const tbr = document.querySelector("#table_manual_ratios tbody");
  tbr.innerHTML = "";
  ratios.forEach(([k, v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
    tbr.appendChild(tr);
  });
}

// --------- Carriers Log ---------
function loadCarriers() {
  return loadJSON(KEYS.CARRIERS, []);
}
function saveCarriers(rows) {
  saveJSON(KEYS.CARRIERS, rows);
}

function renderCarriers() {
  const rows = loadCarriers();
  const tbody = document.querySelector("#table_carriers tbody");
  tbody.innerHTML = "";

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    const status = r.completedAt ? "Completed" : "Open";
    tr.innerHTML = `
      <td>${escapeHtml(r.carrier)}</td>
      <td>${Number(r.qty || 0)}</td>
      <td>${escapeHtml(r.receivedAt || "")}</td>
      <td>${escapeHtml(r.completedAt || "")}</td>
      <td>${status}</td>
      <td>
        ${r.completedAt ? "" : `<button class="btn small primary" data-complete="${idx}">Complete</button>`}
        <button class="btn small danger" data-delete="${idx}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-complete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-complete"));
      const rows2 = loadCarriers();
      rows2[i].completedAt = new Date().toLocaleString();
      saveCarriers(rows2);
      renderCarriers();
    });
  });

  tbody.querySelectorAll("button[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-delete"));
      const rows2 = loadCarriers();
      rows2.splice(i, 1);
      saveCarriers(rows2);
      renderCarriers();
    });
  });
}

// --------- Loose Parts ---------
function loadLoose() {
  return loadJSON(KEYS.LOOSE, []);
}
function saveLoose(rows) {
  saveJSON(KEYS.LOOSE, rows);
}

function renderLoose() {
  const rows = loadLoose();
  const tbody = document.querySelector("#table_loose tbody");
  tbody.innerHTML = "";

  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.date || "")}</td>
      <td>${escapeHtml(r.partNumber || "")}</td>
      <td>${escapeHtml(r.condition || "")}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --------- Conditions render ---------
function renderConditions(conditions) {
  const labels = Object.keys(conditions || {});
  const values = labels.map(k => conditions[k]);

  makeChart("chart_conditions", "doughnut", labels, values, "Parts");

  const tbody = document.querySelector("#table_conditions tbody");
  tbody.innerHTML = "";
  labels
    .map((k, i) => ({ k, v: values[i] }))
    .sort((a, b) => b.v - a.v)
    .forEach(row => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(row.k)}</td><td>${row.v}</td>`;
      tbody.appendChild(tr);
    });
}

// --------- Carrier bar chart + counters ---------
function renderCarrierCounters(carrierCounts, totalScans, repeatedTrackingNumbers, samples) {
  document.getElementById("count_fedex").textContent = carrierCounts.FedEx || 0;
  document.getElementById("count_ups").textContent = carrierCounts.UPS || 0;
  document.getElementById("count_usps").textContent = carrierCounts.USPS || 0;
  document.getElementById("count_other").textContent = carrierCounts.Other || 0;

  document.getElementById("count_total_scans").textContent = totalScans || 0;
  document.getElementById("count_repeated").textContent = repeatedTrackingNumbers || 0;

  makeChart(
    "chart_carriers",
    "bar",
    ["FedEx", "UPS", "USPS", "Other"],
    [carrierCounts.FedEx || 0, carrierCounts.UPS || 0, carrierCounts.USPS || 0, carrierCounts.Other || 0],
    "Total Scans"
  );

  const box = document.getElementById("tracking_sample");
  box.innerHTML = samples && samples.length ? samples.map(s => `<div>${escapeHtml(s)}</div>`).join("") : "<div>(no samples)</div>";
}

// --------- Snapshot build (for Review + Exports) ---------
function buildSnapshot() {
  // If user uploaded a WH CSV, we store computed in LAST_SNAPSHOT
  const base = loadJSON(KEYS.LAST_SNAPSHOT, null);

  const manual = loadManualCounts();
  const { totals, ratios } = calcManualTotalsAndRatios(manual);

  const carriers = loadCarriers();
  const looseParts = loadLoose();

  const snap = {
    date: base?.date || todayISODate(),

    trackingScanCounts: base?.trackingScanCounts || { FedEx: 0, UPS: 0, USPS: 0, Other: 0 },
    totalScans: base?.totalScans || 0,
    repeatedTrackingNumbers: base?.repeatedTrackingNumbers || 0,

    classifications: base?.classifications || {},

    manualCounts: DEFAULT_MANUAL_CATEGORIES.map(name => ({ name, count: Number(manual[name] || 0) })),
    manualRatios: [
      ...totals.map(([metric, value]) => ({ metric, value })),
      ...ratios.map(([metric, value]) => ({ metric, value }))
    ],

    carriers,
    looseParts,

    computedAtISO: base?.computedAtISO || null
  };

  return snap;
}

// --------- Export Review Modal ---------
const modal = document.getElementById("export_modal");
const preview = document.getElementById("export_preview");
const exportTitle = document.getElementById("export_title");
const dateInput = document.getElementById("export_date");
const confirmBox = document.getElementById("export_confirm");

function openExportModal() {
  const snap = buildSnapshot();
  dateInput.value = snap.date;
  confirmBox.checked = false;

  exportTitle.textContent = `RRPD Summary – ${snap.date}`;

  // Small, readable preview
  const condTop = Object.entries(snap.classifications || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, 8);

  preview.innerHTML = `
    <div class="kv">
      <div><b>Date:</b> ${snap.date}</div>
      <div><b>Computed:</b> ${snap.computedAtISO ? new Date(snap.computedAtISO).toLocaleString() : "(not computed yet)"}</div>
    </div>

    <hr class="hr">

    <div><b>Tracking Summary (Total Scans)</b></div>
    <div>FedEx: ${snap.trackingScanCounts.FedEx}</div>
    <div>UPS: ${snap.trackingScanCounts.UPS}</div>
    <div>USPS: ${snap.trackingScanCounts.USPS}</div>
    <div>Other: ${snap.trackingScanCounts.Other}</div>
    <div><b>Total Scans:</b> ${snap.totalScans}</div>
    <div><b>Repeated Tracking Numbers:</b> ${snap.repeatedTrackingNumbers}</div>

    <hr class="hr">

    <div><b>Return Conditions (Top)</b></div>
    ${condTop.length ? condTop.map(([k,v]) => `<div>${escapeHtml(k)}: ${v}</div>`).join("") : "<div>(none)</div>"}

    <hr class="hr">

    <div><b>Manual Counts</b></div>
    <div>Entries: ${snap.manualCounts.length}</div>

    <div style="margin-top:8px;"><b>Carriers</b> entries: ${snap.carriers.length}</div>
    <div><b>Loose Parts</b> entries: ${snap.looseParts.length}</div>
  `;

  window.__SNAPSHOT_TO_EXPORT__ = snap;
  modal.style.display = "flex";
}

document.getElementById("export_cancel")?.addEventListener("click", () => {
  modal.style.display = "none";
});

// --------- Excel Export (dark blue formatting) ---------
function exportSnapshotToExcel(snapshot) {
  const wb = XLSX.utils.book_new();

  const NAVY = "041A33";
  const NAVY2 = "06274A";
  const BLUE = "0057B8";
  const CYAN = "00BFFF";
  const WHITE = "F5F8FF";
  const SOFT = "A9B7D4";

  const headerStyle = {
    font: { bold: true, color: { rgb: WHITE } },
    fill: { fgColor: { rgb: BLUE } },
    alignment: { horizontal: "left", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: NAVY2 } },
      bottom: { style: "thin", color: { rgb: NAVY2 } },
      left: { style: "thin", color: { rgb: NAVY2 } },
      right: { style: "thin", color: { rgb: NAVY2 } }
    }
  };

  const cellStyle = {
    font: { color: { rgb: WHITE } },
    fill: { fgColor: { rgb: NAVY2 } },
    alignment: { vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: NAVY } },
      bottom: { style: "thin", color: { rgb: NAVY } },
      left: { style: "thin", color: { rgb: NAVY } },
      right: { style: "thin", color: { rgb: NAVY } }
    }
  };

  const titleStyle = {
    font: { bold: true, color: { rgb: WHITE }, sz: 16 },
    fill: { fgColor: { rgb: NAVY } },
    alignment: { horizontal: "left", vertical: "center" }
  };

  function styleSheet(ws) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) continue;
        if (!ws[addr].s) ws[addr].s = {};
        // default cells
        ws[addr].s = { ...cellStyle, ...ws[addr].s };
      }
    }
  }

  // -------- Summary sheet
  const summaryRows = [
    ["RRPD Summary", ""],
    [`Date: ${snapshot.date}`, ""],
    [],
    ["Tracking Summary (Total Scans)", ""],
    ["Carrier", "Scans"],
    ["FedEx", snapshot.trackingScanCounts.FedEx],
    ["UPS", snapshot.trackingScanCounts.UPS],
    ["USPS", snapshot.trackingScanCounts.USPS],
    ["Other", snapshot.trackingScanCounts.Other],
    ["Total Scans", snapshot.totalScans],
    ["Repeated Tracking Numbers", snapshot.repeatedTrackingNumbers],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary["!cols"] = [{ wch: 32 }, { wch: 18 }];

  // Style title rows
  wsSummary["A1"].s = titleStyle;
  wsSummary["A2"].s = { font: { color: { rgb: SOFT } }, fill: { fgColor: { rgb: NAVY } } };

  // Header rows
  wsSummary["A5"].s = headerStyle;
  wsSummary["A6"].s = headerStyle; wsSummary["B6"].s = headerStyle;

  styleSheet(wsSummary);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // -------- Return Conditions sheet
  const condRows = [["Condition", "Parts"]];
  Object.entries(snapshot.classifications || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .forEach(([k, v]) => condRows.push([k, v]));
  const wsCond = XLSX.utils.aoa_to_sheet(condRows);
  wsCond["!cols"] = [{ wch: 28 }, { wch: 14 }];
  wsCond["A1"].s = headerStyle; wsCond["B1"].s = headerStyle;
  styleSheet(wsCond);
  XLSX.utils.book_append_sheet(wb, wsCond, "Return Conditions");

  // -------- Manual Counts sheet
  const manualRows = [["Category", "Count"]];
  snapshot.manualCounts.forEach(r => manualRows.push([r.name, r.count]));
  manualRows.push([]);
  manualRows.push(["Totals + Ratios", ""]);
  manualRows.push(["Metric", "Value"]);
  snapshot.manualRatios.forEach(r => manualRows.push([r.metric, r.value]));

  const wsManual = XLSX.utils.aoa_to_sheet(manualRows);
  wsManual["!cols"] = [{ wch: 30 }, { wch: 14 }];
  wsManual["A1"].s = headerStyle; wsManual["B1"].s = headerStyle;
  // Totals+Ratios title row (find it)
  // It's at row: snapshot.manualCounts.length + 3 (1-based)
  const titleRowIdx = snapshot.manualCounts.length + 3;
  const cellTitle = `A${titleRowIdx}`;
  if (wsManual[cellTitle]) wsManual[cellTitle].s = headerStyle;
  const metricHeaderRow = snapshot.manualCounts.length + 4;
  const aMH = `A${metricHeaderRow}`, bMH = `B${metricHeaderRow}`;
  if (wsManual[aMH]) wsManual[aMH].s = headerStyle;
  if (wsManual[bMH]) wsManual[bMH].s = headerStyle;

  styleSheet(wsManual);
  XLSX.utils.book_append_sheet(wb, wsManual, "Manual Counts");

  // -------- Carriers sheet
  const carriersRows = [["Carrier", "Received Qty", "Received At", "Completed At", "Status"]];
  (snapshot.carriers || []).forEach(r => {
    carriersRows.push([
      r.carrier || "",
      Number(r.qty || 0),
      r.receivedAt || "",
      r.completedAt || "",
      r.completedAt ? "Completed" : "Open"
    ]);
  });
  const wsCarriers = XLSX.utils.aoa_to_sheet(carriersRows);
  wsCarriers["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 12 }];
  for (const c of ["A1","B1","C1","D1","E1"]) if (wsCarriers[c]) wsCarriers[c].s = headerStyle;
  styleSheet(wsCarriers);
  XLSX.utils.book_append_sheet(wb, wsCarriers, "Carriers");

  // -------- Loose Parts sheet
  const looseRows = [["Date", "Part Number", "Condition"]];
  (snapshot.looseParts || []).forEach(r => {
    looseRows.push([r.date || "", r.partNumber || "", r.condition || ""]);
  });
  const wsLoose = XLSX.utils.aoa_to_sheet(looseRows);
  wsLoose["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 16 }];
  for (const c of ["A1","B1","C1"]) if (wsLoose[c]) wsLoose[c].s = headerStyle;
  styleSheet(wsLoose);
  XLSX.utils.book_append_sheet(wb, wsLoose, "Loose Parts");

  XLSX.writeFile(wb, `RRPD_Summary_${snapshot.date}.xlsx`);
}

// --------- PDF Export (dark blue + logo + multi-page) ---------
async function fetchLogoDataURL(url = "detroit-axle-logo.png") {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function drawPdfHeader(doc, snapshot, sectionTitle) {
  const NAVY = [4, 26, 51];
  const NAVY2 = [6, 39, 74];
  const WHITE = [245, 248, 255];
  const CYAN = [0, 191, 255];

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, pageH, "F");

  doc.setFillColor(...NAVY2);
  doc.rect(0, 0, pageW, 60, "F");

  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`RRPD Summary – ${snapshot.date}`, 24, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(sectionTitle || "", pageW - 24, 36, { align: "right" });

  doc.setDrawColor(...CYAN);
  doc.setLineWidth(2);
  doc.line(24, 64, pageW - 24, 64);
}

function drawPdfFooter(doc) {
  const WHITE = [245, 248, 255];
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const page = doc.internal.getNumberOfPages();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text(`Page ${page}`, pageW - 24, pageH - 18, { align: "right" });
  doc.text("Detroit Axle • RRPD", 24, pageH - 18);
}

async function exportSnapshotToPDF(snapshot) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });

  let logoDataUrl = null;
  try { logoDataUrl = await fetchLogoDataURL("detroit-axle-logo.png"); } catch {}

  // Cover page header
  drawPdfHeader(doc, snapshot, "Summary");

  // Logo on first page
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, "PNG", 24, 10, 44, 44); } catch {}
  }

  const WHITE = [245, 248, 255];
  const NAVY2 = [6, 39, 74];

  // Summary tables
  const tableTheme = {
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 10,
      textColor: WHITE,
      fillColor: NAVY2,
      lineColor: [255,255,255],
      lineWidth: 0.3,
      cellPadding: 6,
    },
    headStyles: {
      fillColor: [0, 87, 184],
      textColor: WHITE,
      fontStyle: "bold",
    },
    margin: { top: 74, left: 24, right: 24, bottom: 30 },
    rowPageBreak: "avoid",
  };

  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Tracking Summary (Total Scans)", 24, 92);

  doc.autoTable({
    ...tableTheme,
    startY: 102,
    head: [["Carrier", "Scans"]],
    body: [
      ["FedEx", snapshot.trackingScanCounts.FedEx],
      ["UPS", snapshot.trackingScanCounts.UPS],
      ["USPS", snapshot.trackingScanCounts.USPS],
      ["Other", snapshot.trackingScanCounts.Other],
      ["Total Scans", snapshot.totalScans],
      ["Repeated Tracking Numbers", snapshot.repeatedTrackingNumbers],
    ],
    tableWidth: 340,
    didDrawPage: () => {
      drawPdfHeader(doc, snapshot, "Summary");
      drawPdfFooter(doc);
      if (logoDataUrl) {
        try { doc.addImage(logoDataUrl, "PNG", 24, 10, 44, 44); } catch {}
      }
    }
  });

  const condBody = Object.entries(snapshot.classifications || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .map(([k, v]) => [k, v]);

  doc.setFontSize(13);
  doc.text("Return Conditions (Parts, multiplier-aware)", 400, 92);

  doc.autoTable({
    ...tableTheme,
    startY: 102,
    head: [["Condition", "Parts"]],
    body: condBody.length ? condBody : [["(none)", 0]],
    margin: { top: 74, left: 400, right: 24, bottom: 30 },
    tableWidth: doc.internal.pageSize.getWidth() - 424,
    didDrawPage: () => {
      drawPdfHeader(doc, snapshot, "Summary");
      drawPdfFooter(doc);
      if (logoDataUrl) {
        try { doc.addImage(logoDataUrl, "PNG", 24, 10, 44, 44); } catch {}
      }
    }
  });

  // Manual counts + ratios
  doc.addPage();
  drawPdfHeader(doc, snapshot, "Manual Counts");
  drawPdfFooter(doc);

  const manualBody = (snapshot.manualCounts || []).map(r => [r.name, r.count]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...WHITE);
  doc.text("Manual Counts", 24, 92);

  doc.autoTable({
    ...tableTheme,
    startY: 102,
    head: [["Category", "Count"]],
    body: manualBody.length ? manualBody : [["(none)", 0]],
    tableWidth: 360,
    didDrawPage: () => {
      drawPdfHeader(doc, snapshot, "Manual Counts");
      drawPdfFooter(doc);
    }
  });

  const ratioBody = (snapshot.manualRatios || []).map(r => [r.metric, String(r.value)]);
  doc.setFontSize(13);
  doc.text("Totals + Ratios", 420, 92);

  doc.autoTable({
    ...tableTheme,
    startY: 102,
    head: [["Metric", "Value"]],
    body: ratioBody.length ? ratioBody : [["(none)", ""]],
    margin: { top: 74, left: 420, right: 24, bottom: 30 },
    tableWidth: doc.internal.pageSize.getWidth() - 444,
    didDrawPage: () => {
      drawPdfHeader(doc, snapshot, "Manual Counts");
      drawPdfFooter(doc);
    }
  });

  // Carriers section (multi-page)
  doc.addPage();
  drawPdfHeader(doc, snapshot, "Carriers");
  drawPdfFooter(doc);

  const carriersBody = (snapshot.carriers || []).map(r => [
    r.carrier || "",
    Number(r.qty || 0),
    r.receivedAt || "",
    r.completedAt || "",
    r.completedAt ? "Completed" : "Open"
  ]);

  doc.setFontSize(13);
  doc.text("Carriers", 24, 92);

  doc.autoTable({
    ...tableTheme,
    startY: 102,
    head: [["Carrier", "Qty", "Received At", "Completed At", "Status"]],
    body: carriersBody.length ? carriersBody : [["(none)", "", "", "", ""]],
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 60 },
      2: { cellWidth: 170 },
      3: { cellWidth: 170 },
      4: { cellWidth: 80 }
    },
    didDrawPage: () => {
      drawPdfHeader(doc, snapshot, "Carriers");
      drawPdfFooter(doc);
    }
  });

  // Loose Parts section (multi-page)
  doc.addPage();
  drawPdfHeader(doc, snapshot, "Loose Parts");
  drawPdfFooter(doc);

  const looseBody = (snapshot.looseParts || []).map(r => [
    r.date || "",
    r.partNumber || "",
    r.condition || ""
  ]);

  doc.setFontSize(13);
  doc.text("Loose Parts", 24, 92);

  doc.autoTable({
    ...tableTheme,
    startY: 102,
    head: [["Date", "Part Number", "Condition"]],
    body: looseBody.length ? looseBody : [["(none)", "", ""]],
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 280 },
      2: { cellWidth: 120 }
    },
    didDrawPage: () => {
      drawPdfHeader(doc, snapshot, "Loose Parts");
      drawPdfFooter(doc);
    }
  });

  doc.save(`RRPD_Summary_${snapshot.date}.pdf`);
}

// --------- Wire UI events ---------
function wireTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabs = document.querySelectorAll(".tab");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      tabButtons.forEach(b => b.classList.remove("active"));
      tabs.forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(target).classList.add("active");
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wireManual() {
  const cat = document.getElementById("manual_category");
  const cnt = document.getElementById("manual_count");
  const saveBtn = document.getElementById("manual_save");
  const clearBtn = document.getElementById("manual_clear");

  saveBtn.addEventListener("click", () => {
    const manual = loadManualCounts();
    const k = cat.value;
    const v = Number(cnt.value || 0);
    manual[k] = Math.max(0, v);
    saveManualCounts(manual);
    cnt.value = "";
    renderManualTables();
    setStatus(`Saved manual: ${k} = ${manual[k]}`);
  });

  clearBtn.addEventListener("click", () => {
    const reset = {};
    DEFAULT_MANUAL_CATEGORIES.forEach(k => reset[k] = 0);
    saveManualCounts(reset);
    renderManualTables();
    setStatus("Manual counts cleared");
  });
}

function wireCarriers() {
  const name = document.getElementById("carriers_name");
  const qty = document.getElementById("carriers_qty");
  const receivedAt = document.getElementById("carriers_received_at");
  const addBtn = document.getElementById("carriers_add");
  const clearBtn = document.getElementById("carriers_clear");

  // default received date/time to now if empty
  if (!receivedAt.value) {
    const d = new Date();
    receivedAt.value = d.toISOString().slice(0, 16);
  }

  addBtn.addEventListener("click", () => {
    const carrier = String(name.value || "").trim();
    const q = Number(qty.value || 0);
    const ra = receivedAt.value ? new Date(receivedAt.value).toLocaleString() : new Date().toLocaleString();
    if (!carrier) return;

    const rows = loadCarriers();
    rows.unshift({
      carrier,
      qty: Math.max(0, q),
      receivedAt: ra,
      completedAt: ""
    });
    saveCarriers(rows);
    renderCarriers();
    name.value = "";
    qty.value = "";
    setStatus("Carrier entry added");
  });

  clearBtn.addEventListener("click", () => {
    saveCarriers([]);
    renderCarriers();
    setStatus("Carriers cleared");
  });
}

function wireLoose() {
  const date = document.getElementById("loose_date");
  const part = document.getElementById("loose_part");
  const cond = document.getElementById("loose_condition");
  const addBtn = document.getElementById("loose_add");
  const clearBtn = document.getElementById("loose_clear");

  date.value = date.value || todayISODate();

  addBtn.addEventListener("click", () => {
    const d = date.value || todayISODate();
    const p = String(part.value || "").trim();
    const c = String(cond.value || "").trim();
    if (!p) return;

    const rows = loadLoose();
    rows.unshift({ date: d, partNumber: p, condition: c });
    saveLoose(rows);
    renderLoose();
    part.value = "";
    setStatus("Loose part added");
  });

  clearBtn.addEventListener("click", () => {
    saveLoose([]);
    renderLoose();
    setStatus("Loose parts cleared");
  });
}

function wireExport() {
  exportBtn.addEventListener("click", () => {
    openExportModal();
  });

  document.getElementById("export_pdf")?.addEventListener("click", async () => {
    if (!confirmBox.checked) {
      alert("Please confirm the snapshot is correct before exporting.");
      return;
    }
    const snap = window.__SNAPSHOT_TO_EXPORT__;
    snap.date = dateInput.value || snap.date;
    await exportSnapshotToPDF(snap);
    modal.style.display = "none";
  });

  document.getElementById("export_excel")?.addEventListener("click", () => {
    if (!confirmBox.checked) {
      alert("Please confirm the snapshot is correct before exporting.");
      return;
    }
    const snap = window.__SNAPSHOT_TO_EXPORT__;
    snap.date = dateInput.value || snap.date;
    exportSnapshotToExcel(snap);
    modal.style.display = "none";
  });
}

function wireWHUpload() {
  whCsvInput.addEventListener("change", async () => {
    const file = whCsvInput.files?.[0];
    if (!file) return;

    try {
      setStatus("Reading WH CSV...");
      const text = await file.text();
      const records = parseCSV(text);

      const computed = computeFromRecords(records);

      renderCarrierCounters(
        computed.carrierCounts,
        computed.totalScans,
        computed.repeatedTrackingNumbers,
        computed.trackingSamples
      );
      renderConditions(computed.conditions);

      const snapshotForStorage = {
        date: todayISODate(),
        computedAtISO: nowISO(),
        trackingScanCounts: computed.carrierCounts,
        totalScans: computed.totalScans,
        repeatedTrackingNumbers: computed.repeatedTrackingNumbers,
        classifications: computed.conditions
      };
      saveJSON(KEYS.LAST_SNAPSHOT, snapshotForStorage);

      setStatus(`WH CSV loaded • ${records.length} rows • ${new Date().toLocaleString()}`);
    } catch (e) {
      console.error(e);
      setStatus("CSV read error — check console");
    } finally {
      whCsvInput.value = "";
    }
  });
}

// --------- Init ---------
function init() {
  wireTabs();
  wireManual();
  wireCarriers();
  wireLoose();
  wireExport();
  wireWHUpload();

  renderManualTables();
  renderCarriers();
  renderLoose();

  // Load last computed snapshot if exists
  const base = loadJSON(KEYS.LAST_SNAPSHOT, null);
  if (base) {
    renderCarrierCounters(base.trackingScanCounts, base.totalScans, base.repeatedTrackingNumbers, []);
    renderConditions(base.classifications || {});
    setStatus(`Loaded last snapshot • ${new Date(base.computedAtISO || Date.now()).toLocaleString()}`);
  } else {
    renderCarrierCounters({ FedEx: 0, UPS: 0, USPS: 0, Other: 0 }, 0, 0, []);
    renderConditions({});
    setStatus("Ready — upload WH CSV");
  }
}

document.addEventListener("DOMContentLoaded", init);
