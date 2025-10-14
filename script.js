/* ========= RRPD Receiving — Final Build ========= */

/** KEYS */
const K = {
  carriers: 'rrpd_carriers',
  racks: 'rrpd_racks',
  miss: 'rrpd_miss',
  alltime: 'rrpd_alltime_scanners',
  admins: 'rrpd_admins',
  quiz: 'rrpd_quiz',
  backup: 'rrpd_backup'
};
const DEFAULT_ADMIN = { name:'Admin', pass:'RRPD2025' };

/** STATE */
let API_CACHE = { returns: [], ts: 0 };
let IS_ADMIN = false;
let CHARTS = {};
const FIFTEEN_MIN = 15 * 60 * 1000;

/** Helpers */
const $ = sel => document.querySelector(sel);
const $id = id => document.getElementById(id);
const todayStr = () => new Date().toISOString().slice(0,10);
const toDate = s => new Date(s);
const toast = (m) => { const t=$id('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800); };
const lsGet = (k, d=null) => { try{ const v=localStorage.getItem(k); return v? JSON.parse(v): (d??null);}catch{ return d??null;} };
const lsSet = (k,v) => localStorage.setItem(k,JSON.stringify(v));

/** Init Admin baseline */
(function seed(){
  if(!lsGet(K.admins)) lsSet(K.admins,[DEFAULT_ADMIN]);
  if(!lsGet(K.alltime)) lsSet(K.alltime,{}); // {scanner: total}
  if(!lsGet(K.quiz)) lsSet(K.quiz, [
    {q:'Protect which item when opening a box?', opts:['Labels','Tools','Tape','Box'], ans:0},
    {q:'Which means broken/unusable?', opts:['Good','Used','Damaged','Core'], ans:2},
    {q:'Core is recognized by…', opts:['CORE mark','Color','Weight','Sound'], ans:0},
    {q:'If unsure, ask…', opts:['Customer','Supervisor','Random','Nobody'], ans:1}
  ]);
})();

/** Panels show/hide */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tgt = btn.dataset.target;
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    $id(tgt).classList.add('active');
    // lazy render on open
    if(tgt==='dashboard') renderDashboard();
    if(tgt==='scanners')  renderScanners();
    if(tgt==='classifications') renderClassifications();
    if(tgt==='miss') renderMissTableHint();
    if(tgt==='carriers') renderCarriers();
    if(tgt==='racks') renderRacks();
  });
});

/** Chart helper */
function drawChart(id, type, labels, datasets, options={}){
  const ctx = $id(id)?.getContext('2d'); if(!ctx) return;
  if(CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: Object.assign({
      responsive:true,
      plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true } }, tooltip:{ mode:'index', intersect:false } },
      interaction:{ mode:'index', intersect:false },
      scales: type==='bar'||type==='line'?{ x:{ grid:{color:'#1b2c52'}}, y:{ grid:{color:'#1b2c52'} } }: {}
    }, options)
  });
}

/** ===== Netlify Functions (CORS-safe) ===== **/
async function fetchReturns(){
  // Proxy through Netlify function
  const res = await fetch('/.netlify/functions/returns');
  if(!res.ok) throw new Error('returns function error');
  const data = await res.json();
  return Array.isArray(data)? data: (data?.data||[]);
}
async function fetchPhotosForReturn(id){
  try{
    const res = await fetch('/.netlify/functions/photos?id='+encodeURIComponent(id));
    if(!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j)? j: (j?.data||[]);
  }catch{ return []; }
}

/** ====== Refresh control (15 min + manual) ====== */
let refreshing=false;
async function fetchAndUpdateDashboard(){
  if(refreshing) return;
  refreshing=true;
  try{
    const arr = await fetchReturns();
    API_CACHE.returns = arr;
    API_CACHE.ts = Date.now();
    renderDashboard();
    renderScanners();
    renderClassifications();
    toast('✅ Data updated');
  }catch(e){
    console.error(e);
    toast('API unreachable — using last data');
  }finally{
    refreshing=false;
    updateLastUpdatedStamp();
  }
}
function updateLastUpdatedStamp(){
  const el = $id('lastUpdatedStamp');
  if(!el) return;
  el.textContent = 'Last updated: ' + new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
}

/** Wire “Refresh Now” */
(function attachRefresh(){
  const btn=$id('refreshNowBtn'), icon=$id('refreshNowIcon'), tx=$id('refreshNowText');
  if(!btn) return;
  btn.addEventListener('click', async ()=>{
    if(refreshing) return;
    btn.disabled=true; icon.textContent='⏳'; tx.textContent='Refreshing…';
    try{ await fetchAndUpdateDashboard(); } finally{
      setTimeout(()=>{ btn.disabled=false; icon.textContent='⟳'; tx.textContent='Refresh Now'; },4000);
    }
  });
})();
setInterval(fetchAndUpdateDashboard, FIFTEEN_MIN);

/** ====== Dashboard (weekly/daily scanners + carriers) ====== */
function startOfWeek(d=new Date()){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }
function fmt(d){ return d.toISOString().slice(0,10); }
function last7Labels(){ const a=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); a.push(fmt(d)); } return a; }

function renderDashboard(){
  // Scanners weekly from API
  const week = last7Labels();
  const byDayByScanner = {}; // {date:{scanner:count}}
  (API_CACHE.returns||[]).forEach(r=>{
    const dt = (r.created_at || r.createdAt || r.updated_at || '').slice(0,10);
    if(!week.includes(dt)) return;
    const who = r.createdBy || r.created_by || r.scanned_by || 'Unknown';
    byDayByScanner[dt] ??= {};
    byDayByScanner[dt][who] = (byDayByScanner[dt][who]||0)+1;
  });
  const scannerSet = new Set();
  week.forEach(d=> Object.keys(byDayByScanner[d]||{}).forEach(n=>scannerSet.add(n)));
  const scanners = [...scannerSet];

  // donut (aggregate week share)
  const donutData = scanners.map(n=> week.reduce((s,d)=> s+(byDayByScanner[d]?.[n]||0),0));
  drawChart('dash_scanners_donut','doughnut', scanners, [{data:donutData}]);

  // bar per day (stacked)
  const dayTotals = week.map(d=> Object.values(byDayByScanner[d]||{}).reduce((a,b)=>a+b,0));
  drawChart('dash_scanners_bar','bar', week,
    scanners.map((n,i)=>({label:n, data: week.map(d=>byDayByScanner[d]?.[n]||0)})),
    { scales:{x:{stacked:true},y:{stacked:true}} }
  );
  $id('dash_scanners_summary').textContent = `This week total scans: ${dayTotals.reduce((a,b)=>a+b,0)}`;

  // Carriers weekly from local (manual)
  const carr = lsGet(K.carriers,[]);
  const byDay = {}; carr.forEach(c=>{ byDay[c.date]=c; });
  const labels = week;
  const fed = labels.map(d=> +(byDay[d]?.fedex||0));
  const ups = labels.map(d=> +(byDay[d]?.ups||0));
  const usps = labels.map(d=> +(byDay[d]?.usps||0));
  const oth = labels.map(d=> +(byDay[d]?.other||0));
  const tot = labels.map((_,i)=> fed[i]+ups[i]+usps[i]+oth[i]);

  drawChart('dash_carriers_donut','doughnut',['FedEx','UPS','USPS','Other'],[{data:[
    fed.reduce((a,b)=>a+b,0),
    ups.reduce((a,b)=>a+b,0),
    usps.reduce((a,b)=>a+b,0),
    oth.reduce((a,b)=>a+b,0)
  ]}]);

  drawChart('dash_carriers_bar','bar', labels, [
    {label:'FedEx', data: fed},
    {label:'UPS', data: ups},
    {label:'USPS', data: usps},
    {label:'Other', data: oth}
  ], { scales:{x:{stacked:true},y:{stacked:true}} });

  $id('dash_carriers_summary').textContent = `This week total received (manual): ${tot.reduce((a,b)=>a+b,0)}`;
}

/** ====== Scanners ====== */
function renderScanners(){
  const today = todayStr();
  const arr = API_CACHE.returns||[];
  const daily = {};
  const weekMap={};
  const labels7 = last7Labels();
  arr.forEach(r=>{
    const name = r.createdBy || r.created_by || r.scanned_by || 'Unknown';
    const d = (r.created_at || r.createdAt || r.updated_at || '').slice(0,10);
    if(d===today) daily[name]=(daily[name]||0)+1;
    if(labels7.includes(d)){
      weekMap[d]??={};
      weekMap[d][name]=(weekMap[d][name]||0)+1;
    }
  });

  const names = Object.keys(daily);
  drawChart('scan_daily_donut','doughnut', names, [{data: names.map(n=>daily[n])}]);

  const allNames = new Set(); labels7.forEach(d=> Object.keys(weekMap[d]||{}).forEach(n=>allNames.add(n)));
  const N=[...allNames];
  drawChart('scan_week_bar','bar', labels7, N.map(n=>({label:n, data: labels7.map(d=>weekMap[d]?.[n]||0)})), {scales:{x:{stacked:true},y:{stacked:true}}});

  // All-time (merge admin adjustments)
  const baseCounts = {};
  arr.forEach(r=>{
    const n = r.createdBy || r.created_by || r.scanned_by || 'Unknown';
    baseCounts[n]=(baseCounts[n]||0)+1;
  });
  const adj = lsGet(K.alltime,{});
  const rows = [...new Set([...Object.keys(baseCounts), ...Object.keys(adj)])]
    .map(n=>({name:n, total:(baseCounts[n]||0)+(adj[n]||0)}))
    .sort((a,b)=>b.total-a.total);

  const html = ['<table><thead><tr><th>Scanner</th><th>All-Time</th>', IS_ADMIN?'<th>Adjust</th>':'','</tr></thead><tbody>'].join('');
  let body = '';
  rows.forEach(r=>{
    body += `<tr><td>${r.name}</td><td>${r.total}</td>` +
      (IS_ADMIN?`<td><button class="btn small" data-adj="${r.name}" data-d="10">+10</button> <button class="btn small" data-adj="${r.name}" data-d="-10">-10</button></td>`:'')
      + `</tr>`;
  });
  $id('scan_alltime_table').innerHTML = html + body + '</tbody></table>';

  if(IS_ADMIN){
    $id('scan_alltime_table').querySelectorAll('[data-adj]').forEach(b=>{
      b.addEventListener('click',()=>{
        const name=b.dataset.adj; const delta=+b.dataset.d;
        const m=lsGet(K.alltime,{});
        m[name]=(m[name]||0)+delta;
        lsSet(K.alltime,m);
        toast(`Adjusted ${name} by ${delta}`);
        renderScanners();
      });
    });
  }
}

/** ====== Classifications ====== */
function getStatus(rec){
  return rec.Status || rec.status || rec.classification || rec.description || '';
}

function renderClassifications(){
  const arr = (API_CACHE.returns||[]).filter(r=>{
    const s = (getStatus(r)+'').toLowerCase();
    // ignore “return labels” / “packing slip” style:
    return !(s.includes('label') || s.includes('slip'));
  });

  const today = todayStr();
  const todayArr = arr.filter(r=>(r.created_at||'').slice(0,10)===today);

  const counts = {Good:0,Used:0,Core:0,Damaged:0,Missing:0,'Not Our Part':0};
  todayArr.forEach(r=>{
    const s = getStatus(r);
    if(counts[s]!==undefined) counts[s]++; // else ignore unknowns
  });

  drawChart('class_today_donut','doughnut', Object.keys(counts), [{data:Object.values(counts)}]);

  // Monthly trend (last 30 days total per day)
  const days=[]; for(let i=29;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(fmt(d)); }
  const perDay = days.map(d=>{
    const subset = arr.filter(r=>(r.created_at||'').slice(0,10)===d);
    const good=subset.filter(r=>getStatus(r)==='Good').length;
    const other=subset.length - good;
    return {good, other};
  });
  drawChart('class_month_bar','bar', days, [
    {label:'Good', data: perDay.map(x=>x.good)},
    {label:'Other', data: perDay.map(x=>x.other)}
  ], {scales:{x:{stacked:true},y:{stacked:true}}});

  // table
  let html = '<table><thead><tr><th>Time</th><th>Scanner</th><th>Status</th><th>Tracking</th></tr></thead><tbody>';
  todayArr.slice(-200).reverse().forEach(r=>{
    const t = new Date(r.created_at || r.updated_at || Date.now()).toLocaleString();
    const who = r.createdBy || r.created_by || '—';
    const s = getStatus(r) || '—';
    const tr = r.track_number || r.trackingNumber || r.trackNumber || '—';
    html += `<tr><td>${t}</td><td>${who}</td><td>${s}</td><td>${tr}</td></tr>`;
  });
  html += '</tbody></table>';
  $id('class_today_table').innerHTML = html;
}

/** ====== Miss Inspections ====== */
function renderMissTableHint(){
  $id('mi_result').innerHTML = '<div class="muted">Search a tracking number to see details and photos.</div>';
}
$id('mi_lookup').addEventListener('click', async ()=>{
  const tr = $id('mi_tracking').value.trim();
  if(!tr) return;
  const arr = API_CACHE.returns||[];
  const found = arr.find(r=>{
    const t = r.track_number || r.trackingNumber || r.trackNumber || '';
    return (t+'').replace(/\s|\./g,'') === tr.replace(/\s|\./g,'');
  });
  if(!found){ $id('mi_result').innerHTML = '<div class="muted">Not found in returns. Try again later.</div>'; return; }

  const who = found.createdBy || found.created_by || '—';
  const s = getStatus(found) || '—';
  const ts = new Date(found.created_at || found.updated_at || Date.now()).toLocaleString();
  let photos=[];
  if(found.id){ photos = await fetchPhotosForReturn(found.id); }

  let html = `<div class="card">
    <div><strong>Scanner:</strong> ${who}</div>
    <div><strong>Status:</strong> ${s}</div>
    <div><strong>Time:</strong> ${ts}</div>
    <div><strong>Tracking:</strong> ${tr}</div>
    <div style="margin-top:8px"><strong>Photos</strong></div>
    <div>`;
  if(photos.length){
    html += photos.map(p=>`<img src="${p.url||p}" alt="photo">`).join('');
  }else{
    html += '<div class="muted">No photos returned.</div>';
  }
  html += '</div></div>';
  $id('mi_result').innerHTML = html;
});
$id('mi_save').addEventListener('click',()=>{
  const tr=$id('mi_tracking').value.trim(); const reason=$id('mi_reason').value.trim();
  if(!tr || !reason){ toast('Tracking & reason required'); return; }
  const arr = lsGet(K.miss,[]);
  arr.push({date:todayStr(), tracking:tr, reason, ts:Date.now()});
  lsSet(K.miss,arr);
  toast('Miss note saved');
});

/** ====== Carriers (manual) ====== */
$id('ca_save').addEventListener('click',()=>{
  const date = $id('ca_date').value || todayStr();
  const fed = +($id('ca_fedex').value||0), ups=+($id('ca_ups').value||0), usps=+($id('ca_usps').value||0), other=+($id('ca_other').value||0);
  const arr = lsGet(K.carriers,[]);
  const i = arr.findIndex(x=>x.date===date);
  const rec = {date, fedex:fed, ups, usps, other};
  if(i>=0) arr[i]=rec; else arr.push(rec);
  lsSet(K.carriers,arr);
  toast('Carriers saved');
  renderCarriers(); renderDashboard();
});
$id('ca_export').addEventListener('click',()=>{
  const arr = lsGet(K.carriers,[]);
  const cols=['date','fedex','ups','usps','other'];
  const rows = [cols.join(',')].concat(arr.map(r=> cols.map(c=> JSON.stringify(r[c]??'')).join(',')));
  const blob = new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='carriers.csv'; a.click();
});
function renderCarriers(){
  const arr = lsGet(K.carriers,[]);
  // today donut
  const t = arr.find(x=>x.date===todayStr())||{fedex:0,ups:0,usps:0,other:0};
  drawChart('ca_today_donut','doughnut',['FedEx','UPS','USPS','Other'],[{data:[t.fedex,t.ups,t.usps,t.other]}]);

  // week bar
  const labels = last7Labels();
  const map = {}; arr.forEach(r=> map[r.date]=r);
  drawChart('ca_week_bar','bar', labels, [
    {label:'FedEx', data:labels.map(d=>map[d]?.fedex||0)},
    {label:'UPS',   data:labels.map(d=>map[d]?.ups||0)},
    {label:'USPS',  data:labels.map(d=>map[d]?.usps||0)},
    {label:'Other', data:labels.map(d=>map[d]?.other||0)},
  ], {scales:{x:{stacked:true},y:{stacked:true}}});

  // table
  let html='<table><thead><tr><th>Date</th><th>FedEx</th><th>UPS</th><th>USPS</th><th>Other</th></tr></thead><tbody>';
  arr.slice().reverse().forEach(r=> html+=`<tr><td>${r.date}</td><td>${r.fedex}</td><td>${r.ups}</td><td>${r.usps}</td><td>${r.other}</td></tr>`);
  html+='</tbody></table>';
  $id('ca_table').innerHTML = html;
}

/** ====== Racks (manual) ====== */
$id('rk_save').addEventListener('click',()=>{
  const d = $id('rk_date').value || todayStr();
  const rec = {
    date:d,
    racks_g:+($id('rk_racks_good').value||0),
    racks_c:+($id('rk_racks_core').value||0),
    eracks_g:+($id('rk_eracks_good').value||0),
    eracks_c:+($id('rk_eracks_core').value||0),
    ax_g:+($id('rk_ax_good').value||0),
    ax_u:+($id('rk_ax_used').value||0),
    ds_g:+($id('rk_ds_good').value||0),
    ds_u:+($id('rk_ds_used').value||0),
    gb_g:+($id('rk_gb_good').value||0),
    gb_u:+($id('rk_gb_used').value||0),
  };
  const arr = lsGet(K.racks,[]);
  const i = arr.findIndex(x=>x.date===d);
  if(i>=0) arr[i]=rec; else arr.push(rec);
  lsSet(K.racks,arr);
  toast('Racks saved');
  renderRacks();
});
$id('rk_reset').addEventListener('click',()=>{
  if(!IS_ADMIN){ toast('Admin only'); return; }
  if(confirm('Reset all rack logs?')){ lsSet(K.racks,[]); toast('Racks reset'); renderRacks(); }
});
function renderRacks(){
  const arr = lsGet(K.racks,[]);
  const t = arr.find(x=>x.date===todayStr()) || {racks_g:0,racks_c:0,eracks_g:0,eracks_c:0,ax_g:0,ax_u:0,ds_g:0,ds_u:0,gb_g:0,gb_u:0};

  drawChart('rk_donut_racks','doughnut', ['Good','Core'], [{data:[t.racks_g, t.racks_c]}]);
  drawChart('rk_donut_eracks','doughnut', ['Good','Core'], [{data:[t.eracks_g, t.eracks_c]}]);
  drawChart('rk_donut_ax','doughnut', ['Good','Used'], [{data:[t.ax_g, t.ax_u]}]);
  drawChart('rk_donut_ds','doughnut', ['Good','Used'], [{data:[t.ds_g, t.ds_u]}]);
  drawChart('rk_donut_gb','doughnut', ['Good','Used'], [{data:[t.gb_g, t.gb_u]}]);

  // weekly stack (sum per day of each category)
  const labels = last7Labels();
  const map={}; arr.forEach(r=> map[r.date]=r);
  drawChart('rk_week_stack','bar', labels, [
    {label:'Racks Good', data:labels.map(d=>map[d]?.racks_g||0)},
    {label:'Racks Core', data:labels.map(d=>map[d]?.racks_c||0)},
    {label:'E-Racks Good', data:labels.map(d=>map[d]?.eracks_g||0)},
    {label:'E-Racks Core', data:labels.map(d=>map[d]?.eracks_c||0)},
    {label:'Axles Good', data:labels.map(d=>map[d]?.ax_g||0)},
    {label:'Axles Used', data:labels.map(d=>map[d]?.ax_u||0)},
    {label:'DS Good', data:labels.map(d=>map[d]?.ds_g||0)},
    {label:'DS Used', data:labels.map(d=>map[d]?.ds_u||0)},
    {label:'GB Good', data:labels.map(d=>map[d]?.gb_g||0)},
    {label:'GB Used', data:labels.map(d=>map[d]?.gb_u||0)},
  ], {scales:{x:{stacked:true},y:{stacked:true}}});

  // table
  let html='<table><thead><tr><th>Date</th><th>Racks G</th><th>Racks C</th><th>E-Racks G</th><th>E-Racks C</th><th>Ax G</th><th>Ax U</th><th>DS G</th><th>DS U</th><th>GB G</th><th>GB U</th></tr></thead><tbody>';
  arr.slice().reverse().forEach(r=>{
    html+=`<tr><td>${r.date}</td><td>${r.racks_g}</td><td>${r.racks_c}</td><td>${r.eracks_g}</td><td>${r.eracks_c}</td><td>${r.ax_g}</td><td>${r.ax_u}</td><td>${r.ds_g}</td><td>${r.ds_u}</td><td>${r.gb_g}</td><td>${r.gb_u}</td></tr>`;
  });
  html+='</tbody></table>';
  $id('rk_table').innerHTML=html;
}

/** ====== Manifest (local CSV + API compare) ====== */
let MANIFEST_LAST = { list:[], missing:[] };
$id('mf_parse').addEventListener('click', async ()=>{
  const f = $id('mf_file').files?.[0];
  if(!f){ toast('Choose a CSV file'); return; }
  const text = await f.text();
  const list = parseTrackingCSV(text);
  if(!list.length){ toast('No tracking found'); return; }
  // compare against API
  const api = (API_CACHE.returns||[]).map(r=>(r.track_number||r.trackingNumber||r.trackNumber||'').replace(/\s|\./g,''));
  const missing = list.filter(t=> !api.includes(t.replace(/\s|\./g,'')));
  MANIFEST_LAST = {list, missing};
  renderManifestResult();
  toast('Manifest compared');
});
$id('mf_export_missing').addEventListener('click',()=>{
  const rows = ['tracking'].concat((MANIFEST_LAST.missing||[]).map(t=>JSON.stringify(t)));
  const blob=new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='manifest_missing.csv'; a.click();
});
function parseTrackingCSV(txt){
  // naive CSV parse: split by newlines/commas; keep sequences that look like tracking numbers
  const raw = txt.split(/\r?\n/).flatMap(line=> line.split(/,|;|\t/).map(s=>s.trim()).filter(Boolean));
  // simple filter: length >= 10
  const uniq = [...new Set(raw.filter(s=> s.length>=10))];
  return uniq;
}
function renderManifestResult(){
  const total=(MANIFEST_LAST.list||[]).length, miss=(MANIFEST_LAST.missing||[]).length;
  let html=`<div class="muted">Total in manifest: ${total} — <strong>Missing:</strong> ${miss} — Received: ${total-miss}</div>`;
  html += '<table><thead><tr><th>#</th><th>Tracking</th><th>Status</th></tr></thead><tbody>';
  (MANIFEST_LAST.list||[]).forEach((t,i)=>{
    const isMiss = (MANIFEST_LAST.missing||[]).includes(t);
    html += `<tr><td>${i+1}</td><td>${t}</td><td>${isMiss?'<span style="color:#ef4444">Missed</span>':'<span style="color:#10b981">Received</span>'}</td></tr>`;
  });
  html+='</tbody></table>';
  $id('mf_result').innerHTML = html;
}

/** ====== Training & Quiz ====== */
function renderTraining(){
  $id('tr_en').innerHTML = `
    <h4>Receiving — Step by step</h4>
    <ol>
      <li>Inspect package and preserve all <strong>labels</strong>.</li>
      <li>Open carefully; do not damage contents.</li>
      <li>Scan <strong>tracking number</strong>.</li>
      <li>Classify part: Good / Used / Core / Damaged / Missing / Not Our Part.</li>
      <li>Attach notes or photos if needed; escalate questions to Supervisor.</li>
    </ol>`;
  $id('tr_es').innerHTML = `
    <h4>Recepción — Paso a paso</h4>
    <ol>
      <li>Inspeccione el paquete y conserve todas las <strong>etiquetas</strong>.</li>
      <li>Ábralo con cuidado; no dañe el contenido.</li>
      <li>Escanee el <strong>número de seguimiento</strong>.</li>
      <li>Clasifique la pieza: Bueno / Usado / Núcleo / Dañado / Faltante / No es nuestro.</li>
      <li>Agregue notas o fotos si es necesario; consulte al Supervisor.</li>
    </ol>`;
}
$id('tr_bilingual').addEventListener('change', e=>{
  $id('tr_es').style.display = e.target.checked? 'block':'none';
});
$id('quiz_start').addEventListener('click',()=>{
  const qs = lsGet(K.quiz,[]);
  const ans = [];
  let correct=0;
  qs.forEach((q,i)=>{
    const pick = prompt(`${i+1}. ${q.q}\n${q.opts.map((o,idx)=>` ${idx+1}) ${o}`).join('\n')}\nAnswer #:`) || '';
    const choice = (+pick||0)-1;
    ans.push(choice);
    if(choice===q.ans) correct++;
  });
  const row = {ts: Date.now(), score: correct, total: qs.length};
  const log = lsGet('rrpd_quiz_log',[]);
  log.push(row); lsSet('rrpd_quiz_log',log);
  renderQuizLog();
  toast(`Quiz: ${correct}/${qs.length}`);
});
function renderQuizLog(){
  const log = lsGet('rrpd_quiz_log',[]).slice(-5).reverse();
  let html='<table><thead><tr><th>Time</th><th>Score</th></tr></thead><tbody>';
  log.forEach(r=> html+=`<tr><td>${new Date(r.ts).toLocaleString()}</td><td>${r.score} / ${r.total}</td></tr>`);
  html+='</tbody></table>';
  $id('quiz_log').innerHTML = html;
}

/** ====== Settings / Admin ====== */
$id('ad_login').addEventListener('click',()=>{
  const u=$id('ad_user').value.trim(); const p=$id('ad_pass').value.trim();
  const arr=lsGet(K.admins,[]);
  const ok = arr.find(a=>a.name===u && a.pass===p);
  if(!ok){ toast('Unauthorized'); return; }
  IS_ADMIN=true; $id('ad_badge').textContent='Logged in'; $id('admin_zone').style.display='grid';
  renderAdminAdjust();
});
$id('ad_logout').addEventListener('click',()=>{
  IS_ADMIN=false; $id('ad_badge').textContent=''; $id('admin_zone').style.display='none';
});
function renderAdminAdjust(){
  const wrap=$id('ad_scanner_adjust'); const adj=lsGet(K.alltime,{});
  const names=[...new Set([...Object.keys(adj), ...(API_CACHE.returns||[]).map(r=>r.createdBy||r.created_by||'Unknown')])];
  wrap.innerHTML = names.map(n=>`
    <div class="form-row" style="margin-bottom:6px">
      <div style="min-width:140px">${n}</div>
      <input type="number" data-name="${n}" value="${adj[n]||0}" style="width:120px">
    </div>`).join('')
    + `<div class="form-row"><button id="ad_save_adj" class="btn">Save</button></div>`;
  $id('ad_save_adj').addEventListener('click',()=>{
    const inputs = wrap.querySelectorAll('input[data-name]');
    const m={}; inputs.forEach(inp=> m[inp.dataset.name]=+(inp.value||0));
    lsSet(K.alltime,m); toast('Saved adjustments'); renderScanners();
  });
}
$id('bk_download').addEventListener('click',()=>{
  const payload = {
    carriers: lsGet(K.carriers,[]),
    racks: lsGet(K.racks,[]),
    miss: lsGet(K.miss,[]),
    alltime: lsGet(K.alltime,{})
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rrpd_backup.json'; a.click();
});
$id('bk_restore').addEventListener('click', async ()=>{
  const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json';
  inp.onchange=async ()=>{ const f=inp.files?.[0]; if(!f) return;
    const txt=await f.text(); const obj=JSON.parse(txt);
    if(obj.carriers) lsSet(K.carriers,obj.carriers);
    if(obj.racks)    lsSet(K.racks,obj.racks);
    if(obj.miss)     lsSet(K.miss,obj.miss);
    if(obj.alltime)  lsSet(K.alltime,obj.alltime);
    toast('Backup restored'); renderDashboard(); renderCarriers(); renderRacks(); renderScanners();
  };
  inp.click();
});

/** ====== First load ====== */
document.addEventListener('DOMContentLoaded', async ()=>{
  try{ await fetchAndUpdateDashboard(); }catch(e){ console.error(e); }
  renderTraining(); renderQuizLog(); renderCarriers(); renderRacks();
});
