/* ================== CONFIG ================== */
const API_DASH = "/api/dashboard"; // Netlify redirect → .netlify/functions/dashboard
const REFRESH_MIN_DEFAULT = 15;

/* ============== UTILITIES & STATE ============ */
const $ = (sel, p=document) => p.querySelector(sel);
const $$ = (sel, p=document) => [...p.querySelectorAll(sel)];
const byId = id => document.getElementById(id);

const state = {
  // API payload shape we produce in Netlify function:
  // { updated, scanners:{name:count}, weekly:{labels, seriesByName}, classifications:{today:[], monthly:[]}, allTime:{name:count} }
  data: null,
  charts: {},
  manualToday: JSON.parse(localStorage.getItem("manual_today")||"[]"),
  carriers: JSON.parse(localStorage.getItem("carriers")||"[]"),
  racks: JSON.parse(localStorage.getItem("racks")||"[]"),
  refreshTimer: null
};

function setStatus(txt, ok=true){
  const el = byId("status_text");
  el.textContent = txt;
  el.style.color = ok ? "#a8c2e8" : "#ffcc66";
}

/* ============== NAV / PANELS ================= */
function setupNav(){
  $$(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      $$(".tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.target;
      $$(".panel").forEach(p=>p.classList.remove("show"));
      byId(target).classList.add("show");
    });
  });
}

/* ============== FETCH DASHBOARD ============== */
async function fetchDashboard(){
  try{
    const res = await fetch(API_DASH, { cache:"no-store" });
    if(!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = await res.json();
    if(!data) throw new Error("Empty data");
    // merge manual entries for “today” if any (scanners only)
    if(state.manualToday.length){
      const m = {};
      for(const row of state.manualToday){
        m[row.name] = (m[row.name]||0) + Number(row.count||0);
      }
      for(const [n,c] of Object.entries(m)){
        data.scanners[n] = (data.scanners[n]||0) + c;
      }
    }
    state.data = data;
    setStatus(`Updated ${new Date(data.updated).toLocaleTimeString()}`);
    return data;
  }catch(e){
    console.warn("API fallback:", e.message);
    setStatus("API unavailable — local mode", false);
    // lightweight empty structure so UI still renders
    const data = {
      updated: new Date().toISOString(),
      scanners: {},
      weekly: { labels:[], seriesByName:{} },
      classifications: { today:[], monthly:[] },
      allTime: {}
    };
    state.data = data;
    return data;
  }
}

/* ============== RENDER HELPERS =============== */
function barConfig(labels, datasets){
  return {
    type: "bar",
    data: { labels, datasets },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:"#eaf2ff"}}},
      scales:{
        x:{ ticks:{color:"#a8c2e8"}, grid:{color:"rgba(255,255,255,.06)"} },
        y:{ ticks:{color:"#a8c2e8"}, grid:{color:"rgba(255,255,255,.06)"}, beginAtZero:true }
      }
    }
  };
}
function doughnutConfig(labels, data){
  return {
    type:"doughnut",
    data:{ labels, datasets:[{ data }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:"bottom", labels:{color:"#eaf2ff"}}},
      cutout:"60%"
    }
  };
}
function tableFill(tbody, rows){
  tbody.innerHTML = rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("");
}

/* ============== RENDER: DASHBOARD ============ */
function renderDashboard(){
  const data = state.data;
  // Daily share (doughnut)
  const dailyNames = Object.keys(data.scanners);
  const dailyVals = dailyNames.map(n=>data.scanners[n]);
  useChart("chart_daily", doughnutConfig(dailyNames, dailyVals));

  // Weekly stacked bars (one dataset per scanner)
  const labels = data.weekly.labels || [];
  const seriesByName = data.weekly.seriesByName || {};
  const ds = Object.entries(seriesByName).map(([name,vals])=>({
    label:name, data: vals, borderWidth:0
  }));
  useChart("chart_weekly", barConfig(labels, ds));

  // All-time totals table
  const rows = Object.entries(data.allTime)
    .sort((a,b)=>b[1]-a[1])
    .map(([n,c])=>[n, c.toLocaleString()]);
  tableFill($("#table_alltime tbody"), rows);
}

/* ============== RENDER: SCANNERS ============= */
function renderScanners(){
  const data = state.data;
  const names = Object.keys(data.scanners);
  const vals = names.map(n=>data.scanners[n]);

  useChart("chart_scanners_today", barConfig(names, [{label:"Today", data:vals}]));
  // “This Week” series (sum per day across all scanners)
  const labels = data.weekly.labels || [];
  const totalPerDay = labels.map((_,i)=>{
    let s=0;
    for(const v of Object.values(data.weekly.seriesByName||{})){ s += Number(v[i]||0); }
    return s;
  });
  useChart("chart_scanners_week", barConfig(labels, [{label:"Total", data:totalPerDay}]));
}

/* ========= RENDER: CLASSIFICATIONS =========== */
function renderClassifications(){
  const { classifications } = state.data;

  // Pie for today (grouped counts)
  const todayCounts = {};
  for(const row of classifications.today){
    const c = (row.class || row.classification || "").toLowerCase();
    todayCounts[c] = (todayCounts[c]||0) + Number(row.qty||1);
  }
  const tLabels = Object.keys(todayCounts);
  const tVals = tLabels.map(k=>todayCounts[k]);
  useChart("chart_class_today", doughnutConfig(tLabels, tVals));

  // Monthly trend (simple stacked totals by class)
  const months = {};
  for(const row of classifications.monthly){
    const ym = (row.date||"").slice(0,7);
    const cls = (row.class || row.classification || "").toLowerCase();
    months[ym] = months[ym] || {};
    months[ym][cls] = (months[ym][cls]||0) + Number(row.qty||1);
  }
  const mLabels = Object.keys(months).sort();
  const classSet = new Set();
  mLabels.forEach(m=>Object.keys(months[m]).forEach(c=>classSet.add(c)));
  const datasets = [...classSet].map(c=>({
    label:c,
    data: mLabels.map(m=>months[m][c]||0),
    borderWidth:0,
    stack:"month"
  }));
  useChart("chart_class_month", barConfig(mLabels, datasets));

  // Today details table
  const tbody = $("#table_class_today tbody");
  const detailRows = classifications.today.map(r=>[
    new Date(r.time||r.created_at||Date.now()).toLocaleString(),
    r.scanner||r.user||"—",
    r.class||r.classification||"—",
    r.part||r.tracking||r.part_number||"—",
    r.qty||1
  ]);
  tableFill(tbody, detailRows);
}

/* ========= RENDER: MANUAL (CARRIERS/RACKS) === */
function renderSimpleTable(list, tbodySel){
  const tbody = $(tbodySel);
  const rows = list.map(it=>[it.name, it.count.toLocaleString()]);
  tableFill(tbody, rows);
}

/* ============== CHART LIFECYCLE ============== */
function useChart(id, config){
  if(state.charts[id]) state.charts[id].destroy();
  const ctx = byId(id).getContext("2d");
  state.charts[id] = new Chart(ctx, config);
}

/* ============== MANUAL HANDLERS ============== */
function setupManual(){
  // Today manual add/reset
  byId("manual_add").addEventListener("click", ()=>{
    const name = byId("manual_name").value.trim();
    const val = Number(byId("manual_val").value||0);
    if(!name || val<=0) return;
    state.manualToday.push({name, count:val});
    localStorage.setItem("manual_today", JSON.stringify(state.manualToday));
    fetchDashboard().then(()=>{ renderScanners(); renderDashboard(); });
    byId("manual_name").value = ""; byId("manual_val").value = "";
  });
  byId("manual_reset").addEventListener("click", ()=>{
    if(!confirm("Clear today's manual additions?")) return;
    state.manualToday = [];
    localStorage.setItem("manual_today","[]");
    fetchDashboard().then(()=>{ renderScanners(); renderDashboard(); });
  });

  // Carriers
  byId("carrier_add").addEventListener("click", ()=>{
    const n = byId("carrier_name").value.trim();
    const c = Number(byId("carrier_count").value||0);
    if(!n || c<=0) return;
    state.carriers.push({name:n, count:c});
    localStorage.setItem("carriers", JSON.stringify(state.carriers));
    renderSimpleTable(state.carriers, "#table_carriers tbody");
    byId("carrier_name").value=""; byId("carrier_count").value="";
  });
  byId("carrier_reset").addEventListener("click", ()=>{
    if(!confirm("Reset carriers?")) return;
    state.carriers = []; localStorage.setItem("carriers","[]");
    renderSimpleTable(state.carriers, "#table_carriers tbody");
  });

  // Racks
  byId("rack_add").addEventListener("click", ()=>{
    const n = byId("rack_name").value.trim();
    const c = Number(byId("rack_count").value||0);
    if(!n || c<=0) return;
    state.racks.push({name:n, count:c});
    localStorage.setItem("racks", JSON.stringify(state.racks));
    renderSimpleTable(state.racks, "#table_racks tbody");
    byId("rack_name").value=""; byId("rack_count").value="";
  });
  byId("rack_reset").addEventListener("click", ()=>{
    if(!confirm("Reset racks?")) return;
    state.racks = []; localStorage.setItem("racks","[]");
    renderSimpleTable(state.racks, "#table_racks tbody");
  });
}

/* ============== SETTINGS / REFRESH =========== */
function setupRefresh(){
  const input = byId("minutes_input");
  const saved = Number(localStorage.getItem("refresh_min")||REFRESH_MIN_DEFAULT);
  input.value = saved;
  const applyTimer = ()=>{
    if(state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(async ()=>{
      await fetchDashboard();
      renderDashboard(); renderScanners(); renderClassifications();
    }, saved*60*1000);
  };
  applyTimer();
  byId("minutes_save").addEventListener("click", ()=>{
    const v = Math.max(1, Number(input.value||REFRESH_MIN_DEFAULT));
    localStorage.setItem("refresh_min", String(v));
    location.reload();
  });
  byId("refresh_btn").addEventListener("click", async ()=>{
    setStatus("Refreshing…");
    await fetchDashboard();
    renderDashboard(); renderScanners(); renderClassifications();
  });
}

/* ============== MANIFEST OCR ================= */
/* parses "ABC123 x2" or "2x ABC123" → {id, qty} */
function parseLineForItem(line){
  const t = line.trim();
  if(!t) return null;
  // normalize spacing & lowercase x
  const s = t.replace(/×/g,'x').replace(/\s+/g,' ').toLowerCase();
  // 1) part … x2 or part … 2x
  const m1 = s.match(/([a-z0-9\-]+)\s*(?:x\s*([0-9]+)|([0-9]+)\s*x)\b/);
  if(m1){
    const part = (m1[1]||"").toUpperCase();
    const qty = Number(m1[2]||m1[3]||1);
    return { id:part, qty: qty>0?qty:1, raw:line };
  }
  // 2) just a long number/part → qty 1
  const m2 = s.match(/\b([a-z0-9\-]{8,})\b/);
  if(m2){
    return { id:m2[1].toUpperCase(), qty:1, raw:line };
  }
  return null;
}

async function ocrImage(file){
  const { data } = await Tesseract.recognize(file, "eng", { logger:m=>{} });
  return data.text || "";
}

async function ocrPdf(file){
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  let textAll = "";
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const txt = await page.getTextContent();
    textAll += " " + txt.items.map(it=>it.str).join(" ");
  }
  return textAll;
}

async function runManifest(){
  const file = byId("manifest_file").files[0];
  const progress = byId("manifest_progress");
  if(!file){ progress.textContent = "Choose a PDF or image."; return; }
  progress.textContent = "Processing…";

  let text = "";
  try{
    if(file.type === "application/pdf"){ text = await ocrPdf(file); }
    else { text = await ocrImage(file); }
  }catch(e){
    progress.textContent = "Manifest processing failed: "+e.message;
    return;
  }

  // Split text into lines / chunks and parse
  const lines = text.split(/\r?\n| {2,}/g).map(s=>s.trim()).filter(Boolean);
  const items = [];
  for(const ln of lines){
    const it = parseLineForItem(ln);
    if(it) items.push(it);
  }

  // Aggregate by id
  const map = {};
  for(const it of items){
    map[it.id] = (map[it.id]||0) + it.qty;
  }
  const rows = Object.entries(map).map(([id,qty])=>[id, qty, ""]);
  tableFill($("#table_manifest tbody"), rows);
  progress.textContent = rows.length ? `Parsed ${rows.length} lines` : "No recognizable items.";
}

function setupManifest(){
  byId("manifest_run").addEventListener("click", runManifest);
  byId("manifest_clear").addEventListener("click", ()=>{
    byId("manifest_file").value = "";
    byId("manifest_progress").textContent = "";
    $("#table_manifest tbody").innerHTML = "";
  });
}

/* ============== BOOT ========================= */
async function boot(){
  setupNav();
  setupManual();
  setupRefresh();
  setupManifest();

  // manual tables boot
  renderSimpleTable(state.carriers, "#table_carriers tbody");
  renderSimpleTable(state.racks, "#table_racks tbody");

  // first load
  const data = await fetchDashboard();
  // render sections
  renderDashboard();
  renderScanners();
  renderClassifications();
}

document.addEventListener("DOMContentLoaded", boot);
