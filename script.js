/* ===== SETTINGS (keep endpoints as-is) ===== */
const ENDPOINT_RETURNS = '/.netlify/functions/returns';
const ENDPOINT_PHOTOS  = '/.netlify/functions/photos';

/* ===== DOM ===== */
const statusText = document.getElementById('statusText');
const tabs = document.querySelectorAll('.tab');
const panels = {
  scanners: document.getElementById('panel-scanners'),
  classifications: document.getElementById('panel-classifications'),
  miss: document.getElementById('panel-miss'),
};
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    tabs.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(panels).forEach(p=>p.classList.remove('active'));
    panels[btn.dataset.panel].classList.add('active');
  });
});
document.getElementById('refreshBtn').addEventListener('click', ()=> boot(true));

/* ===== STATE ===== */
let returnsCache = [];       // from API
let manualScanners = [];     // [{name,count,dateISO}]
let charts = {};             // hold Chart instances

/* ===== UTIL ===== */
const fmtDate = d => d.toISOString().slice(0,10); // YYYY-MM-DD
function startOfWeekEnding(date){
  // week defined as Mon–Sun; “week ending” date is the chosen day (default today)
  const end = new Date(date); end.setHours(0,0,0,0);
  const start = new Date(end); const dow = (end.getDay()+6)%7;
  start.setDate(end.getDate()-dow); // Monday
  return {start, end};
}
function groupBy(arr, keyFn){
  const m = new Map();
  for(const x of arr){ const k = keyFn(x); m.set(k,(m.get(k)||0)+1); }
  return m;
}
function destroyChart(id){
  if (charts[id]) { charts[id].destroy(); charts[id] = null; }
}
function colorSet(n){
  // distinct pleasant hues
  const base = [ '#1e88e5','#43a047','#fb8c00','#e53935','#8e24aa','#00897b','#5e35b1','#c0ca33','#6d4c41','#3949ab' ];
  const out = [];
  for(let i=0;i<n;i++) out.push(base[i%base.length]);
  return out;
}

/* ===== FETCH ===== */
async function fetchReturns(){
  const res = await fetch(ENDPOINT_RETURNS, { cache:'no-store' });
  if(!res.ok) throw new Error('returns failed: '+res.status);
  const data = await res.json();    // expecting an array of return rows
  // Normalize minimal fields used:
  // id, track_number, created_at, createdBy, description
  return data;
}

async function fetchPhotosById(id){
  const url = `${ENDPOINT_PHOTOS}?id=${encodeURIComponent(id)}`;
  const res = await fetch(url, { cache:'no-store' });
  if(!res.ok) throw new Error('photos failed');
  return res.json(); // array of file URLs
}

/* ===== RENDER: SCANNERS ===== */
function renderScanners(todayList, weekList){
  // merge manual fallback for TODAY
  const todayISO = fmtDate(new Date());
  const manualToday = manualScanners.filter(x=>x.dateISO===todayISO);
  const manualMap = groupBy(manualToday, x=>x.name);

  const byScannerToday = groupBy(todayList, r => r.createdBy || 'Unknown');
  for (const [k,v] of manualMap) byScannerToday.set(k, (byScannerToday.get(k)||0) + v);
  const namesToday = [...byScannerToday.keys()];
  const countsToday = namesToday.map(n=>byScannerToday.get(n));

  destroyChart('scannersTodayDonut');
  charts.scannersTodayDonut = new Chart(
    document.getElementById('scannersTodayDonut').getContext('2d'),
    {
      type:'doughnut',
      data:{
        labels: namesToday,
        datasets:[{ data: countsToday, backgroundColor: colorSet(namesToday.length) }]
      },
      options:{ plugins:{ legend:{ position:'bottom' }}, cutout:'60%' }
    }
  );

  // week daily (by created_at day, total scans)
  const daysMap = new Map(); // YYYY-MM-DD -> total
  for(const r of weekList){
    const d = r.created_at?.slice(0,10) || 'unknown';
    daysMap.set(d, (daysMap.get(d)||0)+1);
  }
  const labels = [...daysMap.keys()].sort();
  const vals = labels.map(l=>daysMap.get(l));

  destroyChart('scannersDailyBar');
  charts.scannersDailyBar = new Chart(
    document.getElementById('scannersDailyBar').getContext('2d'),
    {
      type:'bar',
      data:{ labels, datasets:[{ label:'Scans', data: vals, backgroundColor: '#1e88e5' }] },
      options:{ plugins:{ legend:{ display:false }}, scales:{ y:{ beginAtZero:true } } }
    }
  );
}

/* ===== RENDER: CLASSIFICATIONS ===== */
function renderClassifications(todayList, weekList){
  const keep = new Set(['Good','Used','Core','Damage','Missing','Not our part']);
  const classToday = todayList.map(r=>r.description).filter(x=>keep.has(x || ''));
  const mapToday = groupBy(classToday, x=>x || 'Unknown');
  const labelsT = [...mapToday.keys()];
  const valsT = labelsT.map(l=>mapToday.get(l));

  destroyChart('classTodayDonut');
  charts.classTodayDonut = new Chart(
    document.getElementById('classTodayDonut').getContext('2d'),
    {
      type:'doughnut',
      data:{ labels:labelsT, datasets:[{ data:valsT, backgroundColor: colorSet(labelsT.length) }] },
      options:{ plugins:{ legend:{ position:'bottom' }}, cutout:'60%' }
    }
  );

  const classWeek = weekList.map(r=>r.description).filter(x=>keep.has(x || ''));
  const byDayClass = new Map(); // day -> count
  for(const r of weekList){
    const d = r.created_at?.slice(0,10) || 'unknown';
    if (!keep.has(r.description||'')) continue;
    byDayClass.set(d, (byDayClass.get(d)||0) + 1);
  }
  const labels = [...byDayClass.keys()].sort();
  const vals = labels.map(l=>byDayClass.get(l));

  destroyChart('classDailyBar');
  charts.classDailyBar = new Chart(
    document.getElementById('classDailyBar').getContext('2d'),
    {
      type:'bar',
      data:{ labels, datasets:[{ label:'Classified', data: vals, backgroundColor: '#43a047' }] },
      options:{ plugins:{ legend:{ display:false }}, scales:{ y:{ beginAtZero:true } } }
    }
  );
}

/* ===== MISS INSPECTIONS ===== */
function wireMiss(){
  const searchForm = document.getElementById('missSearchForm');
  const out = document.getElementById('missResult');
  searchForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    out.innerHTML = 'Searching…';

    const tracking = document.getElementById('missTrack').value.trim();
    if(!tracking){ out.textContent = 'Enter a tracking number.'; return; }

    // find return row by exact track_number
    const row = returnsCache.find(r => (r.track_number||'').replace(/\s+/g,'') === tracking.replace(/\s+/g,''));
    if(!row){ out.textContent = 'No match in returns.'; return; }

    try{
      const photos = await fetchPhotosById(row.id);
      if(!photos || !photos.length){ out.textContent='No photos found.'; return; }
      out.innerHTML = photos.map(src=>`<img src="${src}" alt="photo">`).join('');
      // prefill reason form with tracking
      document.getElementById('missReasonTrack').value = tracking;
    }catch(err){
      out.textContent = 'Photo load failed.';
      console.error(err);
    }
  });

  // reason logger (local only)
  const reasonForm = document.getElementById('missReasonForm');
  const log = document.getElementById('missLog');
  const KEY = 'missReasons';
  const loadLog = () => JSON.parse(localStorage.getItem(KEY)||'[]');
  const saveLog = (rows) => localStorage.setItem(KEY, JSON.stringify(rows));
  function renderLog(){
    const rows = loadLog().slice().reverse().slice(0,50);
    log.innerHTML = rows.map(r=>`<div class="card" style="margin-top:8px">
      <strong>${r.tracking}</strong> — ${r.reason}
      <div class="hint">${new Date(r.ts).toLocaleString()}</div>
    </div>`).join('');
  }
  reasonForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    const t = document.getElementById('missReasonTrack').value.trim();
    const reason = document.getElementById('missReasonText').value.trim();
    if(!t || !reason) return;
    const rows = loadLog();
    rows.push({tracking:t, reason, ts:Date.now()});
    saveLog(rows);
    reasonForm.reset();
    renderLog();
  });
  renderLog();
}

/* ===== MANUAL SCANNER FALLBACK ===== */
function wireScannerManual(){
  const KEY='manualScanners';
  try{ manualScanners = JSON.parse(localStorage.getItem(KEY)||'[]'); }catch{ manualScanners=[]; }
  const form = document.getElementById('scannerManualForm');
  form.addEventListener('submit',(e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    manualScanners.push({ name: fd.get('name').trim(), count: parseInt(fd.get('count'),10)||0, dateISO: fmtDate(new Date()) });
    localStorage.setItem(KEY, JSON.stringify(manualScanners));
    form.reset();
    boot(true); // re-render
  });
}

/* ===== BOOT ===== */
async function boot(force=false){
  statusText.textContent = 'Fetching data…';
  console.log('RRPD Dashboard Loaded');

  // Use selected week end (default today)
  const weekEndInput = document.getElementById('weekEnd');
  const weekEndCInput = document.getElementById('weekEndC');
  const today = new Date();
  if(!weekEndInput.value) weekEndInput.value = fmtDate(today);
  if(!weekEndCInput.value) weekEndCInput.value = fmtDate(today);

  // try fetch
  try{
    if (force || returnsCache.length===0){
      const data = await fetchReturns();
      returnsCache = Array.isArray(data) ? data : [];
      console.log('Return data loaded:', returnsCache.length);
    }
    statusText.textContent = 'Data successfully loaded';
  }catch(err){
    console.warn('API unreachable, using local only.', err);
    statusText.textContent = 'API unreachable — showing local-only data';
  }

  // Make slices
  const tStr = fmtDate(new Date());
  const todayList = returnsCache.filter(r => (r.created_at||'').startsWith(tStr));

  const {start, end} = startOfWeekEnding(new Date(weekEndInput.value||tStr));
  const startStr = fmtDate(start);
  const endStr = fmtDate(end);
  const weekList = returnsCache.filter(r=>{
    const d = (r.created_at||'').slice(0,10);
    return d>=startStr && d<=endStr;
  });

  renderScanners(todayList, weekList);

  const weekEnd2 = new Date(weekEndCInput.value||tStr);
  const {start:s2, end:e2} = startOfWeekEnding(weekEnd2);
  const wStart2 = fmtDate(s2), wEnd2 = fmtDate(e2);
  const weekListC = returnsCache.filter(r=>{
    const d = (r.created_at||'').slice(0,10);
    return d>=wStart2 && d<=wEnd2;
  });
  renderClassifications(todayList, weekListC);
}

/* ===== INIT ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  wireScannerManual();
  wireMiss();
  // week inputs re-render
  document.getElementById('weekEnd').addEventListener('change',()=>boot());
  document.getElementById('weekEndC').addEventListener('change',()=>boot());
  boot();
});
