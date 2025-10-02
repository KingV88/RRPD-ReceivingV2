/* =====================================================
   RRPD Receiving — Detroit Axle
   Full build: Carriers, Scanners, Racks, Miss, Training,
   Goals, Print (admin), Dark mode, Home dashboard
===================================================== */

// ---------- State ----------
const stateDefaults = {
  isAdmin: false,
  adminUser: "",
  adminPassHash: "", // (not used, simple demo)
  goals: { carriers: 500, scanners: 400, racks: 50, miss: 5 },

  // Carriers by day
  carriersDaily: { /* 'YYYY-MM-DD': {fedex,ups,usps,other} */ },

  // Scanners: daily map + all-time list
  scannersDaily: { /* 'YYYY-MM-DD': { name: count, ... } */ },
  scannersAllTime: [], // [{name,total}]

  // Racks by day (10 fields consolidated)
  racksDaily: {
    // 'YYYY-MM-DD': { racks, core_racks, eracks, core_eracks, ax_g, ax_u, ds_g, ds_u, gb_g, gb_u }
  },

  // Miss inspections: list
  missInspections: [
    // { date, scanner, count, reason }
  ],

  // Quiz
  quizQuestions: [
    { question: "What should you do if a rack is damaged?", options: ["Ignore it", "Report it", "Throw it away", "Hide it"], answer: 1 },
    { question: "What must be kept from every package?", options: ["Labels / tracking", "Only the part", "Nothing", "Bubble wrap"], answer: 0 },
    { question: "Core Rack means…", options: ["Brand new", "Broken/unusable", "Return core category", "Electric only"], answer: 2 },
    { question: "If unsure, who do you ask?", options: ["Customer", "Supervisor", "No one", "Internet"], answer: 1 }
  ],
  training: { lastScore: null, attempts: 0, lastDate: null },

  // Prefs
  dark: false
};
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem("rrpd_state_v3");
    if (!raw) return { ...stateDefaults };
    const parsed = JSON.parse(raw);
    // merge defaults for any new keys
    return deepMerge({ ...stateDefaults }, parsed);
  } catch {
    return { ...stateDefaults };
  }
}
function saveState() { localStorage.setItem("rrpd_state_v3", JSON.stringify(state)); }

// Deep merge small helper
function deepMerge(base, next) {
  for (const k in next) {
    if (next[k] && typeof next[k] === "object" && !Array.isArray(next[k])) {
      base[k] = deepMerge(base[k] || {}, next[k]);
    } else {
      base[k] = next[k];
    }
  }
  return base;
}
const todayKey = () => new Date().toISOString().slice(0,10);

// ---------- UI Helpers ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
function showToast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),1800); }

function openPanel(id){
  $$(".panel").forEach(p=>p.classList.remove("active"));
  $("#"+id).classList.add("active");
  $$(".nav-btn").forEach(b=> b.classList.toggle("active", b.dataset.panel===id));
}
$$(".nav-btn").forEach(b=> b.addEventListener("click", ()=> openPanel(b.dataset.panel)));

// Date + dark mode
$("#today_date").textContent = new Date().toLocaleDateString();
(function initDark(){
  const toggle=$("#pref_dark");
  const saved=localStorage.getItem("pref_dark");
  if(saved==="true" || state.dark){ document.body.classList.add("dark"); toggle.checked=true; }
  toggle.addEventListener("change",()=>{
    document.body.classList.toggle("dark", toggle.checked);
    state.dark = toggle.checked; localStorage.setItem("pref_dark", toggle.checked?"true":"false"); saveState();
  });
})();

// Admin gates
function setAdminMode(flag){
  state.isAdmin = !!flag; saveState();
  $("#admin_hint").textContent = state.isAdmin ? (state.adminUser || "Admin") : "—";
  $$(".admin-only").forEach(el=> el.style.display = state.isAdmin ? "block" : "none");
}
$("#admin_login").addEventListener("click", ()=>{
  const u=$("#admin_user").value.trim();
  const p=$("#admin_pass").value.trim();
  if(!u || !p) return showToast("Enter admin credentials");
  state.adminUser = u;
  // Simple demo password gate:
  if(p !== "DAX2025") return showToast("Wrong password");
  setAdminMode(true);
  showToast("Admin logged in");
});
$("#admin_logout").addEventListener("click", ()=>{
  setAdminMode(false);
  showToast("Logged out");
});
setAdminMode(state.isAdmin);

// ---------- Goals UI ----------
function makeGoalLine(container, current, goal){
  const pct = goal>0 ? Math.min(100, Math.round((current/goal)*100)) : 0;
  container.innerHTML = `
    <div class="small muted">Progress: ${current} / ${goal} (${pct}%)</div>
    <div class="progress"><div style="width:${pct}%"></div></div>
  `;
}
function updateAllGoalBars(){
  const tk = todayKey();

  // Carriers today sum
  const cd = state.carriersDaily[tk] || {fedex:0,ups:0,usps:0,other:0};
  const carriersToday = cd.fedex + cd.ups + cd.usps + cd.other;

  // Scans today sum
  const sd = state.scannersDaily[tk] || {};
  const scansToday = Object.values(sd).reduce((a,b)=>a+b,0);

  // Racks today (sum of all 10 inputs, or only "good" if you prefer)
  const rd = state.racksDaily[tk] || {};
  const racksToday = (rd.racks||0)+(rd.core_racks||0)+(rd.eracks||0)+(rd.core_eracks||0)+(rd.ax_g||0)+(rd.ax_u||0)+(rd.ds_g||0)+(rd.ds_u||0)+(rd.gb_g||0)+(rd.gb_u||0);

  // Miss today
  const missToday = (state.missInspections||[]).filter(x=>x.date===tk).reduce((a,x)=>a+(x.count||0),0);

  // Home dashboard tiles
  $("#home_carriers_today").textContent = carriersToday;
  $("#home_scans_today").textContent = scansToday;
  $("#home_racks_today").textContent = racksToday;
  $("#home_miss_today").textContent = missToday;

  // Goal lines in panels
  makeGoalLine($("#goal_carriers_line"), carriersToday, state.goals.carriers);
  makeGoalLine($("#goal_scanners_line"), scansToday, state.goals.scanners);
  makeGoalLine($("#goal_racks_line"), racksToday, state.goals.racks);
  makeGoalLine($("#goal_miss_line"), missToday, state.goals.miss);

  // Home goals mini list
  $("#home_goals_wrap").innerHTML = `
    <div class="goalrow"><strong>Carriers</strong> — ${carriersToday}/${state.goals.carriers}<div class="progress"><div style="width:${state.goals.carriers?Math.min(100,carriersToday/state.goals.carriers*100):0}%"></div></div></div>
    <div class="goalrow"><strong>Scanners</strong> — ${scansToday}/${state.goals.scanners}<div class="progress"><div style="width:${state.goals.scanners?Math.min(100,scansToday/state.goals.scanners*100):0}%"></div></div></div>
    <div class="goalrow"><strong>Racks</strong> — ${racksToday}/${state.goals.racks}<div class="progress"><div style="width:${state.goals.racks?Math.min(100,racksToday/state.goals.racks*100):0}%"></div></div></div>
    <div class="goalrow"><strong>Miss</strong> — ${missToday}/${state.goals.miss}<div class="progress"><div style="width:${state.goals.miss?Math.min(100,missToday/state.goals.miss*100):0}%"></div></div></div>
  `;

  // Top scanner of today
  let topName="—", topVal=0;
  for(const [n,v] of Object.entries(sd)){ if(v>topVal){topVal=v; topName=n;} }
  $("#home_top_scanner").textContent = topVal>0 ? `${topName} (${topVal} scans)` : "Waiting for results…";

  // Update print report fields
  $("#reportDate").textContent = new Date().toLocaleDateString();
  $("#goalCarriers_txt").textContent = `${carriersToday} / ${state.goals.carriers}`;
  $("#goalScanners_txt").textContent = `${scansToday} / ${state.goals.scanners}`;
  $("#goalRacks_txt").textContent = `${racksToday} / ${state.goals.racks}`;
  $("#goalMiss_txt").textContent = `${missToday} / ${state.goals.miss}`;
  $("#barCarriers").style.width = `${state.goals.carriers?Math.min(100,carriersToday/state.goals.carriers*100):0}%`;
  $("#barScanners").style.width = `${state.goals.scanners?Math.min(100,scansToday/state.goals.scanners*100):0}%`;
  $("#barRacks").style.width = `${state.goals.racks?Math.min(100,racksToday/state.goals.racks*100):0}%`;
  $("#barMiss").style.width = `${state.goals.miss?Math.min(100,missToday/state.goals.miss*100):0}%`;
}
$("#save_goals").addEventListener("click", ()=>{
  state.goals.carriers = +$("#goal_carriers").value || 0;
  state.goals.scanners = +$("#goal_scanners").value || 0;
  state.goals.racks = +$("#goal_racks").value || 0;
  state.goals.miss = +$("#goal_miss").value || 0;
  saveState(); updateAllGoalBars(); showToast("Goals saved");
});
// Initialize goal inputs
$("#goal_carriers").value = state.goals.carriers;
$("#goal_scanners").value = state.goals.scanners;
$("#goal_racks").value = state.goals.racks;
$("#goal_miss").value = state.goals.miss;

// ---------- Chart helpers ----------
const CH = {}; // chart instances by id
function drawChart(id, cfg){
  const ctx = $("#"+id);
  if(!ctx) return;
  if(CH[id]){ CH[id].destroy(); }
  CH[id] = new Chart(ctx, cfg);
}
function color(i){ return `hsl(${(i*57)%360} 70% 50%)`; }

// ---------- Carriers ----------
$("#carrier_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  const fedex=+$("#fedex_input").value||0;
  const ups=+$("#ups_input").value||0;
  const usps=+$("#usps_input").value||0;
  const other=+$("#other_input").value||0;
  state.carriersDaily[todayKey()] = {fedex, ups, usps, other};
  saveState();
  renderCarriers();
  updateAllGoalBars();
  showToast("Carriers saved");
});
function renderCarriers(){
  const tk=todayKey();
  const d=state.carriersDaily[tk]||{fedex:0,ups:0,usps:0,other:0};

  // Today donut
  drawChart("carriers_donut", {
    type:"doughnut",
    data:{ labels:["FedEx","UPS","USPS","Other"], datasets:[{ data:[d.fedex,d.ups,d.usps,d.other] }] },
    options:{ plugins:{legend:{position:"bottom"}, title:{display:true,text:`Today (${tk})`}}}
  });

  // Weekly grouped bars
  const days=[], fed=[], up=[], us=[], ot=[];
  for(let i=6;i>=0;i--){
    const dt=new Date(); dt.setDate(dt.getDate()-i);
    const k=dt.toISOString().slice(0,10);
    const v=state.carriersDaily[k]||{fedex:0,ups:0,usps:0,other:0};
    days.push(k); fed.push(v.fedex); up.push(v.ups); us.push(v.usps); ot.push(v.other);
  }
  drawChart("carriers_weekly", {
    type:"bar",
    data:{
      labels:days,
      datasets:[
        {label:"FedEx", data:fed, backgroundColor:"#3b82f6"},
        {label:"UPS", data:up, backgroundColor:"#f59e0b"},
        {label:"USPS", data:us, backgroundColor:"#10b981"},
        {label:"Other", data:ot, backgroundColor:"#6b7280"}
      ]
    },
    options:{responsive:true, plugins:{legend:{position:"bottom"}, title:{display:true,text:"Carriers — Last 7 Days"}}, scales:{y:{beginAtZero:true}}}
  });

  // Today table
  $("#carriers_table").innerHTML = `
    <tr><th>Carrier</th><th>Count</th></tr>
    <tr><td>FedEx</td><td>${d.fedex}</td></tr>
    <tr><td>UPS</td><td>${d.ups}</td></tr>
    <tr><td>USPS</td><td>${d.usps}</td></tr>
    <tr><td>Other</td><td>${d.other}</td></tr>
  `;
}

// ---------- Scanners ----------
$("#scanner_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  const name=$("#scanner_name").value.trim()||"Unknown";
  const count=+$("#scanner_count").value||0;
  const tk=todayKey();
  if(!state.scannersDaily[tk]) state.scannersDaily[tk]={};
  state.scannersDaily[tk][name]=(state.scannersDaily[tk][name]||0)+count;

  // all-time add
  let rec=state.scannersAllTime.find(s=>s.name===name);
  if(rec) rec.total += count; else state.scannersAllTime.push({name,total:count});

  saveState();
  renderScanners();
  updateAllGoalBars();
  showToast("Scans logged");
});

// Admin adjust (silent)
$("#scanner_adjust_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  if(!state.isAdmin) return;
  const n=$("#adjust_scanner_name").value.trim(); if(!n) return;
  const c=+$("#adjust_scanner_count").value||0;
  const dk=$("#adjust_scanner_date").value||todayKey();
  if(!state.scannersDaily[dk]) state.scannersDaily[dk]={};
  state.scannersDaily[dk][n]=(state.scannersDaily[dk][n]||0)+c;
  let rec=state.scannersAllTime.find(s=>s.name===n);
  if(rec) rec.total+=c; else state.scannersAllTime.push({name:n,total:c});
  saveState(); renderScanners(); updateAllGoalBars();
});

// Rebuild all-time if empty but we have daily history
function rebuildScannersAllTime(){
  const totals={};
  for(const [date,map] of Object.entries(state.scannersDaily||{})){
    for(const [n,c] of Object.entries(map)){ totals[n]=(totals[n]||0)+(c||0); }
  }
  state.scannersAllTime = Object.entries(totals).map(([name,total])=>({name,total}));
}
if((state.scannersAllTime||[]).length===0 && Object.keys(state.scannersDaily||{}).length>0){
  rebuildScannersAllTime(); saveState();
}

function renderScanners(){
  const tk=todayKey();
  const today=state.scannersDaily[tk]||{};
  const names=Object.keys(today), vals=Object.values(today);

  // Today donut
  drawChart("scanners_donut", {
    type:"doughnut",
    data:{labels:names, datasets:[{data:vals}]},
    options:{plugins:{legend:{position:"bottom"}, title:{display:true,text:`Scans Today (${tk})`}}}
  });

  // Weekly grouped
  const days=[]; const series = {}; // name -> [7]
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const k=d.toISOString().slice(0,10); days.push(k);
    const map=state.scannersDaily[k]||{};
    for(const [n,c] of Object.entries(map)){
      if(!series[n]) series[n]=Array(7).fill(0);
      series[n][6-i]=c;
    }
  }
  const datasets=Object.entries(series).map(([n,arr],i)=>({label:n, data:arr, backgroundColor:color(i)}));
  drawChart("scanners_weekly",{
    type:"bar",
    data:{labels:days, datasets},
    options:{responsive:true, plugins:{legend:{position:"bottom"}, title:{display:true,text:"Scans — Last 7 Days"}}, scales:{y:{beginAtZero:true}}}
  });

  // Leaderboard table
  const sorted=[...(state.scannersAllTime||[])].sort((a,b)=>b.total-a.total);
  let rows = `<tr><th>Rank</th><th>Scanner</th><th>Total</th></tr>`;
  sorted.forEach((s,i)=>{
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
    rows += `<tr><td>${i+1} ${medal}</td><td>${s.name}</td><td>${s.total}</td></tr>`;
  });
  $("#scanners_table").innerHTML = rows;

  // All-time donut
  drawChart("scanners_alltime",{
    type:"doughnut",
    data:{ labels:sorted.map(s=>s.name), datasets:[{ data:sorted.map(s=>s.total) }] },
    options:{plugins:{legend:{position:"bottom"}, title:{display:true,text:"All-Time Scans Share"}}}
  });
}

// ---------- Racks ----------
$("#racks_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  const v=(id)=> +$("#"+id).value||0;
  state.racksDaily[todayKey()] = {
    racks:v("in_racks"),
    core_racks:v("in_core_racks"),
    eracks:v("in_eracks"),
    core_eracks:v("in_core_eracks"),
    ax_g:v("in_ax_good"),
    ax_u:v("in_ax_used"),
    ds_g:v("in_ds_good"),
    ds_u:v("in_ds_used"),
    gb_g:v("in_gb_good"),
    gb_u:v("in_gb_used"),
  };
  saveState(); renderRacks(); updateAllGoalBars(); showToast("Racks saved");
});

function renderRacks(){
  const tk=todayKey();
  const d=state.racksDaily[tk]||{racks:0,core_racks:0,eracks:0,core_eracks:0,ax_g:0,ax_u:0,ds_g:0,ds_u:0,gb_g:0,gb_u:0};

  // 5 donuts
  drawChart("donut_racks", {type:"doughnut", data:{labels:["Racks","Core Racks"],datasets:[{data:[d.racks, d.core_racks]}]}, options:{plugins:{legend:{position:"bottom"}}}});
  drawChart("donut_eracks",{type:"doughnut", data:{labels:["E-Racks","Core E-Racks"],datasets:[{data:[d.eracks, d.core_eracks]}]}, options:{plugins:{legend:{position:"bottom"}}}});
  drawChart("donut_axles", {type:"doughnut", data:{labels:["Good","Used"],datasets:[{data:[d.ax_g, d.ax_u]}]}, options:{plugins:{legend:{position:"bottom"}}}});
  drawChart("donut_ds",    {type:"doughnut", data:{labels:["Good","Used"],datasets:[{data:[d.ds_g, d.ds_u]}]}, options:{plugins:{legend:{position:"bottom"}}}});
  drawChart("donut_gb",    {type:"doughnut", data:{labels:["Good","Used"],datasets:[{data:[d.gb_g, d.gb_u]}]}, options:{plugins:{legend:{position:"bottom"}}}});

  // Weekly grouped — all 10 series
  const days=[]; const cols=[
    ["Racks","racks"], ["Core Racks","core_racks"],
    ["E-Racks","eracks"], ["Core E-Racks","core_eracks"],
    ["Axles Good","ax_g"], ["Axles Used","ax_u"],
    ["DS Good","ds_g"], ["DS Used","ds_u"],
    ["GB Good","gb_g"], ["GB Used","gb_u"]
  ];
  const ds = cols.map((c,i)=>({label:c[0], data:[], backgroundColor:color(i)}));
  for(let i=6;i>=0;i--){
    const dt=new Date(); dt.setDate(dt.getDate()-i);
    const k=dt.toISOString().slice(0,10); days.push(k);
    const val=state.racksDaily[k]||{};
    ds.forEach((series,idx)=>{
      const key=cols[idx][1];
      series.data.push(val[key]||0);
    });
  }
  drawChart("racks_weekly_grouped",{
    type:"bar",
    data:{labels:days, datasets:ds},
    options:{responsive:true, plugins:{legend:{position:"bottom"}, title:{display:true,text:"Last 7 Days (Grouped)"}}, scales:{y:{beginAtZero:true}}}
  });
}

// ---------- Miss Inspections ----------
$("#miss_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  if(!state.isAdmin) return;
  const rec={
    date: todayKey(),
    scanner: $("#miss_scanner").value.trim()||"Unknown",
    count: +$("#miss_count").value||1,
    reason: $("#miss_reason").value
  };
  state.missInspections.push(rec);
  saveState(); renderMiss(); updateAllGoalBars(); showToast("Miss added");
});

function renderMiss(){
  const tk=todayKey();
  const todayList=(state.missInspections||[]).filter(x=>x.date===tk);

  // Today donut by reason
  const byReason={};
  todayList.forEach(x=> byReason[x.reason]=(byReason[x.reason]||0)+x.count);
  const rLabels=Object.keys(byReason), rVals=Object.values(byReason);
  drawChart("miss_today_donut",{type:"doughnut", data:{labels:rLabels, datasets:[{data:rVals}]}, options:{plugins:{legend:{position:"bottom"}}}});

  // Weekly grouped by scanner
  const days=[]; const mapByScanner={};
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const k=d.toISOString().slice(0,10); days.push(k);
    const list=(state.missInspections||[]).filter(x=>x.date===k);
    const byScan={};
    list.forEach(x=> byScan[x.scanner]=(byScan[x.scanner]||0)+x.count);
    for(const [name,c] of Object.entries(byScan)){
      if(!mapByScanner[name]) mapByScanner[name]=Array(7).fill(0);
      mapByScanner[name][6-i]=c;
    }
  }
  const datasets=Object.entries(mapByScanner).map(([n,arr],i)=>({label:n,data:arr,backgroundColor:color(i)}));
  drawChart("miss_weekly_scanner",{type:"bar", data:{labels:days,datasets}, options:{plugins:{legend:{position:"bottom"}, title:{display:true,text:"Miss — Last 7 Days (by Scanner)"}}, scales:{y:{beginAtZero:true}}}});

  // Today table
  let rows="<tr><th>Scanner</th><th>Count</th><th>Reason</th></tr>";
  todayList.forEach(x=> rows+=`<tr><td>${x.scanner}</td><td>${x.count}</td><td>${x.reason}</td></tr>`);
  $("#miss_table").innerHTML = rows;
}

// ---------- Training & Quiz (one at a time) ----------
let quizIndex=0; const quizAnswers = {};
function renderQuiz(){
  const q=state.quizQuestions[quizIndex];
  if(!q){ $("#quiz_q").textContent="No questions yet."; $("#quiz_opts").innerHTML=""; return; }
  $("#quiz_q").textContent = `${quizIndex+1}. ${q.question}`;
  $("#quiz_opts").innerHTML = q.options.map((opt,i)=>`
    <label><input type="radio" name="quiz_opt" value="${i}" ${quizAnswers[quizIndex]==i?"checked":""}> ${opt}</label>
  `).join("");
}
$("#quiz_prev").addEventListener("click", ()=>{ if(quizIndex>0){ quizIndex--; renderQuiz(); }});
$("#quiz_next").addEventListener("click", ()=>{
  const sel=document.querySelector('input[name="quiz_opt"]:checked');
  if(sel) quizAnswers[quizIndex]=+sel.value;
  if(quizIndex < state.quizQuestions.length-1){ quizIndex++; renderQuiz(); }
});
$("#quiz_submit").addEventListener("click", ()=>{
  const sel=document.querySelector('input[name="quiz_opt"]:checked');
  if(sel) quizAnswers[quizIndex]=+sel.value;
  let score=0;
  state.quizQuestions.forEach((q,i)=>{ if(quizAnswers[i]===q.answer) score++; });
  const pct=Math.round((score/state.quizQuestions.length)*100);
  state.training = { lastScore:pct, attempts:(state.training.attempts||0)+1, lastDate: todayKey() };
  saveState();
  $("#quiz_result").textContent = `Score: ${score}/${state.quizQuestions.length} (${pct}%)`;
  showToast("Quiz submitted");
});
renderQuiz();

// Admin: add/update question
$("#quiz_add_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  if(!state.isAdmin) return;
  const q=$("#qa_text").value.trim(); if(!q) return;
  const a=+$("#qa_answer").value||0;
  const o0=$("#qa_o0").value.trim(), o1=$("#qa_o1").value.trim(), o2=$("#qa_o2").value.trim(), o3=$("#qa_o3").value.trim();
  const opts=[o0,o1,o2,o3].filter(x=>x);
  if(opts.length<2) return showToast("Need 2+ options");
  // If question exists, update; else push
  const idx = state.quizQuestions.findIndex(x=>x.question===q);
  const rec = {question:q, options:opts, answer:Math.max(0,Math.min(a,opts.length-1))};
  if(idx>=0) state.quizQuestions[idx]=rec; else state.quizQuestions.push(rec);
  saveState(); renderQuizList(); showToast("Quiz updated");
});
function renderQuizList(){
  $("#quiz_list").innerHTML = state.quizQuestions.map((q,i)=>`<div>${i+1}. ${q.question} <span class="muted">[${q.options.join(" / ")}] • Ans: ${q.answer}</span></div>`).join("");
}
renderQuizList();

// ---------- Settings: Export/Import/Reset ----------
$("#export_json").addEventListener("click", ()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`rrpd_export_${todayKey()}.json`; a.click();
});
$("#import_json").addEventListener("change", (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const obj=JSON.parse(reader.result);
      state = deepMerge({ ...stateDefaults }, obj); saveState();
      // re-render everything
      renderAll(); showToast("Import complete");
    }catch{ showToast("Invalid JSON"); }
  };
  reader.readAsText(f);
});
$("#reset_all").addEventListener("click", ()=>{
  if(!state.isAdmin) return;
  if(!confirm("Reset ALL local data?")) return;
  state = { ...stateDefaults }; saveState(); renderAll(); setAdminMode(false);
  showToast("Local data reset");
});

// ---------- Print button ----------
$("#printReportBtn").addEventListener("click", ()=>{
  // Ensure bars/text are current
  updateAllGoalBars();
  window.print();
});

// ---------- Render all ----------
function renderAll(){
  renderCarriers();
  renderScanners();
  renderRacks();
  renderMiss();
  updateAllGoalBars();
}
renderAll();
