console.log("RRPD final build loaded");

/* ================== Storage keys ================== */
const KEYS = {
  CSV_LAST: "rrpd_csv_last_summary_final",
  MANUAL: "rrpd_manual_counts_final",
  CARRIERS: "rrpd_carriers_final",
  LOOSE: "rrpd_loose_parts_final"
};

const statusEl = document.getElementById("status_text");
const updatedSmall = document.getElementById("updated_small");

let charts = {};

/* ================== Helpers ================== */
function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(txt);
}
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}
function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(16).slice(2) + Date.now().toString(16)));
}

/* ================== Time helpers ================== */
function toLocalInputNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToISO(dtLocal) {
  if (!dtLocal) return null;
  const ms = Date.parse(dtLocal);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function isoDisplay(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

/* ================== Tabs ================== */
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

/* ================== Charts (multi-color) ================== */
const PALETTE = [
  "#00bfff","#36cfc9","#ffd666","#ff7875",
  "#9254de","#5cdbd3","#69c0ff","#ffc53d",
  "#b37feb","#ff9c6e","#73d13d","#ffd6e7"
];

function makeChart(id, type, labels, values, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();

  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  charts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: colors,
        borderColor: "#001529",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#f5f8ff", font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}` } }
      },
      scales: type === "doughnut" ? {} : {
        x: { ticks: { color: "#f5f8ff" } },
        y: { beginAtZero: true, ticks: { color: "#f5f8ff" } }
      }
    }
  });
}

function makeMultiDatasetBar(id, labels, datasets) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#f5f8ff", font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: "#f5f8ff" } },
        y: { beginAtZero: true, ticks: { color: "#f5f8ff" } }
      }
    }
  });
}

/* ================== CSV parsing ================== */
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];

    if (c === '"' && inQuotes && n === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQuotes = !inQuotes; continue; }

    if (!inQuotes && c === ",") { row.push(cur); cur = ""; continue; }
    if (!inQuotes && c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    if (c !== "\r") cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }

  const headers = (rows.shift() || []).map(h => h.trim());
  return rows
    .filter(r => r.some(x => String(x).trim() !== ""))
    .map(r => Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ""])));
}

function normalizeDesc(desc) {
  const d = String(desc || "").trim();
  return d ? d : "Unclassified";
}

/**
 * Safe multiplier parser:
 * - Counts only if pattern is prefix/suffix multiplier with small N.
 * - Prevents "x2020" being treated as 2020 parts.
 */
function qtyFromPart(partStr) {
  const s = String(partStr || "").trim();
  const low = s.toLowerCase();

  const MIN = 2;
  const MAX = 20; // tighten later if you want (e.g., 10)

  // Suffix: "...x2" "... x 2" with a real preceding char
  let m = low.match(/([a-z0-9])\s*x\s*(\d{1,2})\b/);
  if (m) {
    const n = parseInt(m[2], 10);
    if (n >= MIN && n <= MAX) return n;
  }

  // Prefix: "2x..." "2 x ..." with a real following char
  m = low.match(/\b(\d{1,2})\s*x\s*([a-z0-9])/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= MIN && n <= MAX) return n;
  }

  return 1;
}

function analyzeCSV(records) {
  const TRACK_COL = "Track Number";
  const PART_COL  = "Part Number";
  const DESC_COL  = "PN Description";

  const totalsByTracking = new Map(); // tracking -> parts
  const totalsByDesc = new Map();     // desc -> parts
  const rowsByDesc = new Map();       // desc -> rows
  const breakdown = new Map();        // tracking -> (desc -> {parts, rows})
  const validation = new Map();       // reason -> count

  const bump = (k) => validation.set(k, (validation.get(k) || 0) + 1);

  let counted = 0;

  for (const r of records) {
    const tracking = String(r[TRACK_COL] || "").trim();
    const part = String(r[PART_COL] || "").trim();
    const descRaw = String(r[DESC_COL] || "");
    const descLower = descRaw.toLowerCase();

    if (!tracking || !part) { bump("Missing Track/Part"); continue; }
    if (descLower.includes("return label")) { bump("Return Label"); continue; }
    if (part === tracking) { bump("Part == Track (safety)"); continue; }

    const qty = qtyFromPart(part);
    const desc = normalizeDesc(descRaw);

    totalsByTracking.set(tracking, (totalsByTracking.get(tracking) || 0) + qty);
    totalsByDesc.set(desc, (totalsByDesc.get(desc) || 0) + qty);
    rowsByDesc.set(desc, (rowsByDesc.get(desc) || 0) + 1);

    if (!breakdown.has(tracking)) breakdown.set(tracking, new Map());
    const byDesc = breakdown.get(tracking);
    if (!byDesc.has(desc)) byDesc.set(desc, { parts: 0, rows: 0 });
    const cell = byDesc.get(desc);
    cell.parts += qty;
    cell.rows += 1;

    counted++;
  }

  const validationArr = [...validation.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a,b) => b.count - a.count);

  const skipped = validationArr.reduce((a,x)=>a+x.count,0);

  let trackingArr = [...totalsByTracking.entries()]
    .map(([tracking, parts]) => ({ tracking, parts }));

  // ✅ improvement: sort by most parts first, then tracking
  trackingArr.sort((a, b) => (b.parts - a.parts) || a.tracking.localeCompare(b.tracking));

  const descArr = [...totalsByDesc.entries()]
    .map(([desc, parts]) => ({ desc, parts, rows: rowsByDesc.get(desc) || 0 }))
    .sort((a,b)=>b.parts - a.parts);

  const breakdownArr = [];
  for (const [tracking, byDesc] of breakdown.entries()) {
    for (const [desc, v] of byDesc.entries()) {
      breakdownArr.push({ tracking, desc, parts: v.parts, rows: v.rows });
    }
  }
  breakdownArr.sort((a,b)=>a.tracking.localeCompare(b.tracking) || b.parts - a.parts);

  const totalParts = trackingArr.reduce((sum, r) => sum + r.parts, 0);

  return {
    updatedISO: new Date().toISOString(),
    counted, skipped,
    trackings: trackingArr.length,
    totalParts,
    trackingArr,
    descArr,
    breakdownArr,
    validationArr
  };
}

/* ================== CSV render + export ================== */
function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const csv = rows.map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderCSV(summary) {
  setText("kpi_counted", summary.counted);
  setText("kpi_skipped", summary.skipped);
  setText("kpi_trackings", summary.trackings);
  setText("kpi_parts", summary.totalParts);

  // Validation table
  const vbody = document.querySelector("#table_validation tbody");
  vbody.innerHTML = "";
  if (!summary.validationArr.length) {
    vbody.innerHTML = `<tr><td>None</td><td>0</td></tr>`;
  } else {
    summary.validationArr.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.reason}</td><td>${r.count}</td>`;
      vbody.appendChild(tr);
    });
  }
  const note = document.getElementById("csv_run_note");
  if (note) note.textContent = `Last run: ${isoDisplay(summary.updatedISO)}`;

  const hint = document.getElementById("csv_hint");
  if (hint) hint.textContent = `Tracking table is sorted by most parts first. Export includes full breakdown (not limited).`;

  // Totals by description
  const dbody = document.querySelector("#table_desc tbody");
  dbody.innerHTML = "";
  summary.descArr.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.desc}</td><td>${r.parts}</td><td>${r.rows}</td>`;
    dbody.appendChild(tr);
  });

  // Totals by tracking (already sorted by parts desc)
  const tbody = document.querySelector("#table_tracking tbody");
  tbody.innerHTML = "";
  summary.trackingArr.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.tracking}</td><td>${r.parts}</td>`;
    tbody.appendChild(tr);
  });

  // Breakdown (limit for screen, full in export)
  const bbody = document.querySelector("#table_breakdown tbody");
  bbody.innerHTML = "";
  summary.breakdownArr.slice(0, 250).forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.tracking}</td><td>${r.desc}</td><td>${r.parts}</td><td>${r.rows}</td>`;
    bbody.appendChild(tr);
  });

  // Charts
  const labels = summary.descArr.map(x => x.desc);
  const values = summary.descArr.map(x => x.parts);
  makeChart("chart_desc_pie", "doughnut", labels, values, "Parts");
  makeChart("chart_desc_bar", "bar", labels, values, "Parts");
}

function exportCSVSummary(summary) {
  const rows = [];
  rows.push(["RunAt", summary.updatedISO]);
  rows.push([""]);
  rows.push(["Totals by Description"]);
  rows.push(["Description","Parts","Rows"]);
  summary.descArr.forEach(r => rows.push([r.desc, r.parts, r.rows]));
  rows.push([""]);
  rows.push(["Totals by Tracking (sorted by parts desc)"]);
  rows.push(["Tracking","Parts"]);
  summary.trackingArr.forEach(r => rows.push([r.tracking, r.parts]));
  rows.push([""]);
  rows.push(["Breakdown by Tracking + Description"]);
  rows.push(["Tracking","Description","Parts","Rows"]);
  summary.breakdownArr.forEach(r => rows.push([r.tracking, r.desc, r.parts, r.rows]));
  rows.push([""]);
  rows.push(["Validation / Skips"]);
  rows.push(["Reason","Count"]);
  summary.validationArr.forEach(r => rows.push([r.reason, r.count]));

  downloadCSV("rrpd_csv_summary.csv", rows);
}

/* ================== Manual Counts ================== */
function n(id) {
  const v = Number(document.getElementById(id)?.value ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}
function setN(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = String(val ?? 0);
}
function ratioText(a, b) {
  if (a + b === 0) return "N/A";
  if (b === 0) return `${a}:0 (100% / 0%)`;
  if (a === 0) return `0:${b} (0% / 100%)`;
  const pctA = Math.round((a / (a + b)) * 100);
  const pctB = 100 - pctA;
  return `${a}:${b} (${pctA}% / ${pctB}%)`;
}
function manualRead() {
  return {
    goodRacks: n("m_good_racks"),
    coreRacks: n("m_core_racks"),
    goodERacks: n("m_good_eracks"),
    coreERacks: n("m_core_eracks"),
    goodAxles: n("m_good_axles"),
    usedAxles: n("m_used_axles"),
    goodDS: n("m_good_ds"),
    usedDS: n("m_used_ds"),
    goodGB: n("m_good_gb"),
    usedGB: n("m_used_gb")
  };
}
function manualRender(state) {
  const inputs = state?.inputs;
  if (!inputs) return;

  const totalRacks = inputs.goodRacks + inputs.coreRacks + inputs.goodERacks + inputs.coreERacks;
  const totalAxles = inputs.goodAxles + inputs.usedAxles;
  const totalDS = inputs.goodDS + inputs.usedDS;
  const totalGB = inputs.goodGB + inputs.usedGB;
  const grand = totalRacks + totalAxles + totalDS + totalGB;

  const goodTotal = inputs.goodRacks + inputs.goodERacks + inputs.goodAxles + inputs.goodDS + inputs.goodGB;
  const coreTotal = inputs.coreRacks + inputs.coreERacks;
  const usedTotal = inputs.usedAxles + inputs.usedDS + inputs.usedGB;

  const summaryRows = [
    ["Total Racks", totalRacks],
    ["Total Axles", totalAxles],
    ["Total Drive Shafts", totalDS],
    ["Total Gear boxes", totalGB],
    ["Grand Total", grand],
    ["Good Racks : Core Racks", ratioText(inputs.goodRacks, inputs.coreRacks)],
    ["Good Electric Racks : Core Electric Racks", ratioText(inputs.goodERacks, inputs.coreERacks)],
    ["Good Axles : Used Axles", ratioText(inputs.goodAxles, inputs.usedAxles)],
    ["Good Drive Shafts : Used Drive Shafts", ratioText(inputs.goodDS, inputs.usedDS)],
    ["Good Gear boxes : Used Gear boxes", ratioText(inputs.goodGB, inputs.usedGB)],
    ["Saved", isoDisplay(state.savedAtISO)]
  ];

  const tbody = document.querySelector("#table_manual_summary tbody");
  tbody.innerHTML = "";
  summaryRows.forEach(([k,v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
    tbody.appendChild(tr);
  });

  const note = document.getElementById("manual_saved_note");
  if (note) note.textContent = `Saved: ${isoDisplay(state.savedAtISO)}`;

  makeChart("chart_manual_totals", "bar",
    ["Racks","Axles","Drive Shafts","Gear boxes"],
    [totalRacks,totalAxles,totalDS,totalGB],
    "Total");

  makeChart("chart_manual_pie", "doughnut",
    ["Good","Used","Core"],
    [goodTotal, usedTotal, coreTotal],
    "Counts");

  makeMultiDatasetBar("chart_manual_split",
    ["Racks","Axles","Drive Shafts","Gear boxes"],
    [
      { label:"Good", data:[inputs.goodRacks + inputs.goodERacks, inputs.goodAxles, inputs.goodDS, inputs.goodGB], backgroundColor: "#00bfff" },
      { label:"Used", data:[0, inputs.usedAxles, inputs.usedDS, inputs.usedGB], backgroundColor: "#ffd666" },
      { label:"Core", data:[inputs.coreRacks + inputs.coreERacks, 0, 0, 0], backgroundColor: "#ff7875" }
    ]
  );
}

/* ================== Carriers ================== */
function carriersLoad() { return loadJSON(KEYS.CARRIERS, []); }
function carriersSave(list) { saveJSON(KEYS.CARRIERS, list); }

function carriersRender() {
  const list = carriersLoad();
  const tbody = document.querySelector("#table_carriers tbody");
  tbody.innerHTML = "";

  const totals = new Map();

  list.forEach(item => {
    totals.set(item.name, (totals.get(item.name) || 0) + item.qty);

    const tr = document.createElement("tr");
    const status = item.completedISO ? "Completed" : "Open";
    tr.innerHTML = `
      <td>${item.name}</td>
      <td>${item.qty}</td>
      <td>${isoDisplay(item.receivedISO)}</td>
      <td>${isoDisplay(item.completedISO)}</td>
      <td>${status}</td>
      <td></td>
    `;
    const td = tr.lastElementChild;
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      const next = carriersLoad().filter(x => x.id !== item.id);
      carriersSave(next);
      carriersRender();
    });
    td.appendChild(del);
    tbody.appendChild(tr);
  });

  const labels = [...totals.keys()].sort((a,b)=>a.localeCompare(b));
  const values = labels.map(k => totals.get(k));
  makeChart("chart_carriers", "bar", labels, values, "Received Qty");
}

/* ================== Loose parts ================== */
function looseLoad() { return loadJSON(KEYS.LOOSE, []); }
function looseSave(list) { saveJSON(KEYS.LOOSE, list); }

function looseRender() {
  const list = looseLoad();
  const tbody = document.querySelector("#table_loose tbody");
  tbody.innerHTML = "";

  let total = 0;
  list.forEach(item => {
    total += item.qty;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.part}</td>
      <td>${item.cond}</td>
      <td>${item.qty}</td>
      <td>${isoDisplay(item.dtISO)}</td>
      <td></td>
    `;
    const td = tr.lastElementChild;
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      const next = looseLoad().filter(x => x.id !== item.id);
      looseSave(next);
      looseRender();
    });
    td.appendChild(del);
    tbody.appendChild(tr);
  });

  setText("loose_total", total);
}

/* ================== Export All ================== */
function exportAll() {
  const csvSummary = loadJSON(KEYS.CSV_LAST, null);
  const manual = loadJSON(KEYS.MANUAL, null);
  const carriers = carriersLoad();
  const loose = looseLoad();

  const rows = [];
  rows.push(["SECTION","A","B","C","D","E"]);

  rows.push(["CSV Summary", "RunAt", csvSummary?.updatedISO || "", "", "", ""]);
  rows.push(["Totals by Description", "Description", "Parts", "Rows", "", ""]);
  (csvSummary?.descArr || []).forEach(r => rows.push(["", r.desc, r.parts, r.rows, "", ""]));

  rows.push(["", "", "", "", "", ""]);
  rows.push(["Totals by Tracking (sorted by parts desc)", "Tracking", "Parts", "", "", ""]);
  (csvSummary?.trackingArr || []).forEach(r => rows.push(["", r.tracking, r.parts, "", "", ""]));

  rows.push(["", "", "", "", "", ""]);
  rows.push(["Breakdown", "Tracking", "Description", "Parts", "Rows", ""]);
  (csvSummary?.breakdownArr || []).forEach(r => rows.push(["", r.tracking, r.desc, r.parts, r.rows, ""]));

  rows.push(["", "", "", "", "", ""]);
  rows.push(["Validation / Skips", "Reason", "Count", "", "", ""]);
  (csvSummary?.validationArr || []).forEach(r => rows.push(["", r.reason, r.count, "", "", ""]));

  rows.push(["", "", "", "", "", ""]);
  rows.push(["Manual Counts", "SavedAt", manual?.savedAtISO || "", "", "", ""]);
  if (manual?.inputs) {
    Object.entries(manual.inputs).forEach(([k,v]) => rows.push(["", k, v, "", "", ""]));
  }

  rows.push(["", "", "", "", "", ""]);
  rows.push(["Carriers", "Carrier", "Qty", "ReceivedISO", "CompletedISO", ""]);
  carriers.forEach(c => rows.push(["", c.name, c.qty, c.receivedISO || "", c.completedISO || "", ""]));

  rows.push(["", "", "", "", "", ""]);
  rows.push(["Loose Parts", "Part", "Condition", "Qty", "DateISO", ""]);
  loose.forEach(l => rows.push(["", l.part, l.cond, l.qty, l.dtISO, ""]));

  downloadCSV("rrpd_all_export.csv", rows);
  statusEl.textContent = "Exported rrpd_all_export.csv";
}

/* ================== Init ================== */
function init() {
  wireTabs();

  // CSV
  const csvFile = document.getElementById("csv_file");
  const csvExportBtn = document.getElementById("csv_export_btn");
  const csvClearBtn = document.getElementById("csv_clear_btn");

  csvFile?.addEventListener("change", async () => {
    const file = csvFile.files?.[0];
    if (!file) return;

    try {
      statusEl.textContent = "Reading CSV…";
      const text = await file.text();
      const records = parseCSV(text);
      const summary = analyzeCSV(records);

      saveJSON(KEYS.CSV_LAST, summary);
      renderCSV(summary);

      statusEl.textContent = "CSV loaded";
      if (updatedSmall) updatedSmall.textContent = `Last updated: ${isoDisplay(summary.updatedISO)}`;
    } catch (e) {
      console.error(e);
      statusEl.textContent = "CSV error — check console";
    }
  });

  csvExportBtn?.addEventListener("click", () => {
    const summary = loadJSON(KEYS.CSV_LAST, null);
    if (!summary) { statusEl.textContent = "Upload a CSV first"; return; }
    exportCSVSummary(summary);
    statusEl.textContent = "Exported rrpd_csv_summary.csv";
  });

  csvClearBtn?.addEventListener("click", () => {
    localStorage.removeItem(KEYS.CSV_LAST);
    statusEl.textContent = "CSV cleared";
    renderCSV({
      updatedISO: new Date().toISOString(),
      counted: 0, skipped: 0, trackings: 0, totalParts: 0,
      trackingArr: [], descArr: [], breakdownArr: [], validationArr: []
    });
  });

  // Manual
  const manualDT = document.getElementById("manual_dt");
  if (manualDT) manualDT.value = toLocalInputNow();

  document.getElementById("manual_now")?.addEventListener("click", () => {
    if (manualDT) manualDT.value = toLocalInputNow();
  });

  document.getElementById("manual_save")?.addEventListener("click", () => {
    const inputs = manualRead();
    const savedAtISO = localToISO(manualDT?.value) || new Date().toISOString();
    const state = { inputs, savedAtISO };
    saveJSON(KEYS.MANUAL, state);
    statusEl.textContent = "Manual saved";
    manualRender(state);
  });

  document.getElementById("manual_clear")?.addEventListener("click", () => {
    localStorage.removeItem(KEYS.MANUAL);
    [
      "m_good_racks","m_core_racks","m_good_eracks","m_core_eracks",
      "m_good_axles","m_used_axles","m_good_ds","m_used_ds",
      "m_good_gb","m_used_gb"
    ].forEach(id => setN(id, 0));
    document.querySelector("#table_manual_summary tbody").innerHTML = "";
    document.getElementById("manual_saved_note").textContent = "";
    statusEl.textContent = "Manual cleared";
  });

  // Carriers
  document.getElementById("carrier_received_now")?.addEventListener("click", () => {
    document.getElementById("carrier_received").value = toLocalInputNow();
  });
  document.getElementById("carrier_completed_now")?.addEventListener("click", () => {
    document.getElementById("carrier_completed").value = toLocalInputNow();
  });

  document.getElementById("carrier_add")?.addEventListener("click", () => {
    const name = String(document.getElementById("carrier_name").value || "").trim();
    const qty = Math.max(0, Math.floor(Number(document.getElementById("carrier_qty").value || 0)));
    const receivedISO = localToISO(document.getElementById("carrier_received").value) || new Date().toISOString();
    const completedISO = localToISO(document.getElementById("carrier_completed").value) || "";

    if (!name) { statusEl.textContent = "Carrier name required"; return; }
    if (!Number.isFinite(qty)) { statusEl.textContent = "Carrier qty required"; return; }

    const list = carriersLoad();
    list.push({ id: uid(), name, qty, receivedISO, completedISO });
    carriersSave(list);

    document.getElementById("carrier_name").value = "";
    document.getElementById("carrier_qty").value = "";
    document.getElementById("carrier_received").value = "";
    document.getElementById("carrier_completed").value = "";

    carriersRender();
    statusEl.textContent = "Carrier added";
  });

  document.getElementById("carrier_export")?.addEventListener("click", () => {
    const list = carriersLoad();
    const rows = [["Carrier","Qty","ReceivedISO","CompletedISO"]];
    list.forEach(c => rows.push([c.name, c.qty, c.receivedISO || "", c.completedISO || ""]));
    downloadCSV("rrpd_carriers.csv", rows);
    statusEl.textContent = "Exported rrpd_carriers.csv";
  });

  document.getElementById("carrier_clear")?.addEventListener("click", () => {
    localStorage.removeItem(KEYS.CARRIERS);
    carriersRender();
    statusEl.textContent = "Carriers cleared";
  });

  // Loose
  const looseDT = document.getElementById("loose_dt");
  if (looseDT) looseDT.value = toLocalInputNow();

  document.getElementById("loose_now")?.addEventListener("click", () => {
    document.getElementById("loose_dt").value = toLocalInputNow();
  });

  document.getElementById("loose_add")?.addEventListener("click", () => {
    const part = String(document.getElementById("loose_part").value || "").trim();
    const cond = String(document.getElementById("loose_cond").value || "Good");
    const dtISO = localToISO(document.getElementById("loose_dt").value) || new Date().toISOString();
    if (!part) { statusEl.textContent = "Loose part required"; return; }

    const qty = qtyFromPart(part);
    const list = looseLoad();
    list.push({ id: uid(), part, cond, qty, dtISO });
    looseSave(list);

    document.getElementById("loose_part").value = "";
    looseRender();
    statusEl.textContent = "Loose part added";
  });

  document.getElementById("loose_export")?.addEventListener("click", () => {
    const list = looseLoad();
    const rows = [["Part","Condition","Qty","DateISO"]];
    list.forEach(l => rows.push([l.part, l.cond, l.qty, l.dtISO]));
    downloadCSV("rrpd_loose_parts.csv", rows);
    statusEl.textContent = "Exported rrpd_loose_parts.csv";
  });

  document.getElementById("loose_clear")?.addEventListener("click", () => {
    localStorage.removeItem(KEYS.LOOSE);
    looseRender();
    statusEl.textContent = "Loose parts cleared";
  });

  // Export All
  document.getElementById("export_all_btn")?.addEventListener("click", exportAll);

  // Restore saved state
  const savedCSV = loadJSON(KEYS.CSV_LAST, null);
  if (savedCSV) renderCSV(savedCSV);

  const savedManual = loadJSON(KEYS.MANUAL, null);
  if (savedManual?.inputs) {
    const i = savedManual.inputs;
    setN("m_good_racks", i.goodRacks);
    setN("m_core_racks", i.coreRacks);
    setN("m_good_eracks", i.goodERacks);
    setN("m_core_eracks", i.coreERacks);
    setN("m_good_axles", i.goodAxles);
    setN("m_used_axles", i.usedAxles);
    setN("m_good_ds", i.goodDS);
    setN("m_used_ds", i.usedDS);
    setN("m_good_gb", i.goodGB);
    setN("m_used_gb", i.usedGB);
    manualRender(savedManual);
  }

  carriersRender();
  looseRender();

  const now = new Date().toISOString();
  if (updatedSmall) updatedSmall.textContent = `Last updated: ${isoDisplay(now)}`;
}

document.addEventListener("DOMContentLoaded", init);
