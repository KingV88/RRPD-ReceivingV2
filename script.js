/* ===================================================
   RRPD Frontend Script — Dashboard + Manual Mode
   =================================================== */

// ---- Global Data Holders ----
let RRPD = { data: null, lastUpdated: null };
let REFRESH_TIMER = null;

// ---- Utilities ----
function $(id){ return document.getElementById(id); }
function fmt(n){ return Number(n||0).toLocaleString(); }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.className='toast show'; setTimeout(()=>t.className='toast',2500); }

// ---- Fetch Dashboard ----
async function loadDashboard(manual=false){
  const spin = $('loading');
  if(spin) spin.style.display='block';
  try{
    const res = await fetch('/api/dashboard?_=' + Date.now());
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || 'Fetch failed');
    RRPD.data=json;
    RRPD.lastUpdated=new Date(json.updated);
    renderDashboard();
    toast(manual?'Data refreshed!':'Auto refresh done.');
  }catch(e){
    console.error(e);
    toast('⚠️ Live fetch failed — using last saved data');
    if(localStorage.getItem('rrpd_cache'))
      RRPD.data = JSON.parse(localStorage.getItem('rrpd_cache'));
  }finally{
    if(spin) spin.style.display='none';
    if(RRPD.data) localStorage.setItem('rrpd_cache',JSON.stringify(RRPD.data));
  }
}

// ---- Renderers ----
function renderDashboard(){
  const d = RRPD.data;
  if(!d) return;

  // --- Scanner Totals ---
  const sDiv=$('scanner_totals');
  const names=Object.keys(d.scannerTotals||{});
  sDiv.innerHTML = names.map(n=>`<tr><td>${n}</td><td>${fmt(d.scannerTotals[n])}</td></tr>`).join('');
  makeChart('scanner_chart','doughnut',names,[{label:'Scans',data:names.map(n=>d.scannerTotals[n])}]);

  // --- Classifications ---
  const cDiv=$('class_table');
  const cls=d.classifications||{};
  cDiv.innerHTML=Object.keys(cls).map(k=>`<tr><td>${k}</td><td>${fmt(cls[k])}</td></tr>`).join('');
  makeChart('class_chart','pie',Object.keys(cls),[{label:'Parts',data:Object.values(cls)}]);

  // --- Trend Chart (Monthly) ---
  const t=d.trend||{};
  const labels=Object.keys(t);
  const goods=labels.map(k=>t[k].Good);
  const others=labels.map(k=>t[k].Other);
  makeChart('trend_chart','bar',labels,[
    {label:'Good',data:goods},
    {label:'Other',data:others}
  ]);

  // --- Missed ---
  const miss=d.missed||[];
  const mDiv=$('miss_table');
  mDiv.innerHTML = miss.slice(0,20).map(m=>`
    <tr>
      <td>${m.created_by||'-'}</td>
      <td>${m.part_number}</td>
      <td>${m.classification}</td>
      <td>${m.status}</td>
    </tr>`).join('');

  $('last_upd').textContent = RRPD.lastUpdated ? RRPD.lastUpdated.toLocaleString() : '—';
}

// ---- Charts Helper ----
const CHS={};
function makeChart(id,type,labels,datasets){
  const ctx=$(id)?.getContext('2d');
  if(!ctx) return;
  if(CHS[id]) CHS[id].destroy();
  CHS[id]=new Chart(ctx,{
    type:type,
    data:{labels,datasets},
    options:{
      responsive:true,
      plugins:{legend:{position:'bottom'}},
      animation:false,
      devicePixelRatio:2
    }
  });
}

// ---- Manual Add ----
$('manual_add_btn').addEventListener('click',()=>{
  const name=$('manual_name').value.trim();
  const val=parseInt($('manual_val').value,10);
  if(!name||!val){toast('Enter name & number');return;}
  RRPD.data.scannerTotals[name]=(RRPD.data.scannerTotals[name]||0)+val;
  renderDashboard();
  toast('Manual entry added');
});

// ---- Auto Refresh (every 15 min) ----
function startAutoRefresh(){
  if(REFRESH_TIMER) clearInterval(REFRESH_TIMER);
  REFRESH_TIMER = setInterval(()=>loadDashboard(false), 15*60*1000);
}

// ---- Initial Setup ----
document.addEventListener('DOMContentLoaded',()=>{
  $('refresh_btn').addEventListener('click',()=>loadDashboard(true));
  loadDashboard(true);
  startAutoRefresh();
});
