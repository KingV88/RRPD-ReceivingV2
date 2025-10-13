// ============================
// Constants & Globals
// ============================
const RETURNS_API = "/.netlify/functions/returns";
const PHOTOS_API  = "/.netlify/functions/photos";

const KEYS = {
  racks: "rrpd_racks_v3",
  carriers: "rrpd_carriers_v3",
  inspections: "rrpd_miss_v3",
  admin: "rrpd_admin_user_v3",
  manualMode: "rrpd_manual_mode_v3",
  alltimeScans: "rrpd_alltime_scans_v3"
};

let CHARTS = {}; // map of chartId -> Chart instance

// Local state
const state = {
  manualMode: JSON.parse(localStorage.getItem(KEYS.manualMode) || "false"),
  returns: [],
  racks: JSON.parse(localStorage.getItem(KEYS.racks) || "[]"),
  carriers: JSON.parse(localStorage.getItem(KEYS.carriers) || "[]"),
  inspections: JSON.parse(localStorage.getItem(KEYS.inspections) || "[]"),
  alltimeScans: JSON.parse(localStorage.getItem(KEYS.alltimeScans) || "{}"),
};

// ============================
// Utilities
// ============================
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function todayISO(){ return new Date().toISOString().slice(0,10); }
function getDate(){ const el=$("#globalDate"); return el && el.value ? el.value : todayISO(); }

function toast(msg){
  const t=$("#toast"); if(!t) return;
  t.textContent=msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),1800);
}
function showLoader(v){ $("#loader")?.classList.toggle("hidden",!v); }

function safeChart(id, type, data, options){
  const ctx = document.getElementById(id)?.getContext("2d");
  if(!ctx) return;
  if(CHARTS[id]) { CHARTS[id].destroy(); }
  CHARTS[id] = new Chart(ctx, { type, data, options });
}

function sum(arr, key){ return (arr||[]).reduce((s,i)=> s + (Number(i[key])||0), 0); }

// ============================
// API & Fallback
// ============================
async function fetchReturnsData(selectedDate){
  const url = selectedDate ? `${RETURNS_API}?date=${selectedDate}` : RETURNS_API;
  try{
    const res = await fetch(url, { cache:"no-store" });
    if(!res.ok) throw new Error("returns failed");
    const data = await res.json();
    $("#apiBanner")?.classList.add("hidden");
    return data;
  }catch(e){
    console.warn("API offline, using manual/local data.", e);
    $("#apiBanner")?.classList.remove("hidden");
    return [];
  }
}

async function fetchPhotos(id){
  try{
    const res = await fetch(`${PHOTOS_API}?id=${encodeURIComponent(id)}`,{cache:"no-store"});
    if(!res.ok) throw new Error("photos failed");
    const data = await res.json();
    return data.photos || data || [];
  }catch(e){
    console.warn("Photo fetch error", e);
    return [];
  }
}

// ============================
// Panel: Dashboard
// ============================
function computeScannersCounts(returns){
  const map={}; returns.forEach(r=>{
    const who = r.createdBy || "Unknown";
    map[who] = (map[who]||0)+1;
  });
  return map;
}
function computeClassCounts(returns){
  const keys=["Good","Used","Core","Damaged","Missing","Not Our Part"];
  const map=Object.fromEntries(keys.map(k=>[k,0]));
  returns.forEach(r=>{
    const d=(r.description||"").trim();
    if(d in map) map[d]++; 
  });
  return map;
}

function renderDashboard(){
  const mapScan = computeScannersCounts(state.returns);
  const labels = Object.keys(mapScan);
  const values = Object.values(mapScan);

  safeChart("dash_scanners_today","doughnut",{
    labels,
    datasets:[{data:values}]
  },{responsive:true, plugins:{legend:{position:"bottom"}}});

  const classMap = computeClassCounts(state.returns);
  const clabs = Object.keys(classMap);
  const cvals = Object.values(classMap);

  safeChart("dash_class_today","doughnut",{
    labels: clabs,
    datasets:[{data:cvals}]
  },{responsive:true, plugins:{legend:{position:"bottom"}}});

  $("#lastUpdated").textContent = "Last updated: " + new Date().toLocaleTimeString();
}

// ============================
// Panel: Scanners
// ============================
function renderScanners(){
  // daily donut
  const dmap = computeScannersCounts(state.returns);
  safeChart("scanner_donut","doughnut",{
    labels:Object.keys(dmap),
    datasets:[{data:Object.values(dmap)}]
  },{responsive:true, plugins:{legend:{position:"bottom"}}});

  // all-time bar (manual adjust supported via state.alltimeScans)
  const allMap = {...dmap};
  // merge existing stored totals
  Object.keys(state.alltimeScans).forEach(k=>{
    allMap[k]=(allMap[k]||0)+Number(state.alltimeScans[k]||0);
  });

  safeChart("scanner_alltime","bar",{
    labels:Object.keys(allMap),
    datasets:[{label:"Total Scans", data:Object.values(allMap)}]
  },{responsive:true, plugins:{legend:{display:false}}});

  $("#scannerUpdated").textContent = "Last updated: " + new Date().toLocaleTimeString();
}

// ============================
// Panel: Carriers (Manual)
// ============================
function renderCarriers(){
  const date = getDate();
  const daily = (state.carriers||[]).filter(r=> r.date === date);
  // aggregate daily
  const acc = {FedEx:0,UPS:0,USPS:0,Other:0};
  daily.forEach(r=>{
    acc[r.name] = (acc[r.name]||0) + (Number(r.count)||0);
  });
  safeChart("carrier_donut","doughnut",{
    labels:Object.keys(acc),
    datasets:[{data:Object.values(acc)}]
  },{responsive:true, plugins:{legend:{position:"bottom"}}});

  // list
  const list = daily.map(r=>`${r.name}: ${r.count}`).join(" • ");
  $("#carrierList").textContent = list || "No entries for the selected date.";
}

// ============================
// Panel: Racks (Manual)
// ============================
function renderRacks(){
  const date = getDate();
  const day = (state.racks||[]).filter(r=> r.date===date);

  const totals = {
    racks_good: sum(day,'racks_good'), racks_core: sum(day,'racks_core'),
    eracks_good: sum(day,'eracks_good'), eracks_core: sum(day,'eracks_core'),
    ax_good: sum(day,'ax_good'), ax_used: sum(day,'ax_used'),
    ds_good: sum(day,'ds_good'), ds_used: sum(day,'ds_used'),
    gb_good: sum(day,'gb_good'), gb_used: sum(day,'gb_used'),
  };

  // Donuts
  safeChart("donut_racks","doughnut",{labels:["Good","Core"],datasets:[{data:[totals.racks_good, totals.racks_core]}]},{responsive:true});
  safeChart("donut_eracks","doughnut",{labels:["Good","Core"],datasets:[{data:[totals.eracks_good, totals.eracks_core]}]},{responsive:true});
  safeChart("donut_axles","doughnut",{labels:["Good","Used"],datasets:[{data:[totals.ax_good, totals.ax_used]}]},{responsive:true});
  safeChart("donut_ds","doughnut",{labels:["Good","Used"],datasets:[{data:[totals.ds_good, totals.ds_used]}]},{responsive:true});
  safeChart("donut_gb","doughnut",{labels:["Good","Used"],datasets:[{data:[totals.gb_good, totals.gb_used]}]},{responsive:true});

  // All parts overview (stacked-like via two datasets)
  safeChart("racks_all","bar",{
    labels:["Racks","E-Racks","Axles","Drive Shafts","Gearboxes"],
    datasets:[
      {label:"Good", data:[
        totals.racks_good, totals.eracks_good, totals.ax_good, totals.ds_good, totals.gb_good
      ]},
      {label:"Core/Used", data:[
        totals.racks_core, totals.eracks_core, totals.ax_used, totals.ds_used, totals.gb_used
      ]}
    ]
  },{
    responsive:true,
    plugins:{legend:{position:"bottom"}}
  });

  // Log
  const logs = day.map(r=>{
    const [k,v]=Object.entries(r).find(([k])=>k!=="date"&&k!=="ts");
    return `${r.date} — ${JSON.stringify(r)}`;
  }).reverse().join("<br>");
  $("#racksLog").innerHTML = logs || "No entries today.";
}

// ============================
// Panel: Classifications
// ============================
function renderClassifications(){
  const cmap = computeClassCounts(state.returns);
  safeChart("class_donut","doughnut",{
    labels:Object.keys(cmap),
    datasets:[{data:Object.values(cmap)}]
  },{responsive:true, plugins:{legend:{position:"bottom"}}});

  $("#classUpdated").textContent = "Last updated: " + new Date().toLocaleTimeString();
}

// ============================
// Panel: Miss Inspections
// ============================
function renderMiss(){
  const body = $("#missTableBody"); if(!body) return;
  body.innerHTML = "";
  state.inspections.forEach((it)=>{
    const tr=document.createElement("tr");
    tr.innerHTML = `
      <td>${it.tracking}</td>
      <td>${it.returnId||"-"}</td>
      <td>${it.scanner||"-"}</td>
      <td>${it.reason}</td>
      <td>${it.date}</td>
      <td><button class="btn alt" data-view="${it.tracking}" data-id="${it.returnId||""}">View</button></td>
    `;
    body.appendChild(tr);
  });
}

// ============================
// NAV + Wiring
// ============================
function showPanel(id){
  $$(".panel").forEach(p=>p.classList.remove("active"));
  $("#"+id).classList.add("active");
  $$(".nav-btn").forEach(b=> b.classList.toggle("active", b.dataset.panel===id));
}

function bindNav(){
  $$(".nav-btn").forEach(btn=>{
    btn.addEventListener("click",()=> showPanel(btn.dataset.panel));
  });
}

// ============================
// Forms & Buttons
// ============================
function bindForms(){
  // Refresh
  $("#refresh_data").addEventListener("click", refreshAll);

  // Manual toggle
  $("#toggle_manual").addEventListener("click", ()=>{
    state.manualMode = !state.manualMode;
    localStorage.setItem(KEYS.manualMode, JSON.stringify(state.manualMode));
    toast(state.manualMode? "Manual mode ON" : "Manual mode OFF");
  });

  // Carriers (manual)
  $("#carrierForm").addEventListener("submit", e=>{
    e.preventDefault();
    const name=$("#carrierName").value;
    const count=Number($("#carrierCount").value||0);
    if(!name || !count){ toast("Enter carrier and count"); return;}
    state.carriers.push({date:getDate(),name,count,ts:Date.now()});
    localStorage.setItem(KEYS.carriers, JSON.stringify(state.carriers));
    renderCarriers();
    toast("Carrier saved");
    e.target.reset();
  });

  // Racks (manual)
  $("#racksForm").addEventListener("submit", e=>{
    e.preventDefault();
    const type=$("#ri_type").value;
    const g=Number($("#ri_good").value||0);
    const cu=Number($("#ri_coreused").value||0);
    const row={date:getDate(), ts:Date.now()};
    if(type==="racks"){ row.racks_good=g; row.racks_core=cu; }
    if(type==="eracks"){ row.eracks_good=g; row.eracks_core=cu; }
    if(type==="axles"){ row.ax_good=g; row.ax_used=cu; }
    if(type==="ds"){ row.ds_good=g; row.ds_used=cu; }
    if(type==="gb"){ row.gb_good=g; row.gb_used=cu; }
    state.racks.push(row);
    localStorage.setItem(KEYS.racks, JSON.stringify(state.racks));
    renderRacks();
    toast("Saved");
    e.target.reset();
  });
  $("#reset_racks").addEventListener("click", ()=>{
    if(!confirm("Reset today's rack log?")) return;
    const d=getDate();
    state.racks = state.racks.filter(r=> r.date!==d);
    localStorage.setItem(KEYS.racks, JSON.stringify(state.racks));
    renderRacks();
    toast("Reset for today");
  });

  // Miss inspections
  $("#missInspectionForm").addEventListener("submit", async e=>{
    e.preventDefault();
    const tracking=$("#missTracking").value.trim();
    const reason=$("#missReason").value.trim();
    if(!tracking || !reason){ toast("Tracking & reason required"); return; }
    // try to match return
    const rec = state.returns.find(r=> (r.track_number||"")===tracking);
    const entry = {
      tracking,
      reason,
      date:getDate(),
      returnId: rec ? rec.id : null,
      scanner : rec ? (rec.createdBy||null) : null
    };
    state.inspections.push(entry);
    localStorage.setItem(KEYS.inspections, JSON.stringify(state.inspections));
    renderMiss();
    toast("Miss saved");
    e.target.reset();
  });

  // Photo viewer (delegate)
  $("#miss")?.addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-view]");
    if(!btn) return;
    const tracking = btn.getAttribute("data-view");
    const rid = btn.getAttribute("data-id");
    let photos = await fetchPhotos(tracking);
    if((!photos || !photos.length) && rid){
      photos = await fetchPhotos(rid);
    }
    const gal = $("#photoGallery");
    gal.innerHTML = photos && photos.length
      ? photos.map(u=>`<img src="${u}" alt="photo">`).join("")
      : "<div class='small'>No photos found.</div>";
    $("#photoModal").classList.remove("hidden");
  });
  $("#closeModal").addEventListener("click",()=> $("#photoModal").classList.add("hidden"));

  // Admin
  $("#admin_login").addEventListener("click",()=>{
    const u=$("#admin_user").value.trim();
    const p=$("#admin_pass").value.trim();
    if(!u || !p){ toast("Enter user/pass"); return;}
    localStorage.setItem(KEYS.admin, u);
    $("#admin_badge").classList.remove("hidden");
    toast("Admin logged in");
  });
  $("#admin_logout").addEventListener("click",()=>{
    localStorage.removeItem(KEYS.admin);
    $("#admin_badge").classList.add("hidden");
    toast("Logged out");
  });

  // Export
  $("#backup_json").addEventListener("click",()=>{
    const payload = {
      racks: state.racks,
      carriers: state.carriers,
      inspections: state.inspections,
      alltimeScans: state.alltimeScans
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`rrpd_backup_${todayISO()}.json`;
    a.click();
  });

  $("#export_csv").addEventListener("click",()=>{
    const rows = state.inspections.map(i=>({
      tracking:i.tracking, returnId:i.returnId||"", scanner:i.scanner||"",
      reason:i.reason, date:i.date
    }));
    const head = "tracking,returnId,scanner,reason,date\n";
    const body = rows.map(r=>[
      JSON.stringify(r.tracking),JSON.stringify(r.returnId),JSON.stringify(r.scanner),
      JSON.stringify(r.reason),JSON.stringify(r.date)
    ].join(",")).join("\n");
    const blob = new Blob([head+body],{type:"text/csv"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`miss_inspections_${todayISO()}.csv`;
    a.click();
  });
}

// ============================
/* Refresh cycle:
   - If manual mode: don't call API, just render local data
   - Else: try API; if succeeds, render; if fails, show banner, still render local
*/
async function refreshAll(){
  showLoader(true);
  const date = getDate();
  let returns = [];
  if(!state.manualMode){
    returns = await fetchReturnsData(date);
  }
  state.returns = returns;
  renderDashboard();
  renderScanners();
  renderCarriers();
  renderRacks();
  renderClassifications();
  renderMiss();
  $("#lastUpdated").textContent = "Last updated: " + new Date().toLocaleTimeString();
  showLoader(false);
}

// ============================
// Init
// ============================
function init(){
  // clock
  setInterval(()=> $("#clock").textContent = new Date().toLocaleTimeString(), 1000);

  // default date
  const d=$("#globalDate");
  if(d && !d.value) d.value = todayISO();
  d.addEventListener("change", refreshAll);

  // nav + forms
  bindNav();
  bindForms();

  // first paint
  refreshAll();

  // auto-refresh every 15 minutes
  setInterval(refreshAll, 15*60*1000);

  console.log("✅ All buttons connected and functional");
}

document.addEventListener("DOMContentLoaded", init);
