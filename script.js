/*****************
 * CONFIG & STATE
 *****************/
const API_RETURNS = 'https://returns.detroitaxle.com/api/returns'; // requires you to be logged in (cookies)
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

const state = {
  admin: null, // string username or null
  goals: { scannerDaily: 800 }, // default, editable in Settings
  carriers: [], // {date, fedex, ups, usps, other}
  racks: [],    // {date, r_good, r_core, er_good, er_core, ax_good, ax_used, ds_good, ds_used, gb_good, gb_used}
  miss: [],     // local log of miss inspections
  manifest: [], // tracking numbers from FedEx PDF
  returns: [],  // live API list (poll)
  lastFetchAt: null
};

// LocalStorage keys
const LS = {
  goals: 'da_goals',
  carriers: 'da_carriers',
  racks: 'da_racks',
  miss: 'da_miss',
  admin: 'da_admin_user',
  manifest: 'da_manifest'
};

// utils
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function byDateAsc(a,b){ return a.date.localeCompare(b.date); }
function sum(arr,key){ return arr.reduce((s,r)=> s + (Number(r[key])||0),0); }
function groupBy(arr,fn){ return arr.reduce((m,x)=>{ const k=fn(x); (m[k]=m[k]||[]).push(x); return m; },{}); }
function dateOnly(s){ return (s||'').split(' ')[0]; }

/*****************
 * NAVIGATION
 *****************/
$$('.nav-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $$('.nav-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.getAttribute('data-target');
    $$('.panel').forEach(p=>p.classList.remove('active'));
    $('#'+target).classList.add('active');
    window.scrollTo({top:0,behavior:'smooth'});
  });
});

/*****************
 * CLOCK
 *****************/
setInterval(()=>{$('#clock').textContent = new Date().toLocaleString();},1000);

/*****************
 * LOAD/SAVE
 *****************/
function loadLS(){
  const g = localStorage.getItem(LS.goals); if(g) state.goals = JSON.parse(g);
  const c = localStorage.getItem(LS.carriers); if(c) state.carriers = JSON.parse(c);
  const r = localStorage.getItem(LS.racks); if(r) state.racks = JSON.parse(r);
  const m = localStorage.getItem(LS.miss); if(m) state.miss = JSON.parse(m);
  const a = localStorage.getItem(LS.admin); if(a) state.admin = a;
  const mf = localStorage.getItem(LS.manifest); if(mf) state.manifest = JSON.parse(mf);
  if(state.admin){ $('#admin_hint').textContent = state.admin; $('#admin_logout').style.display='inline-block'; $('#admin_only').style.display='block'; $('#manifestTab').style.display='inline-block'; }
}
function saveLS(key){
  if(key==='goals') localStorage.setItem(LS.goals, JSON.stringify(state.goals));
  if(key==='carriers') localStorage.setItem(LS.carriers, JSON.stringify(state.carriers));
  if(key==='racks') localStorage.setItem(LS.racks, JSON.stringify(state.racks));
  if(key==='miss') localStorage.setItem(LS.miss, JSON.stringify(state.miss));
  if(key==='manifest') localStorage.setItem(LS.manifest, JSON.stringify(state.manifest));
}

/*****************
 * API POLL (RETURNS)
 *****************/
async function fetchReturns() {
  try{
    const res = await fetch(API_RETURNS, { credentials: 'include' });
    if(!res.ok) throw new Error('API '+res.status);
    const data = await res.json();
    state.returns = data || [];
    state.lastFetchAt = Date.now();
  }catch(e){
    console.warn('fetchReturns:', e.message);
  }
}

/*****************
 * CHART HELPERS
 *****************/
const CHARTS = {};
function drawChart(id, type, labels, datasets, opts={}){
  const el = document.getElementById(id);
  if(!el) return;
  if(CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart(el.getContext('2d'), {
    type,
    data: { labels, datasets },
    options: Object.assign({
      responsive:true,
      plugins:{ legend:{ position:'bottom' } },
      scales: type==='bar' || type==='line' ? { y:{ beginAtZero:true } } : {}
    }, opts)
  });
}

/*****************
 * HOME RENDER
 *****************/
function renderHome(){
  // Goal bar (based on today's scans)
  const today = todayStr();
  const todays = state.returns.filter(r => dateOnly(r.created_at||r.createdAt)===today);
  const count = todays.length;
  const target = Number(state.goals.scannerDaily)||0;
  const pct = target? Math.min(100, Math.round((count/target)*100)) : 0;
  $('#goal_bar').style.width = pct+'%';
  $('#goal_info').textContent = `Target: ${target} scans`;
  $('#goal_nums').textContent = `Today: ${count} / ${target} (${pct}%)`;

  // Received vs Scanned (We treat "Received" = carriers sum today; "Scanned" = returns today)
  const carrToday = state.carriers.find(x=>x.date===today) || {fedex:0,ups:0,usps:0,other:0};
  const received = (Number(carrToday.fedex)||0)+(Number(carrToday.ups)||0)+(Number(carrToday.usps)||0)+(Number(carrToday.other)||0);
  drawChart('ratio_today','doughnut',['Scanned','Received'],
    [{ data:[count, received], backgroundColor:['#10b981','#0ea5e9'] }]);

  // Weekly scanners
  const days7 = lastNDates(7);
  const byDay = days7.map(d => state.returns.filter(r=>dateOnly(r.created_at||r.createdAt)===d).length);
  drawChart('weekly_scanners','bar',days7,[{label:'Scans',data:byDay, backgroundColor:'#0ea5e9'}]);

  // Weekly carriers
  const carrMap = {};
  days7.forEach(d=> carrMap[d] = {fedex:0,ups:0,usps:0,other:0});
  state.carriers.forEach(c=>{
    if(carrMap[c.date]) {
      carrMap[c.date].fedex += Number(c.fedex)||0;
      carrMap[c.date].ups += Number(c.ups)||0;
      carrMap[c.date].usps += Number(c.usps)||0;
      carrMap[c.date].other += Number(c.other)||0;
    }
  });
  drawChart('weekly_carriers','bar',days7,[
    {label:'FedEx', data:days7.map(d=>carrMap[d].fedex)},
    {label:'UPS', data:days7.map(d=>carrMap[d].ups)},
    {label:'USPS', data:days7.map(d=>carrMap[d].usps)},
    {label:'Other', data:days7.map(d=>carrMap[d].other)},
  ], { scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true }}});

  // Monthly classifications (30 days)
  const days30 = lastNDates(30);
  const classNames = ['Good','Used','Core','Damage','Missing','Not Our Part'];
  const classColors = ['#10b981','#f59e0b','#7c3aed','#ef4444','#fb7185','#94a3b8'];
  const classCounts = {};
  days30.forEach(d=> classCounts[d] = {Good:0,Used:0,Core:0,Damage:0,Missing:0,'Not Our Part':0});
  state.returns.forEach(r=>{
    const d = dateOnly(r.created_at||r.createdAt); if(!classCounts[d]) return;
    const cls = (r.description||r.classification||'').trim(); // site shows "description"
    if(classCounts[d][cls]!==undefined) classCounts[d][cls] += 1;
  });
  const mdatasets = classNames.map((n,i)=>({
    label:n, backgroundColor:classColors[i],
    data: days30.map(d=>classCounts[d][n]||0)
  }));
  drawChart('monthly_class','bar',days30, mdatasets, { scales:{ x:{stacked:true}, y:{stacked:true,beginAtZero:true}}});
}

/*****************
 * SCANNERS PANEL
 *****************/
function lastNDates(n){
  const out=[]; const t=new Date();
  for(let i=n-1;i>=0;i--){ const d=new Date(t); d.setDate(t.getDate()-i); out.push(d.toISOString().slice(0,10)); }
  return out;
}

function renderScanners(){
  const today = todayStr();
  const todays = state.returns.filter(r=>dateOnly(r.created_at||r.createdAt)===today);
  const byName = groupBy(todays, r=>(r.createdBy||'Unknown').trim());
  const names = Object.keys(byName).sort();
  const counts = names.map(n=> byName[n].length);

  drawChart('scanner_donut_today','doughnut',names,[{data:counts}]);
  drawChart('scanner_bar_today','bar',names,[{label:'Today',data:counts}]);
}

let scannersTotalChart=null;
async function populateScannerSelector(){
  const names = Array.from(new Set(state.returns.map(r=>(r.createdBy||'Unknown').trim()))).sort();
  const sel = $('#scannerFilter'); if(!sel) return;
  sel.innerHTML='';
  names.forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
}

async function renderScannersTotalChart(){
  const days = Number($('#daysBack').value||7);
  const dates = lastNDates(days);
  const selected = Array.from($('#scannerFilter').selectedOptions).map(o=>o.value);
  const mapping = {};
  dates.forEach(d=> mapping[d]={});
  state.returns.forEach(r=>{
    const d = dateOnly(r.created_at||r.createdAt); if(!mapping[d]) return;
    const s = (r.createdBy||'Unknown').trim();
    mapping[d][s] = (mapping[d][s]||0)+1;
  });

  let scannersToPlot = selected.slice();
  if(scannersToPlot.length===0){
    // pick top 4
    const totals={};
    Object.values(mapping).forEach(day=>Object.keys(day).forEach(s=> totals[s]=(totals[s]||0)+day[s]));
    scannersToPlot = Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,4).map(x=>x[0]);
  }

  const palette = ['#0ea5e9','#10b981','#f59e0b','#ef4444','#7c3aed','#06b6d4','#f97316','#22d3ee'];
  const datasets = scannersToPlot.map((s,i)=>({
    label: s,
    data: dates.map(d=>mapping[d][s]||0),
    borderColor: palette[i%palette.length],
    backgroundColor: palette[i%palette.length],
    tension: .2,
    borderWidth:2,
    pointRadius:3
  }));
  const totalData = dates.map(d=> scannersToPlot.reduce((sum,s)=> sum+(mapping[d][s]||0),0));
  datasets.unshift({label:'Total (selected)', data:totalData, borderColor:'#111827', backgroundColor:'#111827', borderWidth:3, pointRadius:4, tension:.2});

  if(scannersTotalChart) scannersTotalChart.destroy();
  scannersTotalChart = new Chart($('#scanners_total_chart').getContext('2d'), {
    type:'line', data:{labels:dates,datasets},
    options:{ responsive:true, plugins:{legend:{position:'bottom'},title:{display:false}},
      interaction:{mode:'index',intersect:false}, scales:{ y:{beginAtZero:true}}}
  });
}

$('#refreshScannerChart').addEventListener('click', renderScannersTotalChart);

/*****************
 * CARRIERS PANEL (manual daily)
 *****************/
$('#cr_save').addEventListener('click', ()=>{
  const date = $('#cr_date').value || todayStr();
  const fedex = Number($('#cr_fedex').value)||0;
  const ups   = Number($('#cr_ups').value)||0;
  const usps  = Number($('#cr_usps').value)||0;
  const other = Number($('#cr_other').value)||0;
  const idx = state.carriers.findIndex(x=>x.date===date);
  const row = {date,fedex,ups,usps,other};
  if(idx>=0) state.carriers[idx]=row; else state.carriers.push(row);
  state.carriers.sort(byDateAsc);
  saveLS('carriers');
  renderCarriers();
  renderHome();
  toast('Carriers saved.');
});
function renderCarriers(){
  const today = todayStr();
  const trow = state.carriers.find(x=>x.date===today) || {fedex:0,ups:0,usps:0,other:0};
  drawChart('carrier_donut_today','doughnut',['FedEx','UPS','USPS','Other'],[{data:[trow.fedex,trow.ups,trow.usps,trow.other]}]);
  drawChart('carrier_bar_today','bar',['FedEx','UPS','USPS','Other'],[{label:'Today',data:[trow.fedex,trow.ups,trow.usps,trow.other]}]);

  let html = '<table class="table"><thead><tr><th>Date</th><th>FedEx</th><th>UPS</th><th>USPS</th><th>Other</th><th>Total</th></tr></thead><tbody>';
  state.carriers.slice().reverse().forEach(c=>{
    const tot = c.fedex+c.ups+c.usps+c.other;
    html += `<tr><td>${c.date}</td><td>${c.fedex}</td><td>${c.ups}</td><td>${c.usps}</td><td>${c.other}</td><td>${tot}</td></tr>`;
  });
  html += '</tbody></table>';
  $('#carrier_table').innerHTML = html;
}

/*****************
 * RACKS PANEL (manual daily)
 *****************/
$('#rk_save').addEventListener('click', ()=>{
  const date = $('#rk_date').value || todayStr();
  const row = {
    date,
    r_good:Number($('#rk_racks').value)||0,
    r_core:Number($('#rk_racks_core').value)||0,
    er_good:Number($('#rk_eracks').value)||0,
    er_core:Number($('#rk_eracks_core').value)||0,
    ax_good:Number($('#rk_ax_good').value)||0,
    ax_used:Number($('#rk_ax_used').value)||0,
    ds_good:Number($('#rk_ds_good').value)||0,
    ds_used:Number($('#rk_ds_used').value)||0,
    gb_good:Number($('#rk_gb_good').value)||0,
    gb_used:Number($('#rk_gb_used').value)||0
  };
  const idx = state.racks.findIndex(x=>x.date===date);
  if(idx>=0) state.racks[idx]=row; else state.racks.push(row);
  state.racks.sort(byDateAsc);
  saveLS('racks');
  renderRacks();
  renderHome();
  toast('Racks saved.');
});

function renderRacks(){
  const today = todayStr();
  const r = state.racks.find(x=>x.date===today) || {r_good:0,r_core:0,er_good:0,er_core:0,ax_good:0,ax_used:0,ds_good:0,ds_used:0,gb_good:0,gb_used:0};

  drawChart('d_racks','doughnut',['Good','Core'],[{data:[r.r_good, r.r_core]}]);
  drawChart('d_eracks','doughnut',['Good','Core'],[{data:[r.er_good, r.er_core]}]);
  drawChart('d_axles','doughnut',['Good','Used'],[{data:[r.ax_good, r.ax_used]}]);
  drawChart('d_ds','doughnut',['Good','Used'],[{data:[r.ds_good, r.ds_used]}]);
  drawChart('d_gb','doughnut',['Good','Used'],[{data:[r.gb_good, r.gb_used]}]);

  let html = '<table class="table"><thead><tr><th>Date</th><th>Racks G</th><th>Racks C</th><th>ERacks G</th><th>ERacks C</th><th>Ax G</th><th>Ax U</th><th>DS G</th><th>DS U</th><th>GB G</th><th>GB U</th></tr></thead><tbody>';
  state.racks.slice().reverse().forEach(x=>{
    html += `<tr><td>${x.date}</td><td>${x.r_good}</td><td>${x.r_core}</td><td>${x.er_good}</td><td>${x.er_core}</td><td>${x.ax_good}</td><td>${x.ax_used}</td><td>${x.ds_good}</td><td>${x.ds_used}</td><td>${x.gb_good}</td><td>${x.gb_used}</td></tr>`;
  });
  html+='</tbody></table>';
  $('#racks_table').innerHTML = html;
}

/*****************
 * CLASSIFICATIONS (live, restricted to 6 categories)
 *****************/
function renderClassifications(){
  const today = todayStr();
  const todays = state.returns.filter(r=>dateOnly(r.created_at||r.createdAt)===today);
  const keep = new Set(['Good','Used','Core','Damage','Missing','Not Our Part']);
  const map = {Good:0,Used:0,Core:0,Damage:0,Missing:0,'Not Our Part':0};
  todays.forEach(r=>{
    const cls=(r.description||'').trim();
    if(keep.has(cls)) map[cls]+=1;
  });
  const labels = Object.keys(map);
  const vals = labels.map(k=>map[k]);
  drawChart('class_donut_today','doughnut',labels,[{data:vals}]);
  drawChart('class_bar_today','bar',labels,[{label:'Today',data:vals}]);

  // detail table (today)
  let html = '<table class="table"><thead><tr><th>Time</th><th>Tracking</th><th>Scanner</th><th>Class</th></tr></thead><tbody>';
  todays.forEach(r=>{
    html += `<tr><td>${r.created_at||r.createdAt}</td><td>${r.track_number}</td><td>${(r.createdBy||'').trim()}</td><td>${(r.description||'').trim()}</td></tr>`;
  });
  html+='</tbody></table>';
  $('#class_table').innerHTML = html;
}

/*****************
 * MISS INSPECTIONS (with View Photos)
 *****************/
$('#missForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const track = $('#missTrack').value.trim();
  const reason = $('#missReason').value.trim();
  if(!track || !reason){ toast('Tracking + Reason required'); return; }

  // try to find the return by track number
  let ret = null;
  try{
    const res = await fetch(`${API_RETURNS}?track_number=${encodeURIComponent(track)}`, { credentials:'include' });
    if(res.ok){
      const data = await res.json();
      ret = (data && data[0]) || null;
    }
  }catch(e){}

  const entry = {
    track,
    reason,
    scanner: (ret?.createdBy||'Unknown').trim(),
    time: ret?.created_at || new Date().toISOString(),
    returnId: ret?.id || null
  };
  state.miss.push(entry); saveLS('miss');
  renderMiss();
  e.target.reset();
  toast('Miss inspection saved.');
});

function renderMiss(){
  const tb = $('#missTableBody'); tb.innerHTML='';
  state.miss.slice().reverse().forEach(row=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${row.track}</td>
      <td>${row.scanner}</td>
      <td>${row.reason}</td>
      <td>${new Date(row.time).toLocaleString()}</td>
      <td>${row.returnId? `<button class="btn" data-view="${row.returnId}">View Photos</button>` : '—'}</td>
    `;
    tb.appendChild(tr);
  });

  // bind view buttons
  tb.querySelectorAll('button[data-view]').forEach(b=>{
    b.addEventListener('click', ()=> showPhotosModal(b.getAttribute('data-view')));
  });
}

$('#photosClose').addEventListener('click', ()=> $('#photosModal').style.display='none');

async function showPhotosModal(returnId){
  $('#photosModal').style.display='block';
  const body = $('#photosModalBody');
  body.innerHTML = '<p class="small">Loading details…</p>';

  // Try fetch detail endpoint (if available). If not, show guidance and link.
  let detail = null;
  let parts = null;

  try{
    // attempt: /api/returns/{id} (if backend supports)
    const res = await fetch(`${API_RETURNS}/${returnId}`, { credentials:'include' });
    if(res.ok){ detail = await res.json(); }
  }catch(e){}

  if(detail && Array.isArray(detail.parts)){
    parts = detail.parts.map(p=>({
      partId: p.partId || p.id || '—',
      classification: p.classification || p.description || '—',
      photos: Array.isArray(p.photos) ? p.photos : []
    }));
  }

  if(parts && parts.length){
    const base = 'https://returns.detroitaxle.com/images/';
    body.innerHTML = parts.map(p=>{
      const imgs = p.photos.map(file=> `<a href="${base}${file}" target="_blank"><img src="${base}${file}" style="height:90px;margin:6px;border:1px solid #26324b;border-radius:6px"/></a>`).join('');
      return `<div class="sec"><h4>Part ${p.partId} — <span class="small">${p.classification}</span></h4>${imgs||'<div class="small">No photos</div>'}</div>`;
    }).join('<hr>');
    return;
  }

  // Fallback: Show note with a direct link to the return page (supervisors can see images there)
  body.innerHTML = `
    <div class="sec">
      <h4>Photos</h4>
      <p class="small">Couldn’t auto-list photos for Return ID <strong>${returnId}</strong>. 
      Open the return in the system to view all parts & images.</p>
      <p><a class="btn" href="https://returns.detroitaxle.com/returns/${returnId}" target="_blank">Open Return ${returnId}</a></p>
      <p class="small">Tip: Your site serves images under <code>/images/</code> and filenames begin with the return ID (e.g., <code>${returnId}-*.jpg</code>).</p>
    </div>
  `;
}

/*****************
 * MANIFEST (Admin-only) — PDF → tracking numbers
 *****************/
let manifestChart=null;
$('#processManifestBtn').addEventListener('click', compareManifest);
$('#manifestUpload').addEventListener('change', async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  const arr = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:arr}).promise;
  let text='';
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it=>it.str).join(' ') + ' ';
  }
  // extract tracking numbers: 18–34 chars digits (FedEx sometimes 20+)
  const rx = /\b\d{18,34}\b/g;
  const found = text.match(rx) || [];
  state.manifest = Array.from(new Set(found));
  saveLS('manifest');
  toast(`Manifest loaded: ${state.manifest.length} tracking #`);
});

function compareManifest(){
  const scanned = new Set(state.returns.map(r=> String(r.track_number||'').trim()).filter(Boolean));
  const missing = state.manifest.filter(t=> !scanned.has(String(t).trim()));
  const extras = Array.from(scanned).filter(t=> !state.manifest.includes(String(t).trim())); // count only

  $('#manifestTotal').textContent = state.manifest.length;
  $('#manifestScanned').textContent = state.manifest.length - missing.length;
  $('#manifestMissing').textContent = missing.length;
  $('#manifestExtra').textContent = extras.length;

  // chart
  if(manifestChart) manifestChart.destroy();
  manifestChart = new Chart($('#manifestChart').getContext('2d'),{
    type:'doughnut',
    data:{ labels:['Scanned','Missing'], datasets:[{ data:[state.manifest.length-missing.length, missing.length], backgroundColor:['#10b981','#ef4444'] }] }
  });

  // table of missing
  const tb = $('#missingList'); tb.innerHTML='';
  missing.forEach(t=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${t}</td>`;
    tb.appendChild(tr);
  });
}

/*****************
 * TRAINING MANUAL (EN + ES) & QUIZ
 *****************/
function renderManual(){
  const el = $('#manual_en_es');
  el.innerHTML = [
    section('Purpose','Propósito',[
      ['This manual explains the correct process for receiving returned parts and logging them in the system.','Este manual explica el proceso correcto para recibir piezas devueltas y registrarlas en el sistema.']
    ]),
    section('Quick Checklist (before opening box)','Lista rápida (antes de abrir la caja)',[
      ['Wear PPE if required.','Use EPP si es necesario.'],
      ['Check the label and tracking number belongs to our workflow.','Verifique que la etiqueta y el número de seguimiento pertenezcan a nuestro flujo.'],
      ['Have your scanner logged in and ready.','Tenga su escáner iniciado y listo.']
    ]),
    section('Step-by-step Receiving','Recepción paso a paso',[
      ['Inspect the box for damage or missing labels.','Inspeccione la caja por daños o etiquetas faltantes.'],
      ['Scan the tracking number; confirm it appears in the system.','Escanee el número de seguimiento; confirme que aparece en el sistema.'],
      ['Open carefully; preserve labels and paperwork.','Abra con cuidado; conserve etiquetas y documentación.'],
      ['Lay out items; separate multiple parts clearly.','Coloque los artículos; separe varias piezas claramente.'],
      ['Take clear photos: full view + close-ups of labels/damage.','Tome fotos claras: vista completa + acercamientos de etiquetas/daños.'],
      ['Classify each part: Good, Used, Core, Damage, Missing, Not Our Part.','Clasifique cada pieza: Bueno, Usado, Núcleo, Dañado, Perdido, No es Nuestra Parte.'],
      ['Verify the record shows scanner, time, classification, and photos.','Verifique que el registro muestre escáner, hora, clasificación y fotos.']
    ]),
    section('Miss Inspections (Supervisor)','Inspecciones Fallidas (Supervisor)',[
      ['Enter tracking + reason; system will attach scanner, time and photos.','Ingrese seguimiento + motivo; el sistema adjuntará escáner, hora y fotos.'],
      ['Use real cases to coach and correct.','Use casos reales para capacitar y corregir.']
    ]),
    section('Manifest (FedEx only)','Manifiesto (solo FedEx)',[
      ['Upload daily FedEx PDF; system highlights missing items vs scans.','Cargue el PDF diario de FedEx; el sistema resalta faltantes versus escaneos.']
    ]),
    section('Common Mistakes','Errores Comunes',[
      ['No damage photos; blurry images.','Sin fotos del daño; imágenes borrosas.'],
      ['Wrong classification; ask if unsure.','Clasificación incorrecta; pregunte si no está seguro.'],
      ['Not separating multiple parts.','No separar múltiples piezas.']
    ])
  ].join('');
  $('#printManual').addEventListener('click', ()=> window.print());

  function section(titleEN,titleES,rows){
    const lis = rows.map(([en,es])=>`<li><b>EN</b> ${en}<br><b>ES</b> ${es}</li>`).join('');
    return `<div class="sec"><h4>${titleEN} / <span class="small">${titleES}</span></h4><ul>${lis}</ul></div>`;
  }
}

const QUIZ = [
  {
    q_en:'What classification applies to a broken, unusable part?',
    q_es:'¿Qué clasificación aplica a una pieza rota e inutilizable?',
    opts:[
      ['Good','Bueno'],['Used','Usado'],['Core','Núcleo'],['Damage','Dañado']
    ],
    ans:3
  },
  {
    q_en:'Packing slip lists a part but the item is not inside the box. What do you select?',
    q_es:'El albarán indica una pieza pero el artículo no está en la caja. ¿Qué selecciona?',
    opts:[
      ['Missing','Perdido'],['Core','Núcleo'],['Not Our Part','No es Nuestra Parte'],['Used','Usado']
    ],
    ans:0
  },
  {
    q_en:'If unsure about classification, who should you ask?',
    q_es:'Si no está seguro sobre la clasificación, ¿a quién debe preguntar?',
    opts:[
      ['Customer','Cliente'],['Supervisor/Trainer','Supervisor/Capacitador'],['Peer','Compañero'],['No one','Nadie']
    ],
    ans:1
  },
  {
    q_en:'When should you take close-up photos?',
    q_es:'¿Cuándo debe tomar fotos de acercamiento?',
    opts:[
      ['Only for Good items','Solo para artículos Buenos'],
      ['Whenever damage or identifying marks are present','Siempre que haya daño o marcas identificativas'],
      ['Never','Nunca'],
      ['Only for Core','Solo para Núcleo']
    ],
    ans:1
  }
];

function renderQuiz(){
  const area = $('#quiz_area'); area.innerHTML='';
  $('#quiz_result').textContent='';
  const form = document.createElement('form');
  QUIZ.forEach((q,qi)=>{
    const block = document.createElement('div');
    block.className='sec';
    let html = `<div><strong>Q${qi+1}.</strong> EN: ${q.q_en}<br>ES: ${q.q_es}</div>`;
    q.opts.forEach((o,oi)=>{
      html += `<label style="display:block;margin-top:6px"><input type="radio" name="q${qi}" value="${oi}"> EN: ${o[0]} &nbsp; / &nbsp; ES: ${o[1]}</label>`;
    });
    block.innerHTML = html;
    form.appendChild(block);
  });
  const submit = document.createElement('button');
  submit.type='submit'; submit.className='btn'; submit.textContent='Submit / Enviar';
  form.appendChild(submit);
  area.appendChild(form);

  form.addEventListener('submit',(e)=>{
    e.preventDefault();
    let score=0;
    QUIZ.forEach((q,qi)=>{
      const sel = form.querySelector(`input[name="q${qi}"]:checked`);
      if(sel && Number(sel.value)===q.ans) score++;
    });
    $('#quiz_result').textContent = `Score: ${score} / ${QUIZ.length}`;
  });
}
$('#start_quiz').addEventListener('click', renderQuiz);

/*****************
 * SETTINGS / ADMIN
 *****************/
$('#admin_login').addEventListener('click', ()=>{
  const u = $('#admin_user').value.trim();
  const p = $('#admin_pass').value.trim();
  if(!u || !p){ toast('Enter user & password'); return; }
  // simple check: accept anything non-empty (you can swap to real auth if needed)
  state.admin = u;
  localStorage.setItem(LS.admin, u);
  $('#admin_hint').textContent = u;
  $('#admin_logout').style.display='inline-block';
  $('#admin_only').style.display='block';
  $('#manifestTab').style.display='inline-block';
  toast('Admin logged in');
});
$('#admin_logout').addEventListener('click', ()=>{
  localStorage.removeItem(LS.admin);
  state.admin=null; $('#admin_hint').textContent='—';
  $('#admin_logout').style.display='none';
  $('#admin_only').style.display='none';
  $('#manifestTab').style.display='none';
  toast('Admin logged out');
});

$('#save_goal').addEventListener('click', ()=>{
  state.goals.scannerDaily = Number($('#goal_scanners').value)||0;
  saveLS('goals'); renderHome(); toast('Goal saved.');
});

$('#printReport').addEventListener('click', ()=> window.print());

/*****************
 * HOME HELPERS (init inputs)
 *****************/
function initDates(){
  if($('#cr_date')) $('#cr_date').value = todayStr();
  if($('#rk_date')) $('#rk_date').value = todayStr();
}

/*****************
 * INIT
 *****************/
async function init(){
  loadLS();
  initDates();
  await fetchReturns();
  renderHome();
  renderScanners();
  await populateScannerSelector();
  await renderScannersTotalChart();
  renderCarriers();
  renderRacks();
  renderClassifications();
  renderMiss();
  renderManual();

  // periodic refresh
  setInterval(async ()=>{
    await fetchReturns();
    renderHome();
    renderScanners();
    await populateScannerSelector();
    await renderScannersTotalChart();
    renderClassifications();
    // manifest comparison auto-updates if panel open and manifest loaded
  }, REFRESH_MS);
}

init();
