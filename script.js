/* RRPD Receiving Dashboard
   Core rules:
   - Tracking rows = classification is Return Label or Packing Slip
   - Part rows = everything else
   - Part pieces use multiplier parsing x2 / 2x etc, cap 50
   - Carrier from tracking format:
     UPS: 1Z...
     USPS: 94/93/92/95... or 420...
     FedEx: 96... or 797...
     Other: everything else
*/

const LS_KEYS = {
  manual: "rrpd_manual_v1",
  carriers: "rrpd_carrier_log_v1",
  loose: "rrpd_loose_parts_v1",
  logs: "rrpd_logs_v1",
};

let whRows = [];
let whMeta = { loadedAt: null, filename: null };

let manifestRows = [];
let charts = {};

const $ = (id) => document.getElementById(id);

function nowIso(){
  return new Date().toISOString();
}

function fmtInt(n){
  return (n ?? 0).toLocaleString("en-US");
}

function safeStr(v){
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normalizeHeader(h){
  return safeStr(h).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g,"");
}

function isTrackingClassification(cls){
  const s = safeStr(cls).toLowerCase();
  return s.includes("return label") || s.includes("packing slip");
}

function parseMultiplier(text){
  const s = safeStr(text);
  if (!s) return 1;

  // match "...x10" or "... x10"
  let m = s.match(/(?:^|[^0-9])x\s*(\d{1,3})(?:$|[^0-9])/i);
  // match "10x..." or "10x ..."
  let m2 = s.match(/(?:^|[^0-9])(\d{1,3})\s*x(?:$|[^0-9])/i);

  let mult = 1;
  if (m && m[1]) mult = parseInt(m[1], 10);
  else if (m2 && m2[1]) mult = parseInt(m2[1], 10);

  if (!Number.isFinite(mult) || mult < 1) mult = 1;
  if (mult > 50) mult = 50;
  return mult;
}

function looksLikeUps(t){ return /^1Z/i.test(t); }
function looksLikeFedex(t){ return /^96/.test(t) || /^797/.test(t); }
function looksLikeUsps(t){ return /^(94|93|92|95)/.test(t) || /^420/.test(t); }

function classifyCarrier(tracking){
  const t = safeStr(tracking).replace(/\s+/g,"");
  if (!t) return "Other";
  if (looksLikeUps(t)) return "UPS";
  if (looksLikeUsps(t)) return "USPS";
  if (looksLikeFedex(t)) return "FedEx";
  return "Other";
}

/* Attempt to undo scientific notation strings like "1.96367E+11".
   IMPORTANT: If the source CSV truly contains scientific notation, digits may already be lost.
   This at least turns it into a stable integer string when possible.
*/
function sciToIntString(s){
  const t = safeStr(s);
  if (!/e\+?/i.test(t)) return t;

  const m = t.match(/^([0-9]+)(?:\.([0-9]+))?e\+?([0-9]+)$/i);
  if (!m) return t;

  const intPart = m[1];
  const fracPart = m[2] || "";
  const exp = parseInt(m[3], 10);

  const digits = intPart + fracPart;
  const fracLen = fracPart.length;

  // shift decimal right by exp
  const zeros = exp - fracLen;
  if (zeros >= 0){
    return digits + "0".repeat(zeros);
  }
  // need to insert decimal (we don't want decimals for IDs, so fallback)
  return digits.slice(0, digits.length + zeros);
}

function detectColumns(rows){
  // returns object with best-guess keys for:
  // tracking, classification, partNumber, condition
  if (!rows.length) return {};

  const keys = Object.keys(rows[0]);
  const norm = keys.map(k => ({ raw:k, n: normalizeHeader(k) }));

  const find = (preds) => {
    for (const p of preds){
      const hit = norm.find(x => p.test(x.n));
      if (hit) return hit.raw;
    }
    return null;
  };

  const tracking =
    find([/tracking/,/tracking_number/,/trackingid/,/tracking_id/,/tn/]) ||
    keys[0];

  const classification =
    find([/pn_description/,/description/,/classification/,/class/]) ||
    null;

  const partNumber =
    find([/part_number/,/^part$/,/^pn$/,/partnumber/]) ||
    null;

  const condition =
    find([/^status$/,/condition/,/return_condition/]) ||
    null;

  return { tracking, classification, partNumber, condition };
}

function buildModel(rows){
  const cols = detectColumns(rows);

  // normalize each row into a consistent shape
  const norm = rows.map(r => {
    const trackingRaw = sciToIntString(safeStr(r[cols.tracking]));
    const classification = safeStr(cols.classification ? r[cols.classification] : "");
    const partNumber = safeStr(cols.partNumber ? r[cols.partNumber] : "");
    const condition = safeStr(cols.condition ? r[cols.condition] : "");

    const isTrackingRow = isTrackingClassification(classification);

    return {
      tracking: trackingRaw,
      carrier: classifyCarrier(trackingRaw),
      classification,
      isTrackingRow,
      isPartRow: !isTrackingRow,
      partNumber,
      condition: condition || (isTrackingRow ? "" : "Unclassified"),
      multiplier: !isTrackingRow ? parseMultiplier(partNumber || classification) : 0,
    };
  });

  return { cols, rows: norm };
}

function aggregate(model){
  const all = model.rows;

  const totalScans = all.length;

  // Only tracking rows count toward tracking/carrier scan counters
  const trackingRows = all.filter(r => r.isTrackingRow && r.tracking);
  const uniqueTracking = new Set(trackingRows.map(r => r.tracking));

  const carrierCounts = { FedEx:0, UPS:0, USPS:0, Other:0 };
  for (const r of trackingRows){
    carrierCounts[r.carrier] = (carrierCounts[r.carrier] || 0) + 1;
  }

  // PARTS (pieces) = sum multipliers for PART rows, grouped by tracking box
  const partRows = all.filter(r => r.isPartRow && r.tracking);

  const partsByTracking = new Map(); // tracking -> { pieces, carrier }
  for (const r of partRows){
    const key = r.tracking;
    const cur = partsByTracking.get(key) || { pieces:0, carrier: classifyCarrier(key) };
    const add = r.multiplier || 1;
    cur.pieces += add;
    partsByTracking.set(key, cur);
  }

  const totalParts = Array.from(partsByTracking.values()).reduce((a,b)=>a+b.pieces,0);

  const boxesWithMultipleParts = Array.from(partsByTracking.values()).filter(x=>x.pieces>1).length;

  // Conditions (for PART rows only)
  const condTotals = new Map(); // condition -> pieces
  for (const r of partRows){
    const c = r.condition || "Unclassified";
    const add = r.multiplier || 1;
    condTotals.set(c, (condTotals.get(c)||0) + add);
  }

  // Latest samples (tracking rows first; if none, use any)
  const samples = trackingRows.slice(-25).reverse();

  // Top boxes by part count
  const topBoxes = Array.from(partsByTracking.entries())
    .map(([tracking, v]) => ({ tracking, pieces: v.pieces, carrier: v.carrier }))
    .sort((a,b)=>b.pieces - a.pieces)
    .slice(0, 25);

  return {
    totalScans,
    trackingRowsCount: trackingRows.length,
    uniqueTrackingCount: uniqueTracking.size,
    carrierCounts,
    totalParts,
    boxesWithMultipleParts,
    condTotals,
    samples,
    topBoxes
  };
}

function destroyChart(id){
  if (charts[id]){
    charts[id].destroy();
    charts[id] = null;
  }
}

function renderDashboard(agg){
  $("kpiFedex").textContent = fmtInt(agg.carrierCounts.FedEx);
  $("kpiUps").textContent = fmtInt(agg.carrierCounts.UPS);
  $("kpiUsps").textContent = fmtInt(agg.carrierCounts.USPS);
  $("kpiOther").textContent = fmtInt(agg.carrierCounts.Other);
  $("kpiTotalScans").textContent = fmtInt(agg.totalScans);

  $("kpiUniqueTracking").textContent = fmtInt(agg.uniqueTrackingCount);
  $("kpiTotalParts").textContent = fmtInt(agg.totalParts);
  $("kpiMultiBoxes").textContent = fmtInt(agg.boxesWithMultipleParts);

  // samples
  const sWrap = $("trackingSamples");
  sWrap.innerHTML = "";
  for (const r of agg.samples){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<span><span class="tag">${r.carrier}</span> • ${r.tracking}</span>`;
    sWrap.appendChild(div);
  }

  // top boxes
  const tb = $("topBoxesTable").querySelector("tbody");
  tb.innerHTML = "";
  for (const b of agg.topBoxes){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family:ui-monospace,monospace;font-size:12px">${b.tracking}</td>
      <td><b>${fmtInt(b.pieces)}</b></td>
      <td>${b.carrier}</td>
    `;
    tb.appendChild(tr);
  }

  // carrier bar
  destroyChart("carrierBar");
  charts["carrierBar"] = new Chart($("carrierBar"),{
    type:"bar",
    data:{
      labels:["FedEx","UPS","USPS","Other"],
      datasets:[{
        label:"Total Scans",
        data:[agg.carrierCounts.FedEx, agg.carrierCounts.UPS, agg.carrierCounts.USPS, agg.carrierCounts.Other]
      }]
    },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:"#eaf2ff" } } },
      scales:{
        x:{ ticks:{ color:"#eaf2ff" }, grid:{ color:"rgba(255,255,255,.08)" } },
        y:{ ticks:{ color:"#eaf2ff" }, grid:{ color:"rgba(255,255,255,.08)" } },
      }
    }
  });

  // carriers tab bar (same dataset)
  destroyChart("carrierBar2");
  charts["carrierBar2"] = new Chart($("carrierBar2"),{
    type:"bar",
    data:{
      labels:["FedEx","UPS","USPS","Other"],
      datasets:[{
        label:"Total Scans",
        data:[agg.carrierCounts.FedEx, agg.carrierCounts.UPS, agg.carrierCounts.USPS, agg.carrierCounts.Other]
      }]
    },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:"#eaf2ff" } } },
      scales:{
        x:{ ticks:{ color:"#eaf2ff" }, grid:{ color:"rgba(255,255,255,.08)" } },
        y:{ ticks:{ color:"#eaf2ff" }, grid:{ color:"rgba(255,255,255,.08)" } },
      }
    }
  });
}

function renderReturns(agg){
  const rows = Array.from(agg.condTotals.entries())
    .map(([k,v])=>({k,v}))
    .sort((a,b)=>b.v-a.v);

  // table
  const tb = $("returnsTable").querySelector("tbody");
  tb.innerHTML = "";
  for (const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.k}</td><td><b>${fmtInt(r.v)}</b></td>`;
    tb.appendChild(tr);
  }

  // donut
  destroyChart("returnsDonut");
  charts["returnsDonut"] = new Chart($("returnsDonut"),{
    type:"doughnut",
    data:{
      labels: rows.map(r=>r.k),
      datasets:[{ data: rows.map(r=>r.v) }]
    },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:"#eaf2ff" } } }
    }
  });
}

/* MANUAL COUNTS */
function getManual(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.manual) || "{}"); }
  catch{ return {}; }
}

function setManual(obj){
  localStorage.setItem(LS_KEYS.manual, JSON.stringify(obj));
}

function manualReadInputs(){
  const ids = [
    "m_good_racks","m_core_racks","m_good_eracks","m_core_eracks",
    "m_good_axles","m_used_axles","m_good_ds","m_used_ds",
    "m_good_gb","m_used_gb",
  ];
  const out = {};
  for (const id of ids){
    out[id] = parseInt($(id).value || "0", 10) || 0;
  }
  return out;
}

function manualWriteInputs(m){
  const ids = Object.keys(m);
  for (const id of ids){
    if ($(id)) $(id).value = m[id];
  }
}

function computeRatios(m){
  const ratio = (a,b) => b>0 ? (a/b) : null;

  const rows = [
    { label:"Good : Core Racks", val: ratio(m.m_good_racks, m.m_core_racks) },
    { label:"Good : Core Electric Racks", val: ratio(m.m_good_eracks, m.m_core_eracks) },
    { label:"Good : Used Axles", val: ratio(m.m_good_axles, m.m_used_axles) },
    { label:"Good : Used Drive Shafts", val: ratio(m.m_good_ds, m.m_used_ds) },
    { label:"Good : Used Gear boxes", val: ratio(m.m_good_gb, m.m_used_gb) },
  ];

  return rows.map(r=>({
    label:r.label,
    value: r.val === null ? "—" : r.val.toFixed(2)
  }));
}

function renderManual(){
  const m = getManual();
  manualWriteInputs(m);

  const totals = {
    racks: (m.m_good_racks||0)+(m.m_core_racks||0)+(m.m_good_eracks||0)+(m.m_core_eracks||0),
    axles: (m.m_good_axles||0)+(m.m_used_axles||0),
    ds: (m.m_good_ds||0)+(m.m_used_ds||0),
    gb: (m.m_good_gb||0)+(m.m_used_gb||0),
  };
  $("manualTotalRacks").textContent = fmtInt(totals.racks);
  $("manualTotalAxles").textContent = fmtInt(totals.axles);
  $("manualTotalDS").textContent = fmtInt(totals.ds);
  $("manualTotalGB").textContent = fmtInt(totals.gb);

  const ratioRows = computeRatios(m);
  const tb = $("ratioTable").querySelector("tbody");
  tb.innerHTML = "";
  for (const r of ratioRows){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.label}</td><td><b>${r.value}</b></td>`;
    tb.appendChild(tr);
  }
}

$("saveManualBtn").addEventListener("click", ()=>{
  const m = manualReadInputs();
  setManual(m);
  $("manualSavedMsg").textContent = `Saved manual: ${new Date().toLocaleString()}`;
  renderManual();
});

/* CARRIER LOG (manual) */
function getCarrierLog(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.carriers) || "[]"); }
  catch{ return []; }
}
function setCarrierLog(arr){
  localStorage.setItem(LS_KEYS.carriers, JSON.stringify(arr));
}

function renderCarrierLog(){
  const arr = getCarrierLog();
  const tb = $("carrierLogTable").querySelector("tbody");
  tb.innerHTML = "";
  for (const item of arr){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.date || ""}</td>
      <td>${item.carrier}</td>
      <td><b>${fmtInt(item.qty)}</b></td>
      <td>${item.completed ? "Completed" : "Open"}</td>
      <td>
        <button class="btn secondary" data-act="toggle" data-id="${item.id}">${item.completed ? "Reopen" : "Complete"}</button>
        <button class="btn secondary" data-act="del" data-id="${item.id}">Delete</button>
      </td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      let arr = getCarrierLog();
      if (act === "del"){
        arr = arr.filter(x=>x.id !== id);
      } else if (act === "toggle"){
        arr = arr.map(x=> x.id===id ? {...x, completed: !x.completed} : x);
      }
      setCarrierLog(arr);
      renderCarrierLog();
    });
  });
}

$("addCarrierLogBtn").addEventListener("click", ()=>{
  const carrier = $("carrierLogCarrier").value;
  const qty = parseInt($("carrierLogQty").value || "0",10) || 0;
  const date = $("carrierLogDate").value || new Date().toISOString().slice(0,10);

  const arr = getCarrierLog();
  arr.unshift({
    id: crypto.randomUUID(),
    carrier, qty, date,
    completed: false,
    createdAt: nowIso()
  });
  setCarrierLog(arr);
  renderCarrierLog();
  $("carrierLogQty").value = "";
});

/* LOOSE PARTS */
function getLoose(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.loose) || "[]"); }
  catch{ return []; }
}
function setLoose(arr){
  localStorage.setItem(LS_KEYS.loose, JSON.stringify(arr));
}
function renderLoose(){
  const arr = getLoose();
  const tb = $("looseTable").querySelector("tbody");
  tb.innerHTML = "";
  for (const item of arr){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.date}</td>
      <td style="font-family:ui-monospace,monospace">${item.partNumber}</td>
      <td>${item.condition}</td>
      <td><button class="btn secondary" data-id="${item.id}">Delete</button></td>
    `;
    tb.appendChild(tr);
  }
  tb.querySelectorAll("button").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.id;
      const next = getLoose().filter(x=>x.id!==id);
      setLoose(next);
      renderLoose();
    });
  });

  // totals table
  const totals = new Map();
  for (const item of arr){
    totals.set(item.condition, (totals.get(item.condition)||0) + 1);
  }
  const tbt = $("looseTotalsTable").querySelector("tbody");
  tbt.innerHTML = "";
  for (const [k,v] of Array.from(totals.entries()).sort((a,b)=>b[1]-a[1])){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td><b>${fmtInt(v)}</b></td>`;
    tbt.appendChild(tr);
  }
}

$("addLooseBtn").addEventListener("click", ()=>{
  const pn = safeStr($("loosePartPn").value);
  if (!pn) return;

  const condition = $("loosePartCond").value;
  const date = $("loosePartDate").value || new Date().toISOString().slice(0,10);

  const arr = getLoose();
  arr.unshift({ id: crypto.randomUUID(), partNumber: pn, condition, date, createdAt: nowIso() });
  setLoose(arr);
  renderLoose();
  $("loosePartPn").value = "";
});

/* MANIFEST */
function isFedexId(t){
  const s = safeStr(t).replace(/\s+/g,"");
  return looksLikeFedex(s);
}

function extractManifestFedex(manRows){
  if (!manRows.length) return [];

  // find a likely "tracking" column
  const keys = Object.keys(manRows[0]);
  const norm = keys.map(k=>({raw:k, n: normalizeHeader(k)}));
  const trackingKey = (norm.find(x=>x.n.includes("tracking")) || norm[0]).raw;

  const ids = [];
  for (const r of manRows){
    const v = sciToIntString(safeStr(r[trackingKey]));
    if (isFedexId(v)) ids.push(v);
  }
  return Array.from(new Set(ids));
}

function extractWhFedexTrackingFromWhModel(model){
  const ids = model.rows
    .filter(r=>r.isTrackingRow && r.tracking && classifyCarrier(r.tracking)==="FedEx")
    .map(r=>r.tracking);
  return Array.from(new Set(ids));
}

function renderManifestComparison(){
  if (!whRows.length){
    $("kpiManifestFedex").textContent = "0";
    $("kpiWhFedex").textContent = "0";
    $("missingInWh").innerHTML = "";
    $("missingInManifest").innerHTML = "";
    return;
  }

  const whModel = buildModel(whRows);
  const whFedex = extractWhFedexTrackingFromWhModel(whModel);

  const manFedex = extractManifestFedex(manifestRows);

  $("kpiManifestFedex").textContent = fmtInt(manFedex.length);
  $("kpiWhFedex").textContent = fmtInt(whFedex.length);

  const setWh = new Set(whFedex);
  const setMan = new Set(manFedex);

  const missingInWh = manFedex.filter(x=>!setWh.has(x)).slice(0,500);
  const missingInMan = whFedex.filter(x=>!setMan.has(x)).slice(0,500);

  const a = $("missingInWh");
  a.innerHTML = "";
  missingInWh.forEach(id=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `<span>${id}</span>`;
    a.appendChild(div);
  });

  const b = $("missingInManifest");
  b.innerHTML = "";
  missingInMan.forEach(id=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `<span>${id}</span>`;
    b.appendChild(div);
  });
}

$("manifestCsvInput").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;

  Papa.parse(file, {
    header:true,
    skipEmptyLines:true,
    complete: (res)=>{
      manifestRows = res.data || [];
      renderManifestComparison();
    }
  });
});

$("clearManifestBtn").addEventListener("click", ()=>{
  manifestRows = [];
  $("manifestCsvInput").value = "";
  renderManifestComparison();
});

/* LOGS */
function getLogs(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.logs) || "[]"); }
  catch{ return []; }
}
function setLogs(arr){
  localStorage.setItem(LS_KEYS.logs, JSON.stringify(arr));
}

function buildSnapshot(){
  const model = buildModel(whRows);
  const agg = aggregate(model);
  const manual = getManual();
  const carrierLog = getCarrierLog();
  const loose = getLoose();

  // Work date: if user wants, you can set it from CSV column later.
  // For now: default to today's date, but they can still save older days by changing system date OR you can add a date picker later.
  const workDate = new Date().toISOString().slice(0,10);

  return {
    id: crypto.randomUUID(),
    workDate,
    savedAt: nowIso(),
    whMeta,
    totals: {
      carrierScans: agg.carrierCounts,
      totalScans: agg.totalScans,
      uniqueTracking: agg.uniqueTrackingCount,
      totalParts: agg.totalParts,
      boxesWithMultipleParts: agg.boxesWithMultipleParts,
    },
    topBoxes: agg.topBoxes.slice(0,10),
    returnConditions: Object.fromEntries(agg.condTotals),
    manual,
    carrierLogCount: carrierLog.length,
    looseCount: loose.length,
  };
}

function renderLogs(){
  const logs = getLogs();
  const tb = $("logsTable").querySelector("tbody");
  tb.innerHTML = "";
  for (const l of logs){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.workDate}</td>
      <td>${new Date(l.savedAt).toLocaleString()}</td>
      <td><b>${fmtInt(l.totals.totalScans)}</b></td>
      <td><b>${fmtInt(l.totals.totalParts)}</b></td>
      <td>
        <button class="btn secondary" data-act="view" data-id="${l.id}">View</button>
        <button class="btn secondary" data-act="del" data-id="${l.id}">Delete</button>
      </td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      let logs = getLogs();

      if (act === "del"){
        logs = logs.filter(x=>x.id!==id);
        setLogs(logs);
        $("logDetails").textContent = "";
        $("logDetailsHint").textContent = "Select a log to preview.";
        renderLogs();
        return;
      }

      const found = logs.find(x=>x.id===id);
      if (found){
        $("logDetailsHint").textContent = `Log ${found.workDate}`;
        $("logDetails").textContent = JSON.stringify(found, null, 2);
      }
    });
  });
}

/* EXPORT (PDF + XLSX) */
function buildExportText(snapshot){
  const lines = [];
  lines.push(`RRPD Summary`);
  lines.push(`Date: ${snapshot.workDate}`);
  lines.push(`Computed: ${new Date(snapshot.savedAt).toLocaleString()}`);
  lines.push(``);
  lines.push(`Tracking Summary (Total Scans)`);
  lines.push(`FedEx: ${snapshot.totals.carrierScans.FedEx}`);
  lines.push(`UPS: ${snapshot.totals.carrierScans.UPS}`);
  lines.push(`USPS: ${snapshot.totals.carrierScans.USPS}`);
  lines.push(`Other: ${snapshot.totals.carrierScans.Other}`);
  lines.push(`Total Scans: ${snapshot.totals.totalScans}`);
  lines.push(`Unique Tracking: ${snapshot.totals.uniqueTracking}`);
  lines.push(`Total Parts (Pieces): ${snapshot.totals.totalParts}`);
  lines.push(`Boxes With Multiple Parts: ${snapshot.totals.boxesWithMultipleParts}`);
  lines.push(``);
  lines.push(`Top Boxes (by pieces)`);
  snapshot.topBoxes.forEach(b=>{
    lines.push(`${b.tracking} — ${b.pieces} pcs (${b.carrier})`);
  });
  lines.push(``);
  lines.push(`Return Conditions (pieces)`);
  const cond = Object.entries(snapshot.returnConditions).sort((a,b)=>b[1]-a[1]);
  cond.slice(0,10).forEach(([k,v])=>lines.push(`${k}: ${v}`));
  lines.push(``);
  lines.push(`Manual Counts saved: ${snapshot.manual ? "Yes" : "No"}`);
  lines.push(`Carrier log entries: ${snapshot.carrierLogCount}`);
  lines.push(`Loose parts entries: ${snapshot.looseCount}`);
  return lines.join("\n");
}

async function exportPdf(snapshot){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"letter" });

  // dark header
  doc.setFillColor(11, 42, 102);
  doc.rect(0,0,612,70,"F");

  // logo
  try{
    const img = await fetch("logo.png");
    const blob = await img.blob();
    const dataUrl = await blobToDataUrl(blob);
    doc.addImage(dataUrl, "PNG", 18, 14, 42, 42);
  }catch{}

  doc.setTextColor(255,255,255);
  doc.setFontSize(16);
  doc.text(`RRPD Summary — ${snapshot.workDate}`, 70, 36);
  doc.setFontSize(10);
  doc.text(`Computed: ${new Date(snapshot.savedAt).toLocaleString()}`, 70, 54);

  doc.setTextColor(20,20,20);
  doc.setFontSize(12);

  // Tables
  const topY = 90;

  doc.autoTable({
    startY: topY,
    head: [["Carrier", "Scans"]],
    body: [
      ["FedEx", snapshot.totals.carrierScans.FedEx],
      ["UPS", snapshot.totals.carrierScans.UPS],
      ["USPS", snapshot.totals.carrierScans.USPS],
      ["Other", snapshot.totals.carrierScans.Other],
      ["Total Scans", snapshot.totals.totalScans],
      ["Unique Tracking", snapshot.totals.uniqueTracking],
      ["Total Parts (Pieces)", snapshot.totals.totalParts],
    ],
    theme:"grid",
    styles:{ fillColor:[245,245,245] },
    headStyles:{ fillColor:[11,42,102], textColor:255 }
  });

  const y2 = doc.lastAutoTable.finalY + 14;

  doc.autoTable({
    startY: y2,
    head: [["Top Boxes (Tracking)", "Pieces", "Carrier"]],
    body: snapshot.topBoxes.map(b=>[b.tracking, b.pieces, b.carrier]),
    theme:"grid",
    styles:{ fillColor:[245,245,245] },
    headStyles:{ fillColor:[11,42,102], textColor:255 }
  });

  const y3 = doc.lastAutoTable.finalY + 14;

  const condRows = Object.entries(snapshot.returnConditions)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,20)
    .map(([k,v])=>[k, v]);

  doc.autoTable({
    startY: y3,
    head: [["Return Conditions", "Pieces"]],
    body: condRows,
    theme:"grid",
    styles:{ fillColor:[245,245,245] },
    headStyles:{ fillColor:[11,42,102], textColor:255 }
  });

  doc.save(`RRPD_Summary_${snapshot.workDate}.pdf`);
}

async function blobToDataUrl(blob){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function exportXlsx(snapshot){
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`RRPD ${snapshot.workDate}`);

  ws.properties.defaultRowHeight = 18;

  // Columns
  ws.columns = [
    { header: "Section", key:"section", width: 24 },
    { header: "Metric", key:"metric", width: 34 },
    { header: "Value", key:"value", width: 18 },
  ];

  // Dark header row
  ws.getRow(1).font = { bold:true, color:{argb:"FFFFFFFF"} };
  ws.getRow(1).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF0B2A66"} };
  ws.getRow(1).alignment = { vertical:"middle" };

  // Add logo (ExcelJS supports images)
  try{
    const res = await fetch("logo.png");
    const buf = await res.arrayBuffer();
    const imageId = wb.addImage({ buffer: buf, extension: "png" });
    ws.addImage(imageId, { tl:{ col:0, row:0 }, ext:{ width:70, height:70 } });
  }catch{}

  // Title block
  ws.mergeCells("B2:C2");
  ws.getCell("B2").value = `RRPD Summary — ${snapshot.workDate}`;
  ws.getCell("B2").font = { size:16, bold:true, color:{ argb:"FF0B2A66" } };

  ws.mergeCells("B3:C3");
  ws.getCell("B3").value = `Computed: ${new Date(snapshot.savedAt).toLocaleString()}`;
  ws.getCell("B3").font = { size:11, italic:true, color:{ argb:"FF1F3A5A" } };

  let r = 5;

  function section(title){
    ws.getCell(`A${r}`).value = title;
    ws.getCell(`A${r}`).font = { bold:true, color:{argb:"FFFFFFFF"} };
    ws.getCell(`A${r}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF0B2A66"} };
    ws.mergeCells(`A${r}:C${r}`);
    r++;
  }
  function row(metric, value){
    ws.getCell(`A${r}`).value = "";
    ws.getCell(`B${r}`).value = metric;
    ws.getCell(`C${r}`).value = value;
    r++;
  }

  section("Tracking Summary (Total Scans)");
  row("FedEx", snapshot.totals.carrierScans.FedEx);
  row("UPS", snapshot.totals.carrierScans.UPS);
  row("USPS", snapshot.totals.carrierScans.USPS);
  row("Other", snapshot.totals.carrierScans.Other);
  row("Total Scans", snapshot.totals.totalScans);
  row("Unique Tracking", snapshot.totals.uniqueTracking);
  row("Total Parts (Pieces)", snapshot.totals.totalParts);
  row("Boxes With Multiple Parts", snapshot.totals.boxesWithMultipleParts);

  r++;

  section("Top Boxes (by pieces)");
  ws.getCell(`A${r}`).value = "Tracking";
  ws.getCell(`B${r}`).value = "Pieces";
  ws.getCell(`C${r}`).value = "Carrier";
  ["A","B","C"].forEach(c=>{
    ws.getCell(`${c}${r}`).font = { bold:true, color:{argb:"FFFFFFFF"} };
    ws.getCell(`${c}${r}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF173B78"} };
  });
  r++;

  snapshot.topBoxes.forEach(b=>{
    ws.getCell(`A${r}`).value = b.tracking;
    ws.getCell(`B${r}`).value = b.pieces;
    ws.getCell(`C${r}`).value = b.carrier;
    r++;
  });

  r++;

  section("Return Conditions (pieces)");
  const cond = Object.entries(snapshot.returnConditions).sort((a,b)=>b[1]-a[1]).slice(0,25);
  cond.forEach(([k,v])=>row(k, v));

  // make it look less plain
  ws.eachRow((row, rowNumber)=>{
    row.eachCell((cell)=>{
      cell.border = {
        top:{style:"thin", color:{argb:"FFB0B8C1"}},
        left:{style:"thin", color:{argb:"FFB0B8C1"}},
        bottom:{style:"thin", color:{argb:"FFB0B8C1"}},
        right:{style:"thin", color:{argb:"FFB0B8C1"}},
      };
      cell.alignment = { vertical:"middle" };
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `RRPD_Summary_${snapshot.workDate}.xlsx`
  );
}

/* EXPORT MODAL WIRING */
function openExportModal(snapshot){
  $("exportPreview").textContent = buildExportText(snapshot);
  $("confirmExportChk").checked = false;
  $("exportPdfBtn").disabled = true;
  $("exportXlsxBtn").disabled = true;
  $("exportModal").classList.remove("hidden");

  $("confirmExportChk").onchange = (e)=>{
    const ok = e.target.checked;
    $("exportPdfBtn").disabled = !ok;
    $("exportXlsxBtn").disabled = !ok;
  };

  $("cancelExportBtn").onclick = ()=> $("exportModal").classList.add("hidden");
  $("exportPdfBtn").onclick = async ()=>{
    $("exportModal").classList.add("hidden");
    await exportPdf(snapshot);
  };
  $("exportXlsxBtn").onclick = async ()=>{
    $("exportModal").classList.add("hidden");
    await exportXlsx(snapshot);
  };
}

/* TABS */
$("tabs").addEventListener("click", (e)=>{
  const btn = e.target.closest(".tab");
  if (!btn) return;

  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  btn.classList.add("active");

  const tab = btn.dataset.tab;

  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  const panel = document.querySelector(`#panel-${tab}`);
  if (panel) panel.classList.add("active");
});

/* LOAD CSV */
$("whCsvInput").addEventListener("change", (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;

  Papa.parse(file, {
    header:true,
    skipEmptyLines:true,
    complete: (res)=>{
      whRows = res.data || [];
      whMeta = { loadedAt: nowIso(), filename: file.name };

      const model = buildModel(whRows);
      const agg = aggregate(model);

      $("loadStatus").textContent = `WH CSV loaded • ${whRows.length} rows • ${new Date().toLocaleString()}`;
      $("exportBtn").disabled = false;
      $("saveToLogsBtn").disabled = false;

      renderDashboard(agg);
      renderReturns(agg);
      renderManifestComparison();
    }
  });
});

/* SAVE TO LOGS */
$("saveToLogsBtn").addEventListener("click", ()=>{
  if (!whRows.length) return;

  const snap = buildSnapshot();
  const logs = getLogs();
  logs.unshift(snap);
  setLogs(logs);
  renderLogs();
});

/* EXPORT BUTTON */
$("exportBtn").addEventListener("click", ()=>{
  if (!whRows.length) return;
  const snap = buildSnapshot();
  openExportModal(snap);
});

/* INIT */
(function init(){
  // set default dates to today
  const today = new Date().toISOString().slice(0,10);
  $("carrierLogDate").value = today;
  $("loosePartDate").value = today;

  renderManual();
  renderCarrierLog();
  renderLoose();
  renderLogs();
  renderManifestComparison();
})();
