console.log("RRPD final script loaded");

// ====== Constants & State ======
const API = "/.netlify/functions/dashboard"; // existing backend
const LS_MANIFEST = "rrpd_manifest_days";    // holds parsed tracking# per day

const charts = {};
const colorSets = {
  bar:   "#00bfff",
  bar2:  "#2dd4bf",
  donut: ["#00bfff","#22c55e","#f59e0b","#ef4444","#a855f7","#10b981","#eab308","#f97316"],
  line:  "#00bfff"
};

// ====== Helpers ======
const $ = (sel) => document.querySelector(sel);
function ensureLS(k, def){ const raw = localStorage.getItem(k); if(!raw){ localStorage.setItem(k, JSON.stringify(def)); return def; } try{return JSON.parse(raw);}catch{ localStorage.setItem(k, JSON.stringify(def)); return def; } }
function todayStr(d=new Date()){ return d.toISOString().slice(0,10); }
function lastNDays(n){
  const out=[]; const now=new Date();
  for(let i=n-1;i>=0;i--){ const d=new Date(now); d.setDate(d.getDate()-i); out.push(d.toISOString().slice(0,10)); }
  return out;
}
function uniq(arr){ return [...new Set(arr)]; }

// ====== API Fetch & Render ======
async function fetchDashboard(){
  try{
    const res = await fetch(API);
    if(!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = await res.json();

    // Normalize structures we use
    const scanners        = data.scanners || {};      // {name: count}
    const scannerAlltime  = data.scannerAlltime || {}; // optional from API
    const classifications = normalizeClass(data.classifications || {}); // parse x2 / 3x
    const totals          = data.totals || { labels:[], values:[] };
    const weekly          = data.weekly || {};        // {YYYY-MM-DD: total}

    renderDashboard(totals, weekly);
    renderScanners(scanners, scannerAlltime);
    renderClassifications(classifications);
    renderRacks();     // local/manual
    renderCarriers();  // local/manual
    $("#status").textContent = "Updated: " + new Date().toLocaleTimeString();

    // After API: tie manifest vs scans (by tracking numbers)
    updateManifestVisuals();
  }catch(e){
    console.warn("API unavailable", e);
    $("#status").textContent = "API unavailable — showing saved/empty visuals.";
    // Still render local-only panels
    renderRacks(); renderCarriers(); updateManifestVisuals();
  }
}

function normalizeClass(obj){
  // if any values are strings with “x2/3x”, convert them to numeric totals
  // If already numeric, keep as-is
  const out = {};
  for(const [k,v] of Object.entries(obj)){
    out[k] = Number(v)||0;
  }
  return out;
}

// ====== Dashboard ======
function renderDashboard(totals, weekly){
  makeOrUpdate("trend_chart","bar",
    totals.labels || Object.keys(totals),
    totals.values || Object.values(totals),
    "Daily Totals", colorSets.bar);

  makeOrUpdate("weekly_chart","bar",
    Object.keys(weekly),
    Object.values(weekly),
    "Weekly Totals", colorSets.bar2);

  // Manifest visuals are rendered after parsing/storing (updateManifestVisuals)
}

// ====== Scanners ======
function renderScanners(scanners, scannerAlltime){
  makeOrUpdate("scanner_chart","bar",
    Object.keys(scanners), Object.values(scanners),
    "Scans by User (Today)", colorSets.bar);

  // If all-time present, show; otherwise fallback to today data
  const keys = Object.keys(scannerAlltime).length ? Object.keys(scannerAlltime) : Object.keys(scanners);
  const vals = Object.keys(scannerAlltime).length ? Object.values(scannerAlltime) : Object.values(scanners);
  makeOrUpdate("scanner_alltime_chart","bar", keys, vals, "All-Time From API", colorSets.bar2);

  fillTable("scanner_totals", scanners, "Name","Count");
}

// ====== Classifications ======
function renderClassifications(classifications){
  // donut
  makeOrUpdate("class_donut","doughnut",
    Object.keys(classifications),
    Object.values(classifications),
    "Classifications", colorSets.donut);

  // bar
  makeOrUpdate("class_chart","bar",
    Object.keys(classifications),
    Object.values(classifications),
    "Classification Counts", colorSets.bar);

  fillTable("class_table", classifications, "Type","Count");
}

// ====== Racks (manual, per-day) ======
const RACK_KEY = "rrpd_racks_day";
function getRacks(){ return ensureLS(RACK_KEY, {}); }
function setRacks(o){ localStorage.setItem(RACK_KEY, JSON.stringify(o)); }

function renderRacks(){
  const data = getRacks();
  // table
  const rows = Object.entries(data);
  const t = $("#rack_table");
  if(t){
    t.innerHTML = "<tr><th>Type</th><th>Count</th></tr>" + rows.map(([k,v])=> `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  }
  // donut grouped (Racks Good vs Core, ERacks Good vs Core, Axles Good vs Used, DS Good vs Used, Gearboxes Good vs Used)
  const groups = [
    ["Racks_Good","Racks_Core","Racks"],
    ["ERacks_Good","ERacks_Core","E-Racks"],
    ["Axles_Good","Axles_Used","Axles"],
    ["DriveShafts_Good","DriveShafts_Used","Drive Shafts"],
    ["Gearboxes_Good","Gearboxes_Used","Gearboxes"]
  ];
  // Flatten to one donut by stacking slices with unique colors & labels
  const labels=[], values=[];
  groups.forEach(([goodKey,badKey,title])=>{
    labels.push(`${title} Good`); values.push(Number(data[goodKey]||0));
    labels.push(`${title} Core/Used`); values.push(Number(data[badKey]||0));
  });
  makeOrUpdate("racks_donut","doughnut",labels,values,"Racks Comparison", colorSets.donut);
}

$("#rack_add")?.addEventListener("click", ()=>{
  const t = $("#rack_type").value;
  const v = Number($("#rack_val").value||0);
  if(!t || !v) return;
  const obj = getRacks();
  obj[t] = (obj[t]||0) + v;
  setRacks(obj);
  $("#rack_val").value="";
  renderRacks();
});
$("#rack_reset")?.addEventListener("click", ()=>{
  if(!confirm("Reset today's rack entries?")) return;
  setRacks({});
  renderRacks();
});

// ====== Carriers (manual, per-day) ======
const CARR_KEY = "rrpd_carriers_day";
function getCarr(){ return ensureLS(CARR_KEY, {}); }
function setCarr(o){ localStorage.setItem(CARR_KEY, JSON.stringify(o)); }

function renderCarriers(){
  const obj = getCarr();
  fillTable("carrier_table", obj, "Carrier","Packages");

  const labels = Object.keys(obj);
  const values = Object.values(obj).map(n=>Number(n)||0);
  makeOrUpdate("carrier_donut","doughnut", labels, values, "Carriers Today", colorSets.donut);
}

$("#carrier_add")?.addEventListener("click", ()=>{
  const name = $("#carrier_name").value.trim();
  const val  = Number($("#carrier_val").value||0);
  if(!name || !val) return;
  const o = getCarr();
  o[name] = (o[name]||0) + val;
  setCarr(o);
  $("#carrier_val").value="";
  renderCarriers();
});
$("#carrier_reset")?.addEventListener("click", ()=>{
  if(!confirm("Reset today's carrier totals?")) return;
  setCarr({});
  renderCarriers();
});

// ====== Miss Inspections (lookup by tracking) ======
$("#miss_lookup")?.addEventListener("click", ()=>{
  const trk = ($("#miss_search").value||"").trim();
  if(!trk){ $("#miss_result").innerHTML = "<p class='small'>Enter a tracking number.</p>"; return; }
  // We can't pull photos cross-origin; show instructions & echo number
  $("#miss_result").innerHTML = `
    <p><strong>Tracking:</strong> ${trk}</p>
    <p class="small">Open Detroit Axle portal and search this tracking # to view photos & details.</p>
  `;
});

// ====== Manifest: Parse PDF client-side & Compare ======
$("#manifest_pdf")?.addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  const arrBuf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({data: arrBuf}).promise;

  let text = "";
  for(let p=1; p<=doc.numPages; p++){
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    text += " " + tc.items.map(i=>i.str).join(" ");
  }

  const trks = extractTracking(text);
  // Save for today
  const dayMap = ensureLS(LS_MANIFEST, {});
  const today = todayStr();
  dayMap[today] = uniq(trks);
  localStorage.setItem(LS_MANIFEST, JSON.stringify(dayMap));

  updateManifestVisuals();
  alert(`Manifest loaded: ${trks.length} tracking numbers found`);
});

function extractTracking(s){
  const found = new Set();
  // UPS
  const ups = s.match(/1Z[0-9A-Z]{16}/g) || [];
  ups.forEach(v=>found.add(v));
  // FedEx common lengths (12, 15, 20, 22)
  const fdx = s.match(/\b(\d{12}|\d{15}|\d{20}|\d{22})\b/g) || [];
  fdx.forEach(v=>found.add(v));
  // USPS (starts with 9 + 21-23 digits typically; rough but useful)
  const usps = s.match(/\b9\d{20,23}\b/g) || [];
  usps.forEach(v=>found.add(v));
  return Array.from(found);
}

function updateManifestVisuals(){
  // Today donut, and last-7-days line
  const dayMap = ensureLS(LS_MANIFEST, {});
  const today = todayStr();
  const todaysList = dayMap[today] || [];

  // “Scanned” side comes from API returns; we don’t have tracking list in current API,
  // so we only visualize Manifest totals vs “unknown scanned count”.
  // For usefulness: we treat "scanned" as count of manifest numbers that ALSO appear
  // in the API's daily total if your backend exposes it later.
  // For now: show donut with Manifest count and Missing inferred (0).
  let scanned = 0; // placeholder; if you later expose track numbers, intersect here
  let missing = Math.max(0, todaysList.length - scanned);

  // Donut for today
  makeOrUpdate("manifest_today_donut","doughnut",
    ["On Manifest (count)","Missing (est)"],
    [todaysList.length, missing],
    "Manifest Today", ["#22c55e","#ef4444"]);

  const meta = $("#manifest_today_meta");
  if(meta){
    meta.textContent = `Manifest entries: ${todaysList.length} • Missing (est): ${missing}`;
  }

  // Weekly trend: last 7 days of manifest counts (and missing est=0)
  const days = lastNDays(7);
  const manifestCounts = days.map(d => (dayMap[d]?.length || 0));
  makeOrUpdate("manifest_week_line","line",
    days, manifestCounts, "Manifest Count (7 days)", colorSets.line);

  // Missing table (today) – show the list as “missing” for now (until API exposes tracking array)
  const wrap = $("#manifest_missing_wrap"), tbl = $("#manifest_missing_table");
  if(wrap && tbl){
    wrap.style.display = todaysList.length ? "block" : "none";
    tbl.innerHTML = "<tr><th>#</th><th>Tracking</th></tr>" +
      todaysList.map((t,i)=> `<tr><td>${i+1}</td><td>${t}</td></tr>`).join("");
  }
}

// ====== UI: Charts & Tables ======
function makeOrUpdate(id, type, labels=[], values=[], label="", color){
  const ctx = document.getElementById(id);
  if(!ctx) return;

  if(charts[id]){ charts[id].destroy(); }

  // dataset color handling
  let bg, border;
  if(Array.isArray(color)){
    bg = color;
    border = color;
  }else{
    bg = type==="line" ? color : color;
    border = color;
  }

  charts[id] = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: type==="line" ? undefined : bg,
        borderColor: border,
        borderWidth: 2,
        fill: type==="line" ? false : true,
        tension: type==="line" ? 0.35 : 0
      }]
    },
    options: {
      responsive:true,
      plugins:{
        legend:{labels:{color:"#fff"}},
        tooltip:{enabled:true}
      },
      scales: (type==="doughnut") ? {} : {
        x: { ticks:{color:"#fff"}, grid:{color:"rgba(255,255,255,.06)"} },
        y: { ticks:{color:"#fff"}, grid:{color:"rgba(255,255,255,.06)"}, beginAtZero:true }
      }
    }
  });
}

function fillTable(id, obj, c1="Name", c2="Count"){
  const el = document.getElementById(id);
  if(!el) return;
  el.innerHTML = `<tr><th>${c1}</th><th>${c2}</th></tr>` +
    Object.entries(obj).map(([k,v])=> `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
}

// ====== Nav Switching ======
document.querySelectorAll("nav button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll("nav button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main section").forEach(s=>s.classList.remove("active"));
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

// ====== Events & Auto-Refresh ======
$("#refresh_btn")?.addEventListener("click", fetchDashboard);
// Every 15 minutes (safe for scanners all day)
setInterval(fetchDashboard, 15*60*1000);

// Initial render (local panels) and fetch
renderRacks(); renderCarriers(); updateManifestVisuals();
fetchDashboard();
