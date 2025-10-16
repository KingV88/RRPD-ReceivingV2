// ---------- constants / keys ----------
const API_DASH = "/api/dashboard";
const LS = {
  carriers: "rrpd_carriers_v3",
  racks: "rrpd_racks_v3",
  miss: "rrpd_miss_v3",
};

// ---------- utils ----------
const byId = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0,10);
const toNum = v => Number(v)||0;
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k))||[] } catch { return [] } }
const lsSet = (k,v) => localStorage.setItem(k, JSON.stringify(v));
const setStatus = (txt, ok=true) => {
  const el = byId("status");
  el.textContent = txt;
  el.style.color = ok ? "#10b981" : "#ef4444";
};

// ---------- nav ----------
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    byId(btn.dataset.panel).classList.add("active");
  });
});

// ---------- charts registry (destroy before re-draw) ----------
const CH = {};
function drawChart(id, cfg){
  const el = byId(id);
  if (!el) return;
  if (CH[id]) { CH[id].destroy(); }
  CH[id] = new Chart(el.getContext("2d"), cfg);
}

// ---------- API fetch w/ fallback ----------
async function fetchDashboard(){
  try{
    const res = await fetch(API_DASH);
    const data = await res.json();
    if (!data || !data.scanners) throw new Error("Empty data");
    setStatus(`Updated ${new Date(data.updated).toLocaleTimeString()}`, true);
    return data;
  }catch(e){
    console.warn("API fallback:", e.message);
    setStatus("API unavailable — local mode", false);
    return {
      scanners:{}, classifications:{}, updated:new Date().toISOString()
    };
  }
}

// ---------- render API sections ----------
function renderScanners(data){
  // table
  const t = byId("scanner_totals");
  t.innerHTML = `<tr><th>Scanner</th><th>Count</th></tr>` +
    Object.entries(data.scanners).map(([n,c])=>`<tr><td>${n}</td><td>${c}</td></tr>`).join("") || `<tr><td colspan="2">No data</td></tr>`;

  // bars
  const labels = Object.keys(data.scanners);
  const vals = Object.values(data.scanners);
  drawChart("scanner_chart", {
    type:"bar",
    data:{ labels, datasets:[{ label:"Scans", data:vals, backgroundColor:"#3b82f6" }] },
    options:{ animation:false, plugins:{legend:{display:false}}, scales:{x:{ticks:{color:"#cbd5e1"}},y:{ticks:{color:"#cbd5e1"}}}}
  });
  drawChart("scanner_chart_full", {
    type:"bar",
    data:{ labels, datasets:[{ label:"All-Time Scans", data:vals, backgroundColor:"#2563eb" }] },
    options:{ animation:false, plugins:{legend:{display:false}}}
  });

  // “today” is a visual subset; without per-scan timestamps from API we mirror totals for now
  drawChart("scanner_chart_today", {
    type:"bar",
    data:{ labels, datasets:[{ label:"Today (visual)", data:vals, backgroundColor:"#60a5fa" }] },
    options:{ animation:false, plugins:{legend:{display:false}}}
  });
}

function renderClassifications(data){
  const t = byId("class_table");
  t.innerHTML = `<tr><th>Classification</th><th>Count</th></tr>` +
    Object.entries(data.classifications).map(([n,c])=>`<tr><td>${n}</td><td>${c}</td></tr>`).join("") || `<tr><td colspan="2">No data</td></tr>`;

  const labels = Object.keys(data.classifications);
  const vals = Object.values(data.classifications);
  const colors = ["#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#e11d48","#14b8a6","#f97316"];
  drawChart("class_chart", {
    type:"doughnut",
    data:{ labels, datasets:[{ data:vals, backgroundColor:colors.slice(0,vals.length) }] },
    options:{ animation:false, plugins:{legend:{position:"bottom", labels:{color:"#cbd5e1"}}}}
  });
  drawChart("class_chart_full", {
    type:"doughnut",
    data:{ labels, datasets:[{ data:vals, backgroundColor:colors.slice(0,vals.length) }] },
    options:{ animation:false, plugins:{legend:{position:"bottom", labels:{color:"#cbd5e1"}}}}
  });
}

// ---------- CARRIERS (manual, daily) ----------
function carriersToday(arr){
  const d = today();
  const row = arr.find(r=>r.date===d) || {fedex:0,ups:0,usps:0,other:0};
  return [row.fedex||0,row.ups||0,row.usps||0,row.other||0];
}
function carriersWeekSeries(arr){
  // last 7 days
  const days = [...Array(7)].map((_,i)=>{
    const dt = new Date(); dt.setDate(dt.getDate()-(6-i));
    return dt.toISOString().slice(0,10);
  });
  const series = {FedEx:[], UPS:[], USPS:[], Other:[]};
  days.forEach(d=>{
    const r = arr.find(x=>x.date===d) || {};
    series.FedEx.push(r.fedex||0);
    series.UPS.push(r.ups||0);
    series.USPS.push(r.usps||0);
    series.Other.push(r.other||0);
  });
  return {days, series};
}
function renderCarriers(){
  const arr = lsGet(LS.carriers);
  // donuts today
  const todayVals = carriersToday(arr);
  drawChart("carrier_donut_today",{
    type:"doughnut",
    data:{ labels:["FedEx","UPS","USPS","Other"], datasets:[{ data:todayVals, backgroundColor:["#06b6d4","#ef4444","#10b981","#f59e0b"] }]},
    options:{ animation:false, plugins:{legend:{position:"bottom", labels:{color:"#cbd5e1"}}}}
  });

  // week bars
  const {days, series} = carriersWeekSeries(arr);
  drawChart("carrier_bars_week",{
    type:"bar",
    data:{
      labels:days,
      datasets:[
        {label:"FedEx", data:series.FedEx, backgroundColor:"#06b6d4"},
        {label:"UPS", data:series.UPS, backgroundColor:"#ef4444"},
        {label:"USPS", data:series.USPS, backgroundColor:"#10b981"},
        {label:"Other", data:series.Other, backgroundColor:"#f59e0b"},
      ]
    },
    options:{ animation:false, plugins:{legend:{labels:{color:"#cbd5e1"}}}, scales:{x:{ticks:{color:"#cbd5e1"}},y:{ticks:{color:"#cbd5e1"}}}}
  });

  // log table
  byId("carrier_log").innerHTML =
    `<tr><th>Date</th><th>FedEx</th><th>UPS</th><th>USPS</th><th>Other</th></tr>` +
    arr.slice().reverse().map(r=>`<tr><td>${r.date}</td><td>${r.fedex||0}</td><td>${r.ups||0}</td><td>${r.usps||0}</td><td>${r.other||0}</td></tr>`).join("") || `<tr><td>—</td></tr>`;
}
byId("ca_save").addEventListener("click", ()=>{
  const date = byId("ca_date").value || today();
  const fedex = toNum(byId("ca_fedex").value);
  const ups   = toNum(byId("ca_ups").value);
  const usps  = toNum(byId("ca_usps").value);
  const other = toNum(byId("ca_other").value);
  const arr = lsGet(LS.carriers);
  const i = arr.findIndex(r=>r.date===date);
  const row = {date,fedex,ups,usps,other};
  if (i>=0) arr[i]=row; else arr.push(row);
  lsSet(LS.carriers,arr);
  renderCarriers();
  setStatus("Carriers saved", true);
});
byId("ca_reset").addEventListener("click", ()=>{
  if (!confirm("Reset ALL carriers?")) return;
  lsSet(LS.carriers,[]);
  renderCarriers();
  setStatus("Carriers cleared", true);
});

// ---------- RACKS (manual, daily) ----------
function renderRacks(){
  const arr = lsGet(LS.racks);
  const totals = arr.reduce((a,r)=>({
    rg:(a.rg||0)+toNum(r.rg), rc:(a.rc||0)+toNum(r.rc),
    eg:(a.eg||0)+toNum(r.eg), ec:(a.ec||0)+toNum(r.ec),
    axg:(a.axg||0)+toNum(r.axg), axu:(a.axu||0)+toNum(r.axu),
    dsg:(a.dsg||0)+toNum(r.dsg), dsu:(a.dsu||0)+toNum(r.dsu),
    gbg:(a.gbg||0)+toNum(r.gbg), gbu:(a.gbu||0)+toNum(r.gbu),
  }),{});

  // five donuts
  drawChart("ra_donut_racks", { type:"doughnut",
    data:{ labels:["Good","Core"], datasets:[{ data:[totals.rg||0, totals.rc||0], backgroundColor:["#22c55e","#ef4444"] }] },
    options:{ animation:false, plugins:{legend:{position:"bottom", labels:{color:"#cbd5e1"}}}}
  });
  drawChart("ra_donut_eracks", { type:"doughnut",
    data:{ labels:["Good","Core"], datasets:[{ data:[totals.eg||0, totals.ec||0], backgroundColor:["#10b981","#dc2626"] }] },
    options:{ animation:false, plugins:{legend:{position:"bottom", labels:{color:"#cbd5e1"}}}}
  });
  drawChart("ra_donut_axles", { type:"doughnut",
    data:{ labels:["Good","Used"], datasets:[{ data:[totals.axg||0, totals.axu||0], backgroundColor:["#06b6d4","#f59e0b"] }] },
    options:{ animation:false, plugins:{legend:{position:"bottom", labels:{color:"#cbd5e1"}}}}
  });
  drawChart("ra_donut_ds", { type:"doughnut",
    data:{ labels:["Good","Used"], datasets:[{ data:[totals.dsg||0, totals.dsu||0], backgroundColor:["#3b82f6","#f97316"] }] },
    options:{ animation:false, plugins:{legend:{position:"bottom", labels:{color:"#cbd5e1"}}}}
  });
  drawChart("ra_donut_gb", { type:"doughnut",
    data:{ labels:["Good","Used"], datasets:[{ data:[totals.gbg||0, totals.gbu||0], backgroundColor:["#a855f7","#e11d48"] }] },
    options:{ animation:false, plugins:{legend:{position:"bottom", labels:{color:"#cbd5e1"}}}}
  });

  // last 7 days bar (stacked-ish by category sum)
  const days = [...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d.toISOString().slice(0,10);});
  const mk = k => days.map(d=> (arr.find(x=>x.date===d)?.[k])||0 );
  drawChart("ra_week_bars", {
    type:"bar",
    data:{
      labels:days,
      datasets:[
        {label:"Racks Good", data:mk("rg"), backgroundColor:"#22c55e"},
        {label:"Racks Core", data:mk("rc"), backgroundColor:"#ef4444"},
        {label:"E-Racks Good", data:mk("eg"), backgroundColor:"#10b981"},
        {label:"E-Racks Core", data:mk("ec"), backgroundColor:"#dc2626"},
        {label:"Axles Good", data:mk("axg"), backgroundColor:"#06b6d4"},
        {label:"Axles Used", data:mk("axu"), backgroundColor:"#f59e0b"},
        {label:"DS Good", data:mk("dsg"), backgroundColor:"#3b82f6"},
        {label:"DS Used", data:mk("dsu"), backgroundColor:"#f97316"},
        {label:"GB Good", data:mk("gbg"), backgroundColor:"#a855f7"},
        {label:"GB Used", data:mk("gbu"), backgroundColor:"#e11d48"},
      ]
    },
    options:{ animation:false, plugins:{legend:{labels:{color:"#cbd5e1"}}}, scales:{x:{ticks:{color:"#cbd5e1"}},y:{ticks:{color:"#cbd5e1"}}}}
  });

  // log
  byId("racks_log").innerHTML =
    `<tr><th>Date</th><th>RG</th><th>RC</th><th>EG</th><th>EC</th><th>AX G</th><th>AX U</th><th>DS G</th><th>DS U</th><th>GB G</th><th>GB U</th></tr>` +
    arr.slice().reverse().map(r=>`<tr><td>${r.date}</td><td>${r.rg||0}</td><td>${r.rc||0}</td><td>${r.eg||0}</td><td>${r.ec||0}</td><td>${r.axg||0}</td><td>${r.axu||0}</td><td>${r.dsg||0}</td><td>${r.dsu||0}</td><td>${r.gbg||0}</td><td>${r.gbu||0}</td></tr>`).join("");
}
byId("ra_save").addEventListener("click", ()=>{
  const row = {
    date: byId("ra_date").value || today(),
    rg: toNum(byId("ra_racks_good").value),
    rc: toNum(byId("ra_racks_core").value),
    eg: toNum(byId("ra_eracks_good").value),
    ec: toNum(byId("ra_eracks_core").value),
    axg: toNum(byId("ra_ax_good").value),
    axu: toNum(byId("ra_ax_used").value),
    dsg: toNum(byId("ra_ds_good").value),
    dsu: toNum(byId("ra_ds_used").value),
    gbg: toNum(byId("ra_gb_good").value),
    gbu: toNum(byId("ra_gb_used").value),
  };
  const arr = lsGet(LS.racks);
  const i = arr.findIndex(r=>r.date===row.date);
  if (i>=0) arr[i]=row; else arr.push(row);
  lsSet(LS.racks,arr);
  renderRacks();
  setStatus("Racks saved", true);
});
byId("ra_reset").addEventListener("click", ()=>{
  if (!confirm("Reset ALL racks?")) return;
  lsSet(LS.racks,[]);
  renderRacks();
  setStatus("Racks cleared", true);
});

// ---------- MISS INSPECTIONS ----------
function renderMiss(){
  const arr = lsGet(LS.miss);
  byId("miss_log").innerHTML =
    `<tr><th>Date</th><th>Scanner</th><th>Tracking</th><th>Reason</th></tr>` +
    arr.slice().reverse().map(r=>`<tr><td>${r.date}</td><td>${r.scanner}</td><td>${r.tracking}</td><td>${r.reason}</td></tr>`).join("") || `<tr><td colspan="4">No records</td></tr>`;
}
byId("mi_save").addEventListener("click", ()=>{
  const row = {
    date: byId("mi_date").value || today(),
    scanner: byId("mi_scanner").value.trim() || "Unknown",
    tracking: byId("mi_tracking").value.trim(),
    reason: byId("mi_reason").value.trim(),
  };
  if (!row.tracking) return alert("Tracking required");
  const arr = lsGet(LS.miss); arr.push(row); lsSet(LS.miss,arr);
  renderMiss(); setStatus("Miss saved", true);
});
byId("mi_reset").addEventListener("click", ()=>{
  if (!confirm("Reset ALL miss inspections?")) return;
  lsSet(LS.miss,[]); renderMiss(); setStatus("Miss cleared", true);
});

// ---------- initial load ----------
async function boot(){
  byId("status").textContent = "Fetching data…";
  const data = await fetchDashboard();
  renderScanners(data);
  renderClassifications(data);
  renderCarriers();
  renderRacks();
  renderMiss();
}
byId("refreshBtn").addEventListener("click", boot);
boot();
// auto refresh every 15 minutes
setInterval(boot, 15*60*1000);
