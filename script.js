// -------------------------
// CONFIG / CONSTANTS
// -------------------------
const TRACKING_CLASSES = new Set(["return label", "packing slip"]); // case-insensitive compare
const MULTIPLIER_CAP = 50;
const LOGS_KEY = "rrpd_logs_v2";
const MANIFEST_KEY = "rrpd_manifest_v2";

// -------------------------
// STATE
// -------------------------
let whRows = [];           // normalized WH CSV rows
let whMeta = { loadedAt: null, rowCount: 0, fileName: "" };

let manifestTrackingSet = new Set(); // tracking numbers extracted from manifest CSV

let charts = {
  carrier: null,
  condition: null
};

// -------------------------
// DOM
// -------------------------
const el = (id) => document.getElementById(id);

const csvStatus = el("csvStatus");
const whFile = el("whFile");
const manifestFile = el("manifestFile");

const saveLogBtn = el("saveLogBtn");
const exportBtn = el("exportBtn");

const exportModal = el("exportModal");
const exportPreview = el("exportPreview");
const confirmExportCheck = el("confirmExportCheck");
const exportPdfBtn = el("exportPdfBtn");
const exportExcelBtn = el("exportExcelBtn");
const cancelExportBtn = el("cancelExportBtn");

const clearManualBtn = el("clearManualBtn");
const clearLogsBtn = el("clearLogsBtn");
const exportLogsBtn = el("exportLogsBtn");

const clearManifestBtn = el("clearManifestBtn");

// KPIs
const kpiFedex = el("kpiFedex");
const kpiUps = el("kpiUps");
const kpiUsps = el("kpiUsps");
const kpiOther = el("kpiOther");
const kpiTotalScans = el("kpiTotalScans");
const kpiUniqueTracking = el("kpiUniqueTracking");
const kpiPartsPieces = el("kpiPartsPieces");
const kpiBoxesMulti = el("kpiBoxesMulti");
const kpiRepeatedTracking = el("kpiRepeatedTracking");

const trackingSamples = el("trackingSamples");
const repeatsTableBody = el("repeatsTable").querySelector("tbody");

const carrierTotalsBody = el("carrierTotalsTable").querySelector("tbody");
const carrierSamples = el("carrierSamples");

const conditionTableBody = el("conditionTable").querySelector("tbody");

// Manifest
const manifestFound = el("manifestFound");
const manifestMissing = el("manifestMissing");
const scannedNotInManifest = el("scannedNotInManifest");
const manifestFedex = el("manifestFedex");
const manifestMissingList = el("manifestMissingList");
const scannedNotInManifestList = el("scannedNotInManifestList");

// Logs
const logsTableBody = el("logsTable").querySelector("tbody");

// Charts
const carrierChartCanvas = el("carrierChart");
const conditionChartCanvas = el("conditionChart");

// -------------------------
// TAB NAV
// -------------------------
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const tab = btn.dataset.tab;
    document.querySelectorAll("main .panel").forEach(p => p.classList.add("hidden"));
    el(`tab-${tab}`).classList.remove("hidden");
  });
});

// -------------------------
// HELPERS
// -------------------------
function safeLower(x){
  return (x ?? "").toString().trim().toLowerCase();
}

function isTrackingClass(classification){
  const c = safeLower(classification);
  return TRACKING_CLASSES.has(c);
}

function normalizeTracking(raw){
  if (!raw) return "";
  // remove spaces and weird chars
  return raw.toString().trim().replace(/\s+/g,"").replace(/[^\w]/g,"");
}

function detectCarrier(trk){
  const t = normalizeTracking(trk);
  if (!t) return "Other";

  // UPS: 1Z + 16 alnum
  if (/^1Z[0-9A-Z]{16}$/i.test(t)) return "UPS";

  // USPS: common long numeric / 420... / 92.. 93.. 94.. 95.. 96.. / 9xxxxxxxx...
  if (/^420\d{8,}$/.test(t)) return "USPS";
  if (/^(92|93|94|95|96)\d{18,}$/.test(t)) return "USPS";
  if (/^9\d{21,27}$/.test(t)) return "USPS";

  // FedEx (your warehouse pattern): 96... (often 22+) OR 797xxxxxxx (12-digit short)
  if (/^96\d{18,}$/.test(t)) return "FedEx";
  if (/^797\d{9}$/.test(t)) return "FedEx";

  return "Other";
}

function findColumn(headers, candidates){
  // headers: array of original keys
  const norm = headers.map(h => safeLower(h));
  for (const cand of candidates){
    const idx = norm.findIndex(h => h.includes(cand));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

function parseMultiplier(partValue){
  // supports: 6833...x2, 6833...X10, 10x, 2X
  const s = (partValue ?? "").toString().trim();
  if (!s) return { base: "", mult: 0 };

  let mult = 1;
  let base = s;

  // xN at end
  let m = s.match(/^(.*?)[xX]\s*(\d+)\s*$/);
  if (m){
    base = m[1].trim();
    mult = parseInt(m[2], 10);
  } else {
    // Nx at end
    m = s.match(/^(.*?)(\d+)\s*[xX]\s*$/);
    if (m){
      base = m[1].trim();
      mult = parseInt(m[2], 10);
    }
  }

  if (!Number.isFinite(mult) || mult < 1) mult = 1;
  if (mult > MULTIPLIER_CAP) mult = MULTIPLIER_CAP;

  return { base, mult };
}

function getManualCounts(){
  return {
    core_racks: Number(el("m_core_racks").value || 0),
    core_electric: Number(el("m_core_electric").value || 0),
    used_axles: Number(el("m_used_axles").value || 0),
    used_driveshafts: Number(el("m_used_driveshafts").value || 0),
    used_gearboxes: Number(el("m_used_gearboxes").value || 0),
    loose_parts: Number(el("m_loose_parts").value || 0),
    notes: (el("m_notes").value || "").trim()
  };
}

function clearManualCounts(){
  ["m_core_racks","m_core_electric","m_used_axles","m_used_driveshafts","m_used_gearboxes","m_loose_parts"].forEach(id => {
    el(id).value = 0;
  });
  el("m_notes").value = "";
}

// -------------------------
// WH CSV LOAD
// -------------------------
whFile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (res) => {
      const raw = res.data || [];
      whMeta = {
        loadedAt: new Date(),
        rowCount: raw.length,
        fileName: file.name
      };

      // Normalize columns we care about (robust header matching)
      const headers = res.meta?.fields || Object.keys(raw[0] || {});
      const trackingCol = findColumn(headers, ["tracking", "label", "ship", "return"]);
      const classCol = findColumn(headers, ["class", "type", "category"]);
      const partCol = findColumn(headers, ["part", "pn", "sku"]);
      const conditionCol = findColumn(headers, ["condition", "status"]);

      whRows = raw.map(r => {
        const tracking = normalizeTracking(r[trackingCol] ?? r["Tracking"] ?? r["tracking"] ?? "");
        const classification = (r[classCol] ?? r["Classification"] ?? r["classification"] ?? "").toString().trim();
        const part = (r[partCol] ?? r["Part"] ?? r["part"] ?? "").toString().trim();
        const condition = (r[conditionCol] ?? r["Condition"] ?? r["condition"] ?? r["Status"] ?? "").toString().trim();

        return {
          tracking,
          classification,
          part,
          condition,
          _raw: r
        };
      });

      csvStatus.textContent = `WH CSV loaded • ${whMeta.rowCount} rows • ${whMeta.loadedAt.toLocaleString()}`;
      saveLogBtn.disabled = false;
      exportBtn.disabled = false;

      computeAndRenderAll();
      computeAndRenderManifest(); // if manifest already loaded
    }
  });

  // reset input so same file can be re-uploaded
  whFile.value = "";
});

// -------------------------
// COMPUTE (CORE LOGIC)
// -------------------------
function computeStats(){
  // total scans = total rows that have ANY meaningful value
  const totalScans = whRows.filter(r => r.tracking || r.part || r.classification).length;

  // tracking rows = ONLY Return Label / Packing Slip
  const trackingRows = whRows.filter(r => isTrackingClass(r.classification) && r.tracking);

  // parts rows = ANY other classification (NOT return label/packing slip)
  const partRows = whRows.filter(r => !isTrackingClass(r.classification) && (r.part || r.tracking));

  // Carrier counts (TRACKING rows only)
  const carrierCounts = { FedEx:0, UPS:0, USPS:0, Other:0 };
  const trackingFreq = new Map();
  const trackingCarrier = new Map();

  for (const r of trackingRows){
    const c = detectCarrier(r.tracking);
    carrierCounts[c] = (carrierCounts[c] || 0) + 1;

    trackingFreq.set(r.tracking, (trackingFreq.get(r.tracking) || 0) + 1);
    if (!trackingCarrier.has(r.tracking)) trackingCarrier.set(r.tracking, c);
  }

  const uniqueTracking = trackingFreq.size;

  // "Repeated tracking numbers" = count of IDs appearing > 1 (NOT row count)
  const repeatedIDs = [...trackingFreq.entries()].filter(([,n]) => n > 1);
  const repeatedTracking = repeatedIDs.length;

  const repeatedTop = repeatedIDs
    .sort((a,b) => b[1]-a[1])
    .slice(0, 15)
    .map(([trk,n]) => ({ tracking: trk, scans: n, carrier: trackingCarrier.get(trk) || detectCarrier(trk) }));

  // Parts pieces count
  // Rule: parts are ANY classification other than Return Label / Packing Slip.
  // Count pieces using xN or Nx multiplier (cap 50).
  let partsPieces = 0;

  // also track per "box" (tracking id) how many part pieces belong to it
  const piecesByBox = new Map(); // key: tracking id (if present), value: pieces
  for (const r of partRows){
    const val = r.part || ""; // multiplier must come from part field
    const { mult } = parseMultiplier(val);
    const add = mult || 1;
    partsPieces += add;

    const boxKey = r.tracking || "(no tracking)";
    piecesByBox.set(boxKey, (piecesByBox.get(boxKey) || 0) + add);
  }

  const boxesWithMultipleParts = [...piecesByBox.values()].filter(n => n > 1).length;

  // Samples
  const samples = trackingRows.slice(-25).reverse().map(r => ({
    carrier: detectCarrier(r.tracking),
    tracking: r.tracking
  }));

  // Conditions (if available)
  const condCounts = new Map();
  for (const r of whRows){
    const cond = (r.condition || "Unclassified").trim() || "Unclassified";
    condCounts.set(cond, (condCounts.get(cond) || 0) + 1);
  }
  const condSorted = [...condCounts.entries()].sort((a,b)=>b[1]-a[1]);

  return {
    totalScans,
    trackingRows,
    partRows,
    carrierCounts,
    uniqueTracking,
    repeatedTracking,
    repeatedTop,
    partsPieces,
    boxesWithMultipleParts,
    samples,
    trackingFreq,
    condSorted
  };
}

// -------------------------
// RENDER
// -------------------------
function computeAndRenderAll(){
  const s = computeStats();

  // KPIs
  kpiFedex.textContent = s.carrierCounts.FedEx || 0;
  kpiUps.textContent = s.carrierCounts.UPS || 0;
  kpiUsps.textContent = s.carrierCounts.USPS || 0;
  kpiOther.textContent = s.carrierCounts.Other || 0;

  kpiTotalScans.textContent = s.totalScans;
  kpiUniqueTracking.textContent = s.uniqueTracking;
  kpiPartsPieces.textContent = s.partsPieces;
  kpiBoxesMulti.textContent = s.boxesWithMultipleParts;
  kpiRepeatedTracking.textContent = s.repeatedTracking;

  // Tracking samples
  trackingSamples.innerHTML = "";
  for (const item of s.samples){
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = `${item.carrier} • ${item.tracking}`;
    trackingSamples.appendChild(div);
  }

  // Repeats table
  repeatsTableBody.innerHTML = "";
  for (const r of s.repeatedTop){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.tracking}</td>
      <td class="num">${r.scans}</td>
      <td>${r.carrier}</td>
    `;
    repeatsTableBody.appendChild(tr);
  }

  // Carrier chart
  renderCarrierChart(s.carrierCounts);

  // Carrier tab tables
  renderCarrierTab(s);

  // Condition chart/table
  renderConditionTab(s.condSorted);

  // Logs
  renderLogs();

  // Manifest compare if loaded
  computeAndRenderManifest();
}

function renderCarrierChart(counts){
  const labels = ["FedEx","UPS","USPS","Other"];
  const data = labels.map(l => counts[l] || 0);

  if (charts.carrier) charts.carrier.destroy();
  charts.carrier = new Chart(carrierChartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Total Scans",
        data
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

function renderCarrierTab(stats){
  carrierTotalsBody.innerHTML = "";

  const carriers = ["FedEx","UPS","USPS","Other"];
  for (const c of carriers){
    const trackingRowsCount = stats.carrierCounts[c] || 0;
    const unique = [...stats.trackingFreq.entries()].filter(([trk]) => detectCarrier(trk) === c).length;

    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${c}</td><td class="num">${trackingRowsCount}</td><td class="num">${unique}</td>`;
    carrierTotalsBody.appendChild(tr);
  }

  // samples
  carrierSamples.innerHTML = "";
  const sampleTrackings = [...stats.trackingFreq.keys()].slice(0, 40);
  for (const trk of sampleTrackings){
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = `${detectCarrier(trk)} • ${trk}`;
    carrierSamples.appendChild(div);
  }
}

function renderConditionTab(condSorted){
  // table
  conditionTableBody.innerHTML = "";
  for (const [cond,count] of condSorted.slice(0, 30)){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${cond}</td><td class="num">${count}</td>`;
    conditionTableBody.appendChild(tr);
  }

  // chart
  const labels = condSorted.slice(0, 8).map(x => x[0]);
  const data = condSorted.slice(0, 8).map(x => x[1]);

  if (charts.condition) charts.condition.destroy();
  charts.condition = new Chart(conditionChartCanvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data }]
    },
    options: { responsive:true, plugins:{ legend:{ position:"bottom" } } }
  });
}

// -------------------------
// MANIFEST
// -------------------------
manifestFile.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (res) => {
      const rows = res.data || [];
      const fields = res.meta?.fields || Object.keys(rows[0] || {});
      const asText = (obj) => fields.map(f => (obj[f] ?? "")).join(" ");

      const found = new Set();
      for (const r of rows){
        const blob = asText(r);
        // extract UPS / long numeric / 797... / 96...
        const matches = blob.match(/1Z[0-9A-Z]{16}|(?:420\d{8,})|(?:9\d{21,27})|(?:7\d{11})|(?:96\d{18,})|(?:79\d{10,})/gi) || [];
        for (const m of matches){
          const trk = normalizeTracking(m);
          if (trk) found.add(trk);
        }
      }

      manifestTrackingSet = found;
      localStorage.setItem(MANIFEST_KEY, JSON.stringify([...manifestTrackingSet]));
      computeAndRenderManifest();
    }
  });

  manifestFile.value = "";
});

clearManifestBtn.addEventListener("click", () => {
  manifestTrackingSet = new Set();
  localStorage.removeItem(MANIFEST_KEY);
  computeAndRenderManifest();
});

function loadManifestFromStorage(){
  try{
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    manifestTrackingSet = new Set(arr || []);
  }catch(_){}
}

function computeAndRenderManifest(){
  loadManifestFromStorage();

  const stats = computeStats();
  const scannedSet = new Set(stats.trackingRows.map(r => r.tracking)); // only tracking rows

  const manifestArr = [...manifestTrackingSet];
  const scannedArr = [...scannedSet];

  const inManifestNotScanned = manifestArr.filter(t => !scannedSet.has(t));
  const scannedNotInMan = scannedArr.filter(t => !manifestTrackingSet.has(t));

  manifestFound.textContent = manifestArr.length;
  manifestMissing.textContent = inManifestNotScanned.length;
  scannedNotInManifest.textContent = scannedNotInMan.length;

  const fedexCount = manifestArr.filter(t => detectCarrier(t) === "FedEx").length;
  manifestFedex.textContent = fedexCount;

  manifestMissingList.innerHTML = "";
  inManifestNotScanned.slice(0,50).forEach(t => {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = `${detectCarrier(t)} • ${t}`;
    manifestMissingList.appendChild(div);
  });

  scannedNotInManifestList.innerHTML = "";
  scannedNotInMan.slice(0,50).forEach(t => {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = `${detectCarrier(t)} • ${t}`;
    scannedNotInManifestList.appendChild(div);
  });
}

// -------------------------
// LOGS (localStorage)
// -------------------------
function readLogs(){
  try{
    const raw = localStorage.getItem(LOGS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(_){
    return [];
  }
}

function writeLogs(arr){
  localStorage.setItem(LOGS_KEY, JSON.stringify(arr));
}

function renderLogs(){
  const logs = readLogs();
  logsTableBody.innerHTML = "";

  for (const L of logs.slice().reverse()){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(L.savedAt).toLocaleString()}</td>
      <td class="num">${L.totalScans}</td>
      <td class="num">${L.fedex}</td>
      <td class="num">${L.ups}</td>
      <td class="num">${L.usps}</td>
      <td class="num">${L.other}</td>
      <td class="num">${L.uniqueTracking}</td>
      <td class="num">${L.partsPieces}</td>
      <td class="num">${L.boxesMulti}</td>
      <td class="num">${L.repeatedIds}</td>
    `;
    logsTableBody.appendChild(tr);
  }
}

saveLogBtn.addEventListener("click", () => {
  const s = computeStats();
  const logs = readLogs();

  logs.push({
    savedAt: new Date().toISOString(),
    fileName: whMeta.fileName,
    totalScans: s.totalScans,
    fedex: s.carrierCounts.FedEx || 0,
    ups: s.carrierCounts.UPS || 0,
    usps: s.carrierCounts.USPS || 0,
    other: s.carrierCounts.Other || 0,
    uniqueTracking: s.uniqueTracking,
    partsPieces: s.partsPieces,
    boxesMulti: s.boxesWithMultipleParts,
    repeatedIds: s.repeatedTracking,
    manual: getManualCounts()
  });

  writeLogs(logs);
  renderLogs();
});

clearLogsBtn.addEventListener("click", () => {
  if (!confirm("Clear ALL logs from this device/browser?")) return;
  localStorage.removeItem(LOGS_KEY);
  renderLogs();
});

exportLogsBtn.addEventListener("click", () => {
  const logs = readLogs();
  if (!logs.length){
    alert("No logs to export yet.");
    return;
  }
  const header = Object.keys(logs[0]).join(",");
  const rows = logs.map(x => JSON.stringify(x)).join("\n");
  const blob = new Blob([header + "\n" + rows], { type: "text/csv;charset=utf-8" });
  saveAs(blob, `RRPD_LOGS_${new Date().toISOString().slice(0,10)}.csv`);
});

// -------------------------
// EXPORT (preview + confirm)
// -------------------------
exportBtn.addEventListener("click", () => openExportModal());
cancelExportBtn.addEventListener("click", () => closeExportModal());

confirmExportCheck.addEventListener("change", () => {
  const ok = confirmExportCheck.checked;
  exportPdfBtn.disabled = !ok;
  exportExcelBtn.disabled = !ok;
});

function snapshotText(){
  const s = computeStats();
  const manual = getManualCounts();

  const date = new Date();
  return [
    `Date: ${date.toISOString().slice(0,10)}`,
    `Computed: ${date.toLocaleString()}`,
    ``,
    `Tracking Summary (Total Scans)`,
    `  FedEx: ${s.carrierCounts.FedEx || 0}`,
    `  UPS:   ${s.carrierCounts.UPS || 0}`,
    `  USPS:  ${s.carrierCounts.USPS || 0}`,
    `  Other: ${s.carrierCounts.Other || 0}`,
    `  Total Scans: ${s.totalScans}`,
    `  Unique Tracking Numbers: ${s.uniqueTracking}`,
    `  Repeated Tracking IDs: ${s.repeatedTracking}`,
    ``,
    `Parts Summary`,
    `  Total Parts (Pieces): ${s.partsPieces}`,
    `  Boxes With Multiple Parts: ${s.boxesWithMultipleParts}`,
    ``,
    `Manual Counts`,
    `  Core Racks: ${manual.core_racks}`,
    `  Core Electric Racks: ${manual.core_electric}`,
    `  Used Axles: ${manual.used_axles}`,
    `  Used Drive Shafts: ${manual.used_driveshafts}`,
    `  Used Gear boxes: ${manual.used_gearboxes}`,
    `  Loose Parts Count: ${manual.loose_parts}`,
    manual.notes ? `  Notes: ${manual.notes}` : ``
  ].join("\n");
}

function openExportModal(){
  confirmExportCheck.checked = false;
  exportPdfBtn.disabled = true;
  exportExcelBtn.disabled = true;

  exportPreview.textContent = snapshotText();
  exportModal.classList.remove("hidden");
}

function closeExportModal(){
  exportModal.classList.add("hidden");
}

exportPdfBtn.addEventListener("click", async () => {
  await exportPDF();
  closeExportModal();
});

exportExcelBtn.addEventListener("click", async () => {
  await exportExcel();
  closeExportModal();
});

// -------------------------
// PDF EXPORT (dark header + table)
// -------------------------
async function exportPDF(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"letter" });
  const s = computeStats();
  const manual = getManualCounts();
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);

  // header bar
  doc.setFillColor(11,42,102);
  doc.rect(0,0,612,72,"F");

  doc.setTextColor(255,255,255);
  doc.setFontSize(16);
  doc.text("RRPD Summary", 90, 36);

  doc.setFontSize(10);
  doc.text(`Date: ${dateStr}`, 90, 54);

  // logo (best effort)
  try{
    const imgData = await loadImageAsDataURL("detroit-axle-logo.png");
    doc.addImage(imgData, "PNG", 18, 14, 52, 44);
  }catch(_){}

  doc.setTextColor(20,30,45);

  // tables
  const rows1 = [
    ["FedEx", s.carrierCounts.FedEx || 0],
    ["UPS", s.carrierCounts.UPS || 0],
    ["USPS", s.carrierCounts.USPS || 0],
    ["Other", s.carrierCounts.Other || 0],
    ["Total Scans", s.totalScans],
    ["Unique Tracking Numbers", s.uniqueTracking],
    ["Repeated Tracking IDs", s.repeatedTracking],
    ["Total Parts (Pieces)", s.partsPieces],
    ["Boxes With Multiple Parts", s.boxesWithMultipleParts]
  ];

  doc.autoTable({
    startY: 92,
    head: [["Metric","Value"]],
    body: rows1,
    theme: "grid"
  });

  const y2 = doc.lastAutoTable.finalY + 16;

  const rows2 = [
    ["Core Racks", manual.core_racks],
    ["Core Electric Racks", manual.core_electric],
    ["Used Axles", manual.used_axles],
    ["Used Drive Shafts", manual.used_driveshafts],
    ["Used Gear boxes", manual.used_gearboxes],
    ["Loose Parts Count", manual.loose_parts],
    ["Notes", manual.notes || ""]
  ];

  doc.autoTable({
    startY: y2,
    head: [["Manual Counts","Value"]],
    body: rows2,
    theme: "grid"
  });

  doc.save(`RRPD_Summary_${dateStr}.pdf`);
}

function loadImageAsDataURL(url){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = ()=>{
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img,0,0);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// -------------------------
// EXCEL EXPORT (dark header + logo + counts)
// -------------------------
async function exportExcel(){
  const wb = new ExcelJS.Workbook();
  wb.creator = "RRPD Dashboard";

  const ws = wb.addWorksheet("RRPD Summary");
  const s = computeStats();
  const manual = getManualCounts();
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);

  // column widths
  ws.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 18 }
  ];

  // style: dark blue header row area
  ws.mergeCells("A1:B1");
  ws.getCell("A1").value = `RRPD Summary — ${dateStr}`;
  ws.getCell("A1").font = { bold:true, size:16, color:{ argb:"FFFFFFFF" } };
  ws.getCell("A1").fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B2A66" } };
  ws.getRow(1).height = 26;

  // logo
  try{
    const res = await fetch("detroit-axle-logo.png");
    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const imageId = wb.addImage({ buffer: arrayBuffer, extension: "png" });
    ws.addImage(imageId, { tl:{ col:2.6, row:0.1 }, ext:{ width:70, height:55 } });
  }catch(_){}

  // metrics
  const data = [
    ["FedEx", s.carrierCounts.FedEx || 0],
    ["UPS", s.carrierCounts.UPS || 0],
    ["USPS", s.carrierCounts.USPS || 0],
    ["Other", s.carrierCounts.Other || 0],
    ["Total Scans", s.totalScans],
    ["Unique Tracking Numbers", s.uniqueTracking],
    ["Repeated Tracking IDs", s.repeatedTracking],
    ["Total Parts (Pieces)", s.partsPieces],
    ["Boxes With Multiple Parts", s.boxesWithMultipleParts],
    ["", ""],
    ["Manual: Core Racks", manual.core_racks],
    ["Manual: Core Electric Racks", manual.core_electric],
    ["Manual: Used Axles", manual.used_axles],
    ["Manual: Used Drive Shafts", manual.used_driveshafts],
    ["Manual: Used Gear boxes", manual.used_gearboxes],
    ["Manual: Loose Parts Count", manual.loose_parts],
    ["Manual: Notes", manual.notes || ""]
  ];

  let startRow = 3;
  for (const [metric,value] of data){
    ws.getCell(`A${startRow}`).value = metric;
    ws.getCell(`B${startRow}`).value = value;
    startRow++;
  }

  // table-like formatting
  for (let r=3; r<startRow; r++){
    ws.getRow(r).height = 18;
    ws.getCell(`A${r}`).font = { bold: true, color:{ argb:"FFE8F0FF" } };
    ws.getCell(`B${r}`).font = { color:{ argb:"FFE8F0FF" } };
    ws.getCell(`A${r}`).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0F223F" } };
    ws.getCell(`B${r}`).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0F223F" } };
    ws.getCell(`A${r}`).border = ws.getCell(`B${r}`).border = {
      top:{style:"thin", color:{argb:"FF1A2B4E"}},
      left:{style:"thin", color:{argb:"FF1A2B4E"}},
      bottom:{style:"thin", color:{argb:"FF1A2B4E"}},
      right:{style:"thin", color:{argb:"FF1A2B4E"}}
    };
  }

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf]), `RRPD_Summary_${dateStr}.xlsx`);
}

// -------------------------
// MANUAL BUTTONS
// -------------------------
clearManualBtn.addEventListener("click", () => {
  clearManualCounts();
});

// -------------------------
// INIT
// -------------------------
(function init(){
  renderLogs();
  loadManifestFromStorage();
  computeAndRenderManifest(); // shows stored manifest even before WH csv
})();
