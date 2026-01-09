console.log("RRPD replacement loaded");

/* ------------------- Constants / Storage Keys ------------------- */
const KEYS = {
  CSV_LAST: "rrpd_csv_last_summary_v1",
  MANUAL: "rrpd_manual_counts_v1",
  CARRIERS: "rrpd_carriers_v1",
  LOOSE: "rrpd_loose_parts_v1"
};

const statusEl = document.getElementById("status_text");
const updatedSmall = document.getElementById("updated_small");

let charts = {}; // Chart.js instances

/* ------------------- Time helpers (UTC-safe) ------------------- */
function toLocalInputValueFromNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToISO(dtLocal) {
  if (!dtLocal) return null;
  const ms = Date.parse(dtLocal); // interpreted as local time of the computer doing entry
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString(); // stored as UTC ISO (consistent worldwide)
}
function isoToUTCDisplay(iso) {
  if (!iso) return "";
  // show explicit UTC to avoid confusion
  const d = new Date(iso);
  return d.toISOString().replace("T", " ").replace(".000Z", "Z");
}

/* ------------------- Tabs ------------------- */
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

/* ------------------- Chart helpers ------------------- */
function makeChart(id, type, labels, values, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: type === "doughnut"
          ? ["#00bfff","#36cfc9","#ffd666","#ff7875","#9254de","#5cdbd3","#69c0ff","#ffc53d","#b37feb"]
          : "#00bfff",
        borderColor: type === "doughnut" ? "#001529" : "#007acc",
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

/* ------------------- CSV parsing / counting ------------------- */
function qtyFromPart(partStr) {
  const s = String(partStr || "").toLowerCase();

  // "...x2" or "... x 2"
  let m = s.match(/\bx\s*(\d+)\b/);
  if (m) return Math.max(1, parseInt(m[1], 10));

  // "2x" or "2 x"
  m = s.match(/\b(\d+)\s*x\b/);
  if (m) return Math.max(1, parseInt(m[1], 10));

  return 1;
}

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
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function normalizeDesc(desc) {
  const d = String(desc || "").trim();
  return d ? d : "Unclassified";
}

function analyzeCSV(records) {
  const TRACK_COL = "Track Number";
  const PART_COL  = "Part Number";
  const DESC_COL  = "PN Description";

  const totalsByTracking = new Map(); // tracking -> parts
  const totalsByDesc = new Map();     // desc -> parts
  const rowsByDesc = new Map();       // desc -> rows counted
  const breakdown = new Map();        // tracking -> (desc -> {parts, rows})

  const validation = new Map(); // reason -> count
  const bump = (k) => validation.set(k, (validation.get(k) || 0) + 1);

  let counted = 0;

  for (const r of records) {
    const tracking = String(r[TRACK_COL] || "").trim();
    const part = String(r[PART_COL] || "").trim();
    const descRaw = String(r[DESC_COL] || "");
    const descLower = descRaw.toLowerCase();

    if (!tracking || !part) { bump("Missing Track/Part"); continue; }

    if (descLower.includes("return label")) { bump("Return Label"); continue; }

    // safety: don't count a row where part == tracking
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

  const skipped = [...validation.values()].reduce((a,b)=>a+b,0);
  const totalParts = [...totalsByTracking.values()].reduce((a,b)=>a+b,0);

  // build arrays for rendering/export
  const trackingArr = [...totalsByTracking.entries()]
    .map(([tracking, parts]) => ({ tracking, parts }))
    .sort((a,b)=>a.tracking.localeCompare(b.tracking));

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

  const validationArr = [...validation.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a,b)=>b.count - a.count);

  return {
    counted, skipped,
    trackings: trackingArr.length,
    totalParts,
    trackingArr, descArr, breakdownArr, validationArr,
    updatedISO: new Date().toISOString()
  };
}

/* ------------------- CSV Dashboard render ------------------- */
function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(txt);
}

function renderCSVSummary(summary) {
  setText("kpi_counted", summary.counted);
  setText("kpi_skipped", summary.skipped);
  setText("kpi_trackings", summary.trackings);
  setText("kpi_parts", summary.totalParts);

  // validation table
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
  const vNote = document.getElementById("validation_note");
  if (vNote) vNote.textContent = `Last run (UTC): ${isoToUTCDisplay(summary.updatedISO)}`;

  // tables
  const tbodyDesc = document.querySelector("#table_desc tbody");
  tbodyDesc.innerHTML = "";
  summary.descArr.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.desc}</td><td>${r.parts}</td><td>${r.rows}</td>`;
    tbodyDesc.appendChild(tr);
  });

  const tbodyTrack = document.querySelector("#table_tracking tbody");
  tbodyTrack.innerHTML = "";
  summary.trackingArr.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.tracking}</td><td>${r.parts}</td>`;
    tbodyTrack.appendChild(tr);
  });

  const tbodyBreak = document.querySelector("#table_breakdown tbody");
  tbodyBreak.innerHTML = "";
  summary.breakdownArr.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.tracking}</td><td>${r.desc}</td><td>${r.parts}</td><td>${r.rows}</td>`;
    tbodyBreak.appendChild(tr);
  });

  // charts: desc pie + bar
  const labels = summary.descArr.map(d => d.desc);
  const values = summary.descArr.map(d => d.parts);

  makeChart("chart_desc_pie", "doughnut", labels, values, "Parts");
  makeChart("chart_desc_bar", "bar", labels, values, "Parts");
}

function downloadCSV(filename, rows) {
  const escapeCell = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map(r => r.map(escapeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ------------------- Manual Counts ------------------- */
function getNum(id) {
  const el = document.getElementById(id);
  const v = Number(el?.value ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}
function setNum(id, n) {
  const el = document.getElementById(id);
  if (el) el.value = String(Number.isFinite(n) ? n : 0);
}
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || ""); }
  catch { return fallback; }
}
function saveJSON(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}

function manualReadInputs() {
  return {
    goodRacks: getNum("m_good_racks"),
    coreRacks: getNum("m_core_racks"),
    goodERacks: getNum("m_good_e_racks"),
    coreERacks: getNum("m_core_e_racks"),
    goodAxles: getNum("m_good_axles"),
    usedAxles: getNum("m_used_axles"),
    goodDS: getNum("m_good_ds"),
    usedDS: getNum("m_used_ds"),
    goodGB: getNum("m_good_gb"),
    usedGB: getNum("m_used_gb"),
  };
}

function safeRatio(a, b) {
  if (b === 0) return "N/A";
  return `${a}:${b} (${Math.round((a/(a+b))*100)}% / ${Math.round((b/(a+b))*100)}%)`;
}

function renderManual() {
  const state = loadJSON(KEYS.MANUAL, null);
  if (!state) return;

  // restore inputs
  setNum("m_good_racks", state.inputs.goodRacks);
  setNum("m_core_racks", state.inputs.coreRacks);
  setNum("m_good_e_racks", state.inputs.goodERacks);
  setNum("m_core_e_racks", state.inputs.coreERacks);
  setNum("m_good_axles", state.inputs.goodAxles);
  setNum("m_used_axles", state.inputs.usedAxles);
  setNum("m_good_ds", state.inputs.goodDS);
  setNum("m_used_ds", state.inputs.usedDS);
  setNum("m_good_gb", state.inputs.goodGB);
  setNum("m_used_gb", state.inputs.usedGB);

  const inputs = state.inputs;

  const totalRacks = inputs.goodRacks + inputs.coreRacks + inputs.goodERacks + inputs.coreERacks;
  const totalAxles = inputs.goodAxles + inputs.usedAxles;
  const totalDS = inputs.goodDS + inputs.usedDS;
  const totalGB = inputs.goodGB + inputs.usedGB;
  const grand = totalRacks + totalAxles + totalDS + totalGB;

  const goodTotal = inputs.goodRacks + inputs.goodERacks + inputs.goodAxles + inputs.goodDS + inputs.goodGB;
  const coreTotal = inputs.coreRacks + inputs.coreERacks; // core only for racks in your list
  const usedTotal = inputs.usedAxles + inputs.usedDS + inputs.usedGB;

  const summary = [
    ["Total Racks", totalRacks],
    ["Total Axles", totalAxles],
    ["Total Drive Shafts", totalDS],
    ["Total Gear boxes", totalGB],
    ["Grand Total", grand],
    ["Good Racks : Core Racks", safeRatio(inputs.goodRacks, inputs.coreRacks)],
    ["Good Electric Racks : Core Electric Racks", safeRatio(inputs.goodERacks, inputs.coreERacks)],
    ["Good Axles : Used Axles", safeRatio(inputs.goodAxles, inputs.usedAxles)],
    ["Good Drive Shafts : Used Drive Shafts", safeRatio(inputs.goodDS, inputs.usedDS)],
    ["Good Gear boxes : Used Gear boxes", safeRatio(inputs.goodGB, inputs.usedGB)],
    ["Saved at (UTC)", isoToUTCDisplay(state.savedAtISO)]
  ];

  const tbody = document.querySelector("#table_manual_summary tbody");
  tbody.innerHTML = "";
  summary.forEach(([k, v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
    tbody.appendChild(tr);
  });

  const savedAt = document.getElementById("manual_saved_at");
  if (savedAt) savedAt.textContent = `Saved timestamp (UTC): ${isoToUTCDisplay(state.savedAtISO)}`;

  // charts
  makeChart("chart_manual_totals", "bar",
    ["Racks","Axles","Drive Shafts","Gear boxes"],
    [totalRacks,totalAxles,totalDS,totalGB],
    "Total");

  makeChart("chart_manual_pie", "doughnut",
    ["Good","Used","Core"],
    [goodTotal, usedTotal, coreTotal],
    "Counts");

  // split bar (stack-ish but simple)
  // We'll render as multiple datasets by creating separate chart instance manually:
  const canvas = document.getElementById("chart_manual_split");
  if (canvas) {
    if (charts["chart_manual_split"]) charts["chart_manual_split"].destroy();
    charts["chart_manual_split"] = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Racks","Axles","Drive Shafts","Gear boxes"],
        datasets: [
          { label: "Good", data: [inputs.goodRacks+inputs.goodERacks, inputs.goodAxles, inputs.goodDS, inputs.goodGB], backgroundColor: "#00bfff" },
          { label: "Used", data: [0, inputs.usedAxles, inputs.usedDS, inputs.usedGB], backgroundColor: "#ffd666" },
          { label: "Core", data: [inputs.coreRacks+inputs.coreERacks, 0, 0, 0], backgroundColor: "#ff7875" }
        ]
      },
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
}

/* ------------------- Carriers ------------------- */
function carrierLoad() { return loadJSON(KEYS.CARRIERS, []); }
function carrierSave(list) { saveJSON(KEYS.CARRIERS, list); }

function renderCarriers() {
  const list = carrierLoad();
  const tbody = document.querySelector("#table_carriers tbody");
  tbody.innerHTML = "";

  // aggregate for chart
  const totals = new Map(); // carrier -> qty
  list.forEach(item => {
    totals.set(item.name, (totals.get(item.name) || 0) + item.qty);
  });

  list.forEach(item => {
    const tr = document.createElement("tr");
    const status = item.completedISO ? "Completed" : "Open";
    tr.innerHTML = `
      <td>${item.name}</td>
      <td>${item.qty}</td>
      <td>${isoToUTCDisplay(item.receivedISO)}</td>
      <td>${isoToUTCDisplay(item.completedISO)}</td>
      <td>${status}</td>
      <td></td>
    `;
    const td = tr.lastElementChild;
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      const next = carrierLoad().filter(x => x.id !== item.id);
      carrierSave(next);
      renderCarriers();
    });
    td.appendChild(del);
    tbody.appendChild(tr);
  });

  const labels = [...totals.keys()].sort((a,b)=>a.localeCompare(b));
  const values = labels.map(k => totals.get(k));
  makeChart("chart_carriers", "bar", labels, values, "Received Qty");
}

/* ------------------- Loose parts ------------------- */
function looseLoad() { return loadJSON(KEYS.LOOSE, []); }
function looseSave(list) { saveJSON(KEYS.LOOSE, list); }

function renderLoose() {
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
      <td>${isoToUTCDisplay(item.dtISO)}</td>
      <td></td>
    `;
    const td = tr.lastElementChild;
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      const next = looseLoad().filter(x => x.id !== item.id);
      looseSave(next);
      renderLoose();
    });
    td.appendChild(del);
    tbody.appendChild(tr);
  });

  setText("loose_total", total);
}

/* ------------------- Export: All (CSV) ------------------- */
function exportAll() {
  const csvSummary = loadJSON(KEYS.CSV_LAST, null);
  const manual = loadJSON(KEYS.MANUAL, null);
  const carriers = carrierLoad();
  const loose = looseLoad();

  const rows = [];
  rows.push(["SECTION","A","B","C","D","E"]);

  // CSV summary
  rows.push(["CSV Summary (UTC run time)", csvSummary?.updatedISO || "", "", "", "", ""]);
  rows.push(["Totals by Description", "Description", "Parts", "Rows", "", ""]);
  (csvSummary?.descArr || []).forEach(r => rows.push(["", r.desc, r.parts, r.rows, "", ""]));

  rows.push(["", "", "", "", "", ""]);
  rows.push(["Totals by Tracking", "Tracking", "Parts", "", "", ""]);
  (csvSummary?.trackingArr || []).forEach(r => rows.push(["", r.tracking, r.parts, "", "", ""]));

  rows.push(["", "", "", "", "", ""]);
  rows.push(["Breakdown by Tracking+Description", "Tracking", "Description", "Parts", "Rows", ""]);
  (csvSummary?.breakdownArr || []).forEach(r => rows.push(["", r.tracking, r.desc, r.parts, r.rows, ""]));

  // Manual
  rows.push(["", "", "", "", "", ""]);
  rows.push(["Manual Counts", "SavedAtISO(UTC)", manual?.savedAtISO || "", "", "", ""]);
  if (manual?.inputs) {
    Object.entries(manual.inputs).forEach(([k,v]) => rows.push(["", k, v, "", "", ""]));
  }

  // Carriers
  rows.push(["", "", "", "", "", ""]);
  rows.push(["Carriers", "Carrier", "Qty", "ReceivedISO", "CompletedISO", ""]);
  carriers.forEach(c => rows.push(["", c.name, c.qty, c.receivedISO || "", c.completedISO || "", ""]));

  // Loose
  rows.push(["", "", "", "", "", ""]);
  rows.push(["Loose Parts", "Part", "Condition", "Qty", "DateISO(UTC)", ""]);
  loose.forEach(l => rows.push(["", l.part, l.cond, l.qty, l.dtISO, ""]));

  downloadCSV("rrpd_all_export.csv", rows);
  statusEl.textContent = "Exported rrpd_all_export.csv";
}

/* ------------------- Wire up UI ------------------- */
async function init() {
  wireTabs();

  // CSV upload
  const csvFile = document.getElementById("csv_file");
  const csvExportBtn = document.getElementById("csv_export_btn");
  const csvClearBtn = document.getElementById("csv_clear_btn");

  csvFile.addEventListener("change", async () => {
    const file = csvFile.files?.[0];
    if (!file) return;
    try {
      statusEl.textContent = "Reading CSV…";
      const text = await file.text();
      const records = parseCSV(text);
      const summary = analyzeCSV(records);

      // store for exports
      saveJSON(KEYS.CSV_LAST, {
        ...summary,
        // keep only what we need for export (arrays are already small-ish)
        // NOTE: if huge CSVs, we still store only aggregates
      });

      renderCSVSummary(summary);

      const nowUTC = isoToUTCDisplay(summary.updatedISO);
      statusEl.textContent = `CSV loaded (UTC): ${nowUTC}`;
      if (updatedSmall) updatedSmall.textContent = `Last updated (UTC): ${nowUTC}`;
    } catch (e) {
      console.error(e);
      statusEl.textContent = "CSV error — check console";
    }
  });

  csvExportBtn.addEventListener("click", () => {
    const summary = loadJSON(KEYS.CSV_LAST, null);
    if (!summary) { statusEl.textContent = "Upload a CSV first"; return; }

    const rows = [];
    rows.push(["RunAtISO(UTC)", summary.updatedISO]);
    rows.push([""]);
    rows.push(["Totals by Description"]);
    rows.push(["Description","Parts","Rows"]);
    (summary.descArr || []).forEach(r => rows.push([r.desc, r.parts, r.rows]));
    rows.push([""]);
    rows.push(["Totals by Tracking"]);
    rows.push(["Tracking","Parts"]);
    (summary.trackingArr || []).forEach(r => rows.push([r.tracking, r.parts]));
    rows.push([""]);
    rows.push(["Breakdown by Tracking+Description"]);
    rows.push(["Tracking","Description","Parts","Rows"]);
    (summary.breakdownArr || []).forEach(r => rows.push([r.tracking, r.desc, r.parts, r.rows]));

    downloadCSV("rrpd_csv_summary.csv", rows);
    statusEl.textContent = "Exported rrpd_csv_summary.csv";
  });

  csvClearBtn.addEventListener("click", () => {
    localStorage.removeItem(KEYS.CSV_LAST);
    statusEl.textContent = "CSV cleared";
    // quick UI reset
    renderCSVSummary({counted:0,skipped:0,trackings:0,totalParts:0,descArr:[],trackingArr:[],breakdownArr:[],validationArr:[],updatedISO:new Date().toISOString()});
  });

  // Manual buttons
  const manualDT = document.getElementById("manual_timestamp");
  const manualNow = document.getElementById("manual_now");
  const manualSave = document.getElementById("manual_save");
  const manualReset = document.getElementById("manual_reset");

  if (manualDT) manualDT.value = toLocalInputValueFromNow();
  manualNow.addEventListener("click", () => manualDT.value = toLocalInputValueFromNow());

  manualSave.addEventListener("click", () => {
    const inputs = manualReadInputs();
    const iso = localInputToISO(manualDT.value) || new Date().toISOString();
    saveJSON(KEYS.MANUAL, { inputs, savedAtISO: iso });
    statusEl.textContent = `Manual saved (UTC): ${isoToUTCDisplay(iso)}`;
    renderManual();
  });

  manualReset.addEventListener("click", () => {
    localStorage.removeItem(KEYS.MANUAL);
    ["m_good_racks","m_core_racks","m_good_e_racks","m_core_e_racks","m_good_axles","m_used_axles","m_good_ds","m_used_ds","m_good_gb","m_used_gb"]
      .forEach(id => setNum(id, 0));
    statusEl.textContent = "Manual reset";
    const tbody = document.querySelector("#table_manual_summary tbody");
    if (tbody) tbody.innerHTML = "";
  });

  // Carrier buttons
  document.getElementById("carrier_received_now").addEventListener("click", () => {
    document.getElementById("carrier_received").value = toLocalInputValueFromNow();
  });
  document.getElementById("carrier_completed_now").addEventListener("click", () => {
    document.getElementById("carrier_completed").value = toLocalInputValueFromNow();
  });

  document.getElementById("carrier_add").addEventListener("click", () => {
    const name = String(document.getElementById("carrier_name").value || "").trim();
    const qty = Math.max(0, Math.floor(Number(document.getElementById("carrier_qty").value || 0)));
    const receivedISO = localInputToISO(document.getElementById("carrier_received").value);
    const completedISO = localInputToISO(document.getElementById("carrier_completed").value);

    if (!name || !Number.isFinite(qty)) { statusEl.textContent = "Carrier name + qty required"; return; }

    const list = carrierLoad();
    list.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(16).slice(2) + Date.now().toString(16))),
      name,
      qty,
      receivedISO: receivedISO || new Date().toISOString(),
      completedISO: completedISO || ""
    });
    carrierSave(list);

    // clear inputs
    document.getElementById("carrier_name").value = "";
    document.getElementById("carrier_qty").value = "";
    document.getElementById("carrier_received").value = "";
    document.getElementById("carrier_completed").value = "";

    statusEl.textContent = "Carrier entry added";
    renderCarriers();
  });

  document.getElementById("carrier_export").addEventListener("click", () => {
    const list = carrierLoad();
    const rows = [["Carrier","Qty","ReceivedISO(UTC)","CompletedISO(UTC)"]];
    list.forEach(c => rows.push([c.name, c.qty, c.receivedISO || "", c.completedISO || ""]));
    downloadCSV("rrpd_carriers.csv", rows);
    statusEl.textContent = "Exported rrpd_carriers.csv";
  });

  document.getElementById("carrier_clear").addEventListener("click", () => {
    localStorage.removeItem(KEYS.CARRIERS);
    statusEl.textContent = "Carriers cleared";
    renderCarriers();
  });

  // Loose parts buttons
  const looseDT = document.getElementById("loose_dt");
  if (looseDT) looseDT.value = toLocalInputValueFromNow();
  document.getElementById("loose_now").addEventListener("click", () => {
    document.getElementById("loose_dt").value = toLocalInputValueFromNow();
  });

  document.getElementById("loose_add").addEventListener("click", () => {
    const part = String(document.getElementById("loose_part").value || "").trim();
    const cond = String(document.getElementById("loose_cond").value || "Good");
    const dtISO = localInputToISO(document.getElementById("loose_dt").value) || new Date().toISOString();
    if (!part) { statusEl.textContent = "Loose part number required"; return; }

    const qty = qtyFromPart(part);
    const list = looseLoad();
    list.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(16).slice(2) + Date.now().toString(16))),
      part, cond, qty, dtISO
    });
    looseSave(list);

    document.getElementById("loose_part").value = "";
    statusEl.textContent = "Loose part added";
    renderLoose();
  });

  document.getElementById("loose_export").addEventListener("click", () => {
    const list = looseLoad();
    const rows = [["Part","Condition","Qty","DateISO(UTC)"]];
    list.forEach(l => rows.push([l.part, l.cond, l.qty, l.dtISO]));
    downloadCSV("rrpd_loose_parts.csv", rows);
    statusEl.textContent = "Exported rrpd_loose_parts.csv";
  });

  document.getElementById("loose_clear").addEventListener("click", () => {
    localStorage.removeItem(KEYS.LOOSE);
    statusEl.textContent = "Loose parts cleared";
    renderLoose();
  });

  // Export all
  document.getElementById("export_all_btn").addEventListener("click", exportAll);

  // initial renders from saved state
  const savedCSV = loadJSON(KEYS.CSV_LAST, null);
  if (savedCSV) renderCSVSummary(savedCSV);
  const savedManual = loadJSON(KEYS.MANUAL, null);
  if (savedManual) renderManual();
  renderCarriers();
  renderLoose();

  const now = isoToUTCDisplay(new Date().toISOString());
  if (updatedSmall) updatedSmall.textContent = `Last updated (UTC): ${now}`;
}

document.addEventListener("DOMContentLoaded", init);
