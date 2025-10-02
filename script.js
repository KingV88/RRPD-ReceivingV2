/* ====== State ====== */
const S = JSON.parse(localStorage.getItem("dax_state_v1")||"{}");
const state = Object.assign({
  scannerGoal: 400,
  ratioTarget: 100, // fixed per your request
  scannersDaily: {},      // { 'YYYY-MM-DD': { name: count } }
  carriersDaily: {},      // { 'YYYY-MM-DD': { FedEx, UPS, USPS, Other } }
  racksDaily: {},         // { 'YYYY-MM-DD': { racks, core_racks, eracks, core_eracks, ax_g, ax_u, ds_g, ds_u, gb_g, gb_u } }
  miss: [],               // [{date,scanner,count,reason}]
  quiz: [
    {q:"What must stay with each package?", opts:["Labels/tracking","Only the part","Nothing","Bubble wrap"], ans:0},
    {q:"If unsure, you should…", opts:["Guess","Ignore","Ask supervisor","Ask customer"], ans:2},
    {q:"Core Rack indicates…", opts:["Brand new","Return/core category","Electric only","Damaged"], ans:1},
    {q:"Before opening a box…", opts:["Throw it","Inspect it","Skip it","Scan later"], ans:1}
  ]
}, S);
const save = ()=>localStorage.setItem("dax_state_v1", JSON.stringify(state));
const today = ()=> new Date().toISOString().slice(0,10);

/* ====== Helpers ====== */
const $ = s=>document.querySelector(s);
const $$ = s=>document.querySelectorAll(s);
const toast = m=>{ const t=$("#toast"); t.textContent=m; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),1600); };
const sum = arr=> arr.reduce((a,b)=>a+(+b||0),0);

/* ====== Navigation + theme ====== */
function openPanel(id){
  $$(".panel").forEach(p=>p.classList.remove("active"));
  $("#"+id).classList.add("active");
  $$(".nav-btn").forEach(b=> b.classList.toggle("active", b.dataset.panel===id));
  document.body.className = ""; // reset
  document.body.classList.add("theme-"+id);
}
$$(".nav-btn").forEach(b=>{
  b.addEventListener("click", ()=> openPanel(b.dataset.panel));
});

/* ====== CHART helpers ====== */
const CH = {};
function chart(id, cfg){
  const ctx = $("#"+id);
  if(!ctx) return;
  if(CH[id]) CH[id].destroy();
  CH[id] = new Chart(ctx, cfg);
}
function last7() {
  const days=[];
  for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().slice(0,10)); }
  return days;
}

/* ====== HOME (weekly hub) ====== */
function renderHome(){
  const tk = today();
  // goal bar (scanners)
  const todayScansMap = state.scannersDaily[tk] || {};
  const scansToday = Object.values(todayScansMap).reduce((a,b)=>a+b,0);
  const pctGoal = state.scannerGoal? Math.min(100, Math.round(scansToday/state.scannerGoal*100)) : 0;
  const goalBar = $("#bar_scanner_goal");
  goalBar.style.width = pctGoal+"%";
  goalBar.classList.toggle("goal-ok", scansToday>=state.scannerGoal);
  $("#txt_scanner_goal").textContent = `${scansToday} / ${state.scannerGoal} (${pctGoal}%)`;

  // ratio bar
  const carToday = state.carriersDaily[tk] || {FedEx:0,UPS:0,USPS:0,Other:0};
  const received = sum(Object.values(carToday));
  const ratio = received? Math.round((scansToday/received)*100) : 0;
  const ratioBar = $("#bar_ratio");
  ratioBar.style.width = Math.min(100, ratio)+"%";
  ratioBar.classList.toggle("goal-ok", ratio>=state.ratioTarget);
  $("#txt_ratio").textContent = `${ratio}% (target ${state.ratioTarget}%)`;

  // weekly scanners (total per day)
  const days = last7();
  const scTotals = days.map(k=>{
    const m=state.scannersDaily[k]||{};
    return Object.values(m).reduce((a,b)=>a+b,0);
  });
  chart("wk_scanners", {
    type:"bar",
    data:{ labels:days, datasets:[{label:"Scans", data:scTotals, backgroundColor:"#0ea5e9"}]},
    options:{responsive:true, scales:{y:{beginAtZero:true}}, plugins:{legend:{display:false}}}
  });

  // weekly carriers (total per day)
  const carTotals = days.map(k=>{
    const m=state.carriersDaily[k]||{FedEx:0,UPS:0,USPS:0,Other:0};
    return sum(Object.values(m));
  });
  chart("wk_carriers", {
    type:"bar",
    data:{ labels:days, datasets:[{label:"Received", data:carTotals, backgroundColor:"#f59e0b"}]},
    options:{responsive:true, scales:{y:{beginAtZero:true}}, plugins:{legend:{display:false}}}
  });

  // weekly racks (grouped of 10 series)
  const cols = [
    ["Racks","racks"],["Core Racks","core_racks"],
    ["E-Racks","eracks"],["Core E-Racks","core_eracks"],
    ["Axles G","ax_g"],["Axles U","ax_u"],
    ["DS G","ds_g"],["DS U","ds_u"],
    ["GB G","gb_g"],["GB U","gb_u"]
  ];
  const ds = cols.map((c,i)=>({
    label:c[0],
    data: days.map(k=> (state.racksDaily[k]||{})[c[1]]||0 ),
    backgroundColor:`hsl(${(i*36)%360} 70% 50%)`
  }));
  chart("wk_racks", {
    type:"bar",
    data:{ labels:days, datasets:ds },
    options:{responsive:true, scales:{y:{beginAtZero:true}}, plugins:{legend:{position:"bottom"}}}
  });
}

/* ====== SCANNERS (daily) ====== */
$("#scanner_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  const name = $("#sc_name").value.trim();
  const count = +$("#sc_count").value||0;
  if(!name) return;
  const tk = today();
  if(!state.scannersDaily[tk]) state.scannersDaily[tk]={};
  state.scannersDaily[tk][name] = (state.scannersDaily[tk][name]||0)+count;
  save(); renderScanners(); renderHome();
  e.target.reset();
  toast("Saved scans");
});
function renderScanners(){
  const tk=today();
  const m = state.scannersDaily[tk]||{};
  const names = Object.keys(m);
  const vals = Object.values(m);

  chart("sc_today_donut", {
    type:"doughnut",
    data:{ labels:names, datasets:[{ data:vals }] },
    options:{plugins:{legend:{position:"bottom"}}}
  });
  chart("sc_today_bar", {
    type:"bar",
    data:{ labels:names, datasets:[{ label:"Scans", data:vals, backgroundColor:"#0ea5e9"}] },
    options:{responsive:true, scales:{y:{beginAtZero:true}}, plugins:{legend:{display:false}}}
  });
}

/* ====== CARRIERS (daily) ====== */
$("#car_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  const fedex=+$("#c_fedex").value||0;
  const ups  =+$("#c_ups").value||0;
  const usps =+$("#c_usps").value||0;
  const other=+$("#c_other").value||0;
  const tk=today();
  state.carriersDaily[tk] = {FedEx:fedex, UPS:ups, USPS:usps, Other:other};
  save(); renderCarriers(); renderHome();
  e.target.reset();
  toast("Saved carriers");
});
function renderCarriers(){
  const tk=today();
  const c = state.carriersDaily[tk]||{FedEx:0,UPS:0,USPS:0,Other:0};
  const labels = ["FedEx","UPS","USPS","Other"];
  const vals   = [c.FedEx,c.UPS,c.USPS,c.Other];

  chart("car_today_donut", {
    type:"doughnut",
    data:{ labels, datasets:[{ data:vals }] },
    options:{plugins:{legend:{position:"bottom"}}}
  });
  chart("car_today_bar", {
    type:"bar",
    data:{ labels, datasets:[{ label:"Packages", data:vals, backgroundColor:"#f59e0b"}] },
    options:{responsive:true, scales:{y:{beginAtZero:true}}, plugins:{legend:{display:false}}}
  });
}

/* ====== RACKS (daily donuts) ====== */
$("#racks_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  const tk=today();
  const v = id=> +$(id).value||0;
  state.racksDaily[tk] = {
    racks:v("#r_racks"), core_racks:v("#r_core_racks"),
    eracks:v("#r_eracks"), core_eracks:v("#r_core_eracks"),
    ax_g:v("#r_ax_g"), ax_u:v("#r_ax_u"),
    ds_g:v("#r_ds_g"), ds_u:v("#r_ds_u"),
    gb_g:v("#r_gb_g"), gb_u:v("#r_gb_u"),
  };
  save(); renderRacks(); renderHome();
  toast("Saved racks");
});
function renderRacks(){
  const tk=today();
  const d=state.racksDaily[tk]||{racks:0,core_racks:0,eracks:0,core_eracks:0,ax_g:0,ax_u:0,ds_g:0,ds_u:0,gb_g:0,gb_u:0};

  chart("d_racks",{type:"doughnut",data:{labels:["Racks","Core"],datasets:[{data:[d.racks,d.core_racks]}]},options:{plugins:{legend:{position:"bottom"}}}});
  chart("d_eracks",{type:"doughnut",data:{labels:["E-Racks","Core E-Racks"],datasets:[{data:[d.eracks,d.core_eracks]}]},options:{plugins:{legend:{position:"bottom"}}}});
  chart("d_axles",{type:"doughnut",data:{labels:["Good","Used"],datasets:[{data:[d.ax_g,d.ax_u]}]},options:{plugins:{legend:{position:"bottom"}}}});
  chart("d_ds",   {type:"doughnut",data:{labels:["Good","Used"],datasets:[{data:[d.ds_g,d.ds_u]}]},options:{plugins:{legend:{position:"bottom"}}}});
  chart("d_gb",   {type:"doughnut",data:{labels:["Good","Used"],datasets:[{data:[d.gb_g,d.gb_u]}]},options:{plugins:{legend:{position:"bottom"}}}});
}

/* ====== MISS (today only) ====== */
$("#miss_form").addEventListener("submit",(e)=>{
  e.preventDefault();
  const rec={ date:today(), scanner:$("#m_name").value.trim()||"—", count:+$("#m_count").value||1, reason:$("#m_reason").value };
  state.miss.push(rec); save(); renderMiss(); toast("Logged miss");
  e.target.reset();
});
function renderMiss(){
  const tk=today();
  const list = state.miss.filter(x=>x.date===tk);
  // donut by reason
  const reasons={};
  list.forEach(x=> reasons[x.reason]=(reasons[x.reason]||0)+x.count);
  chart("miss_today",{
    type:"doughnut",
    data:{ labels:Object.keys(reasons), datasets:[{ data:Object.values(reasons) }]},
    options:{plugins:{legend:{position:"bottom"}}}
  });
  // table
  const rows = list.map(x=> `<tr><td>${x.scanner}</td><td>${x.count}</td><td>${x.reason}</td></tr>`).join("");
  $("#miss_table").innerHTML = `<thead><tr><th>Scanner</th><th>Count</th><th>Reason</th></tr></thead><tbody>${rows||""}</tbody>`;
}

/* ====== QUIZ ====== */
let qIdx=0, qAns={};
function renderQuiz(){
  const q = state.quiz[qIdx];
  if(!q){ $("#quiz_q").textContent="No questions defined."; $("#quiz_opts").innerHTML=""; return; }
  $("#quiz_q").textContent = (qIdx+1)+". "+q.q;
  $("#quiz_opts").innerHTML = q.opts.map((o,i)=>`
    <label><input type="radio" name="q" value="${i}" ${qAns[qIdx]==i?"checked":""}/> ${o}</label>
  `).join("");
}
$("#quiz_prev").addEventListener("click",()=>{
  if(qIdx>0){ qIdx--; renderQuiz(); }
});
$("#quiz_next").addEventListener("click",()=>{
  const sel = document.querySelector('input[name="q"]:checked'); if(sel) qAns[qIdx]=+sel.value;
  if(qIdx < state.quiz.length-1){ qIdx++; renderQuiz(); }
});
$("#quiz_submit").addEventListener("click",()=>{
  const sel = document.querySelector('input[name="q"]:checked'); if(sel) qAns[qIdx]=+sel.value;
  let score=0; state.quiz.forEach((q,i)=>{ if(qAns[i]===q.ans) score++; });
  $("#quiz_result").textContent = `Score: ${score}/${state.quiz.length} (${Math.round(score/state.quiz.length*100)}%)`;
  toast("Quiz submitted");
});
renderQuiz();

/* ====== SETTINGS ====== */
$("#goal_scanners").value = state.scannerGoal;
$("#save_goal").addEventListener("click",()=>{
  const v=+$("#goal_scanners").value||0;
  state.scannerGoal=v; save(); renderHome(); toast("Goal saved");
});
$("#print_btn").addEventListener("click",()=>{
  $("#rep_date").textContent = new Date().toLocaleDateString();
  const tk=today();
  const scansToday = Object.values(state.scannersDaily[tk]||{}).reduce((a,b)=>a+b,0);
  const carToday = state.carriersDaily[tk]||{FedEx:0,UPS:0,USPS:0,Other:0};
  const received = sum(Object.values(carToday));
  const pctGoal = state.scannerGoal? Math.min(100, Math.round(scansToday/state.scannerGoal*100)) : 0;
  const ratio = received? Math.round((scansToday/received)*100) : 0;
  $("#rep_bar_scanners").style.width = pctGoal+"%";
  $("#rep_bar_scanners").classList.toggle("goal-ok", scansToday>=state.scannerGoal);
  $("#rep_txt_scanners").textContent = `${scansToday} / ${state.scannerGoal} (${pctGoal}%)`;
  $("#rep_bar_ratio").style.width = Math.min(100,ratio)+"%";
  $("#rep_bar_ratio").classList.toggle("goal-ok", ratio>=100);
  $("#rep_txt_ratio").textContent = `${ratio}% (target 100%)`;
  window.print();
});

/* ====== Initial renders ====== */
function renderAll(){
  renderHome();
  renderScanners();
  renderCarriers();
  renderRacks();
  renderMiss();
}
renderAll();
