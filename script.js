/* Production script - simplified functional version (patched) */
const KEYS = {
  admins: 'rrpd_admins',
  training: 'rrpd_training',
  carriers: 'rrpd_carriers',
  scanners: 'rrpd_scanners',
  racks: 'rrpd_racks',
  class: 'rrpd_class',
  logs: 'rrpd_logs',
  archive: 'rrpd_archive',
  goals: 'rrpd_goals',
  prefs: 'rrpd_prefs',
  quiz: 'rrpd_quiz'
};

const DEFAULT_ADMIN = { name: 'ReesW', pass: 'DAX2025' };
const DEFAULT_TRAIN = 'TRAIN2025';

// ---------------------- small helpers ----------------------
function $(id) { return document.getElementById(id); }
function lsGet(k){ try { return JSON.parse(localStorage.getItem(k)) ?? []; } catch(e){ return []; } }
function lsSet(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function nowISO(){ return new Date().toISOString(); }
function num(v){ return Number(v); } // don't coerce blanks to 0 silently
function toast(msg){
  const t = $('toast'); if(!t) return;
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(()=> t.className='toast', 2000);
}

// ---------------------- seed data (first run) ----------------------
function seed(){
  if(!localStorage.getItem(KEYS.admins)) lsSet(KEYS.admins, [DEFAULT_ADMIN]);
  if(!localStorage.getItem(KEYS.training)) localStorage.setItem(KEYS.training, DEFAULT_TRAIN);
  if(!localStorage.getItem(KEYS.scanners)) lsSet(KEYS.scanners, [
    {date:'2025-09-21',name:'ReesW',count:564,ts:nowISO()},
    {date:'2025-09-21',name:'Ceas',count:645,ts:nowISO()},
    {date:'2025-09-21',name:'Jeff',count:435,ts:nowISO()},
    {date:'2025-09-21',name:'Julio',count:752,ts:nowISO()},
  ]);
  if(!localStorage.getItem(KEYS.racks)) lsSet(KEYS.racks, [
    {date:'2025-09-21',r_total:44,r_core:32,er_total:3,er_core:87,ax_good:54,ax_used:45,ds_good:68,ds_used:75,gb_good:74,gb_used:5,ts:nowISO()}
  ]);
  if(!localStorage.getItem(KEYS.class)) lsSet(KEYS.class, [
    {date:'2025-09-21',good:234,used:356,core:563,damaged:45,missing:5,notour:57,ts:nowISO()}
  ]);
  if(!localStorage.getItem(KEYS.carriers)) lsSet(KEYS.carriers, [
    {date:'2025-09-21',FedEx:523,UPS:556,USPS:453,Other:321,ts:nowISO()}
  ]);
  if(!localStorage.getItem(KEYS.logs)) lsSet(KEYS.logs, []);
  if(!localStorage.getItem(KEYS.archive)) lsSet(KEYS.archive, []);
  if(!localStorage.getItem(KEYS.goals)) lsSet(KEYS.goals, {racks:200,eracks:50,axles:100,driveshafts:80,gearboxes:40});
  if(!localStorage.getItem(KEYS.prefs)) lsSet(KEYS.prefs, {sound:false,autocalc:true,ui_lang:'en'});
  if(!localStorage.getItem(KEYS.quiz)) lsSet(KEYS.quiz, [
    {q:'What should you protect and not lose when opening a box?',opts:['Labels','Parts','Tools','Invoice'],ans:0},
    {q:'Which classification means broken/unusable?',opts:['Good','Used','Damaged','Core'],ans:2},
    {q:'How do you recognize a core part?',opts:['Marked CORE','Color','Weight','Sticker'],ans:0},
    {q:'Who to ask if unsure?',opts:['Customer','Supervisor','Trainer','Peer'],ans:1},
    {q:'What to scan from package?',opts:['Tracking number','Label only','Inner part','Packing slip'],ans:0},
    {q:'If parts are missing?',opts:['Ignore','Mark Missing','Return later','Throw away'],ans:1},
    {q:'Used parts classified by?',opts:['Condition','Color','Weight','Size'],ans:0},
    {q:'Not Our Part indicates?',opts:['Different brand','Same brand','Same factory','Unknown'],ans:0}
  ]);
}
seed();

// ---------------------- logs ----------------------
function pushLog(panel, action, details){
  const logs = lsGet(KEYS.logs) || [];
  logs.push({ts:nowISO(), panel, action, details, user: localStorage.getItem('rrpd_admin_user') || 'user'});
  lsSet(KEYS.logs, logs);
}

// ---------------------- Chart.js ----------------------
const CHS = {};
function makeChart(id, type, labels, datasets){
  try{
    const el = $(id);
    if(!el) return;
    const ctx = el.getContext('2d');
    if(!ctx) return;
    if(CHS[id]) CHS[id].destroy();
    const cfg = {
      type,
      data: { labels, datasets },
      options:{
        responsive:true,
        plugins:{ legend:{ position:'bottom' } },
        scales: (type === 'bar') ? { x:{ stacked:true }, y:{ stacked:true } } : {}
      }
    };
    CHS[id] = new Chart(ctx, cfg);
  }catch(e){ console.error(e); }
}

// ---------------------- renderers ----------------------
function sum(arr, key){ return (arr||[]).reduce((s,i)=> s + (Number(i[key])||0), 0); }

function renderCarriers(){
  const raw = lsGet(KEYS.carriers) || [];
  const tbl = $('carrier_table');
  if(tbl){
    let html = '<table><tr><th>Date</th><th>FedEx</th><th>UPS</th><th>USPS</th><th>Other</th></tr>';
    raw.forEach(r=>{
      html += `<tr><td>${r.date}</td><td>${r.FedEx||0}</td><td>${r.UPS||0}</td><td>${r.USPS||0}</td><td>${r.Other||0}</td></tr>`;
    });
    html += '</table>';
    tbl.innerHTML = html;
  }
  const sums = raw.reduce((a,r)=>{
    a[0]+=Number(r.FedEx)||0; a[1]+=Number(r.UPS)||0; a[2]+=Number(r.USPS)||0; a[3]+=Number(r.Other)||0; return a;
  }, [0,0,0,0]);
  makeChart('carrier_pie', 'doughnut', ['FedEx','UPS','USPS','Other'], [{data:sums}]);
  makeChart('carrier_group','bar', raw.map(r=>r.date), [
    {label:'FedEx',data:raw.map(r=>Number(r.FedEx)||0)},
    {label:'UPS',data:raw.map(r=>Number(r.UPS)||0)},
    {label:'USPS',data:raw.map(r=>Number(r.USPS)||0)},
    {label:'Other',data:raw.map(r=>Number(r.Other)||0)}
  ]);
}

function renderScanners(){
  const sc = lsGet(KEYS.scanners) || [];
  const map = {};
  sc.forEach(s=> map[s.name] = (map[s.name]||0) + (Number(s.count)||0));
  const arr = Object.keys(map).map(n=>({name:n, count:map[n]})).sort((a,b)=> b.count - a.count);

  // Per-panel leaderboards (handles duplicate IDs in HTML)
  const lbScanners = document.querySelector('#scanners #leaderboard');
  const lbLogs     = document.querySelector('#logs #leaderboard');

  const lbHtml = arr.map((r,i)=> `${i+1}. ${r.name} — ${r.count}`).join('<br>');
  if(lbScanners) lbScanners.innerHTML = lbHtml;
  if(lbLogs)     lbLogs.innerHTML     = lbHtml;

  makeChart('scanner_bar','bar', arr.map(a=>a.name), [{label:'Scans', data: arr.map(a=>a.count)}]);

  // Scanner Manager table (in Scanners panel)
  const mgrWrap = $('scanner_manager');
  if(mgrWrap){
    let mgr = '<table><tr><th>Name</th><th>Count</th><th>Actions</th></tr>';
    arr.forEach(a=>{
      mgr += `<tr><td>${a.name}</td><td>${a.count}</td><td>
        <button class="btn" onclick="adjustScanner('${a.name}',10)">+10</button>
        <button class="btn alt" onclick="adjustScanner('${a.name}',-10)">-10</button>
      </td></tr>`;
    });
    mgr += '</table>';
    mgrWrap.innerHTML = mgr;
  }
}

function renderRacks(){
  const raw = lsGet(KEYS.racks) || [];
  const totals = {
    r_total: sum(raw,'r_total'), r_core: sum(raw,'r_core'),
    er_total: sum(raw,'er_total'), er_core: sum(raw,'er_core'),
    ax_good: sum(raw,'ax_good'), ax_used: sum(raw,'ax_used'),
    ds_good: sum(raw,'ds_good'), ds_used: sum(raw,'ds_used'),
    gb_good: sum(raw,'gb_good'), gb_used: sum(raw,'gb_used')
  };

  const racksGood = Math.max(0, totals.r_total - totals.r_core);
  const eracksGood = Math.max(0, totals.er_total - totals.er_core);

  if($('donut_racks_text')) $('donut_racks_text').innerText = `Racks Good:${racksGood} Core:${totals.r_core}`;
  makeChart('donut_racks','doughnut',['Good','Core'],[{data:[racksGood, totals.r_core]}]);
  makeChart('donut_eracks','doughnut',['Good','Core'],[{data:[eracksGood, totals.er_core]}]);
  makeChart('donut_axles','doughnut',['Good','Used'],[{data:[totals.ax_good, totals.ax_used]}]);
  makeChart('donut_ds','doughnut',['Good','Used'],[{data:[totals.ds_good, totals.ds_used]}]);
  makeChart('donut_gb','doughnut',['Good','Used'],[{data:[totals.gb_good, totals.gb_used]}]);

  const megaGood = racksGood + eracksGood + totals.ax_good + totals.ds_good + totals.gb_good;
  const megaCore = totals.r_core + totals.er_core;
  const megaUsed = totals.ax_used + totals.ds_used + totals.gb_used;
  makeChart('mega_donut','doughnut',['Good','Core','Used'],[{data:[megaGood, megaCore, megaUsed]}]);

  renderLogTable('racks','racks_log');
  renderLeaderboard(); // sync the leaderboard in Logs panel
}

function renderClass(){
  const raw = lsGet(KEYS.class) || [];
  const good = sum(raw,'good'), used = sum(raw,'used'), core = sum(raw,'core'),
        damaged = sum(raw,'damaged'), missing = sum(raw,'missing'), notour = sum(raw,'notour');

  if($('class_text')) $('class_text').innerText = `Good:${good} Used:${used} Core:${core}`;
  makeChart('class_donut','doughnut', ['Good','Used','Core','Damaged','Missing','NotOur'], [{data:[good,used,core,damaged,missing,notour]}]);

  renderLogTable('classifications','log_class');
}

function renderCharts(){
  const raw = lsGet(KEYS.racks) || [];
  const totals = {
    r_total: sum(raw,'r_total'), r_core: sum(raw,'r_core'),
    er_total: sum(raw,'er_total'), er_core: sum(raw,'er_core'),
    ax_good: sum(raw,'ax_good'), ax_used: sum(raw,'ax_used'),
    ds_good: sum(raw,'ds_good'), ds_used: sum(raw,'ds_used'),
    gb_good: sum(raw,'gb_good'), gb_used: sum(raw,'gb_used')
  };

  const dataGood = [
    Math.max(0, totals.r_total - totals.r_core),
    Math.max(0, totals.er_total - totals.er_core),
    totals.ax_good, totals.ds_good, totals.gb_good
  ];
  const dataOther = [totals.r_core, totals.er_core, totals.ax_used, totals.ds_used, totals.gb_used];

  makeChart('stacked_all','bar',
    ['Racks','E.Racks','Axles','DriveShafts','Gearboxes'],
    [{label:'Good',data:dataGood}, {label:'Core/Used',data:dataOther}]
  );
}

function renderManual(){
  const en = $('manual_en'), es = $('manual_es');
  if(en) en.innerHTML = '<h4>Receiving Parts — Step by step</h4><ol><li>Inspect box.</li><li>Open carefully, keep labels.</li><li>Scan tracking number and classify.</li></ol>';
  if(es) es.innerHTML = '<h4>Recepción de piezas — Paso a paso</h4><ol><li>Inspeccione la caja.</li><li>Abrir con cuidado, conservar etiquetas.</li><li>Escanear número de seguimiento y clasificar.</li></ol>';
}

function renderLogs(){
  const logs = lsGet(KEYS.logs) || [];
  const wrap = $('all_logs_table');
  if(wrap){
    let html = '<table><tr><th>Time</th><th>Panel</th><th>User</th><th>Action</th><th>Details</th></tr>';
    logs.slice().reverse().forEach(l=>{
      html += `<tr><td>${new Date(l.ts).toLocaleString()}</td><td>${l.panel}</td><td>${l.user}</td><td>${l.action}</td><td>${l.details}</td></tr>`;
    });
    html += '</table>';
    wrap.innerHTML = html;
  }
  renderLeaderboard();
}

function renderLogTable(panel, containerId){
  const logs = lsGet(KEYS.logs) || [];
  const rows = logs.filter(r=> r.panel === panel);
  const el = $(containerId);
  if(!el) return;
  let html = '<table><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr>';
  rows.slice().reverse().forEach(r=>{
    html += `<tr><td>${new Date(r.ts).toLocaleString()}</td><td>${r.user}</td><td>${r.action}</td><td>${r.details}</td></tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// Sync leaderboards in Logs panel (uses renderScanners data)
function renderLeaderboard(){ renderScanners(); }

// ---------------------- input handling ----------------------
const diBtn = $('di_submit');
if(diBtn){
  diBtn.addEventListener('click', ()=>{
    const cat  = $('di_category')?.value;
    const date = $('di_date')?.value || new Date().toISOString().slice(0,10);
    const n1v  = $('di_num1')?.value;
    const n2v  = $('di_num2')?.value;
    const txt  = $('di_txt')?.value?.trim() || '';

    // Validate numbers only for categories that expect them
    const needNums = ['carriers','racks','eracks','axles','driveshafts','gearboxes','classifications','scanners'];
    if(needNums.includes(cat)){
      const n1 = num(n1v), n2 = num(n2v);
      if(Number.isNaN(n1) || Number.isNaN(n2)){
        toast('Enter valid numbers for Value 1 / Value 2');
        return;
      }

      if(cat==='carriers'){
        const arr = lsGet(KEYS.carriers) || [];
        arr.push({date, FedEx:n1, UPS:n2, USPS:0, Other:0, ts:nowISO(), note:txt});
        lsSet(KEYS.carriers, arr);
        pushLog('carriers','add', JSON.stringify({date,n1:n1, n2:n2, txt}));
        toast('Carrier saved');
        renderCarriers(); return;
      }
      if(cat==='racks'){ mergeRacks(date,{r_total:n1, r_core:n2}); pushLog('racks','add', JSON.stringify({date,n1,n2})); toast('Racks saved'); renderRacks(); return; }
      if(cat==='eracks'){ mergeRacks(date,{er_total:n1, er_core:n2}); pushLog('racks','add_er', JSON.stringify({date,n1,n2})); toast('E-Racks saved'); renderRacks(); return; }
      if(cat==='axles'){ mergeRacks(date,{ax_good:n1, ax_used:n2}); pushLog('racks','add_ax', JSON.stringify({date,n1,n2})); toast('Axles saved'); renderRacks(); return; }
      if(cat==='driveshafts'){ mergeRacks(date,{ds_good:n1, ds_used:n2}); pushLog('racks','add_ds', JSON.stringify({date,n1,n2})); toast('DS saved'); renderRacks(); return; }
      if(cat==='gearboxes'){ mergeRacks(date,{gb_good:n1, gb_used:n2}); pushLog('racks','add_gb', JSON.stringify({date,n1,n2})); toast('GB saved'); renderRacks(); return; }
      if(cat==='classifications'){
        const arr = lsGet(KEYS.class) || [];
        arr.push({date, good:n1, used:n2, core:0, damaged:0, missing:0, notour:0, ts:nowISO()});
        lsSet(KEYS.class, arr);
        pushLog('classifications','add', JSON.stringify({date,n1:n1,n2:n2}));
        toast('Classification saved'); renderClass(); return;
      }
      if(cat==='scanners'){
        const arr = lsGet(KEYS.scanners) || [];
        arr.push({date, name: txt || 'Scanner', count: n1, ts: nowISO()});
        lsSet(KEYS.scanners, arr);
        pushLog('scanners','add', JSON.stringify({date,txt,n1}));
        toast('Scanner saved'); renderScanners(); return;
      }
    }

    toast('Unknown category');
  });
}

function mergeRacks(date, updates){
  const arr = lsGet(KEYS.racks) || [];
  const idx = arr.findIndex(x=> x.date === date);
  if(idx>=0){
    arr[idx] = Object.assign({}, arr[idx], updates, {ts:nowISO()});
  } else {
    const base = {r_total:0,r_core:0,er_total:0,er_core:0,ax_good:0,ax_used:0,ds_good:0,ds_used:0,gb_good:0,gb_used:0};
    const o = Object.assign({}, base, updates, {date, ts:nowISO()});
    arr.push(o);
  }
  lsSet(KEYS.racks, arr);
}

// scanner adjust (exposed globally for buttons)
window.adjustScanner = function(name, delta){
  const sc = lsGet(KEYS.scanners) || [];
  sc.push({date:new Date().toISOString().slice(0,10), name, count: delta, ts: nowISO()});
  lsSet(KEYS.scanners, sc);
  pushLog('scanners','adjust', `${name} ${delta}`);
  renderScanners();
  toast('Scanner adjusted');
};

// ---------------------- backup/export ----------------------
const backupBtn = $('backup_json');
if(backupBtn){
  backupBtn.addEventListener('click', ()=>{
    const payload = {
      racks: lsGet(KEYS.racks),
      class: lsGet(KEYS.class),
      scanners: lsGet(KEYS.scanners),
      carriers: lsGet(KEYS.carriers),
      logs: lsGet(KEYS.logs),
      admins: lsGet(KEYS.admins),
      goals: lsGet(KEYS.goals),
      prefs: lsGet(KEYS.prefs)
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rrpd_backup_' + (new Date().toISOString().slice(0,10)) + '.json';
    a.click();
    toast('Backup downloaded');
  });
}

const exportCsvBtn = $('export_csv');
if(exportCsvBtn){
  exportCsvBtn.addEventListener('click', ()=>{
    const logs = lsGet(KEYS.logs) || [];
    if(!logs.length){ alert('No logs'); return; }
    const cols = ['ts','panel','user','action','details'];
    const rows = logs.map(r=> cols.map(c=> JSON.stringify(r[c] ?? '') ).join(','));
    const csv = [cols.join(',')].concat(rows).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rrpd_logs_' + (new Date().toISOString().slice(0,10)) + '.csv';
    a.click();
    toast('CSV exported');
  });
}

// ---------------------- admin login/create & settings ----------------------
const loginBtn = $('admin_login');
if(loginBtn){
  loginBtn.addEventListener('click', ()=>{
    const user = $('admin_user')?.value || DEFAULT_ADMIN.name;
    const pass = $('admin_pass')?.value || DEFAULT_ADMIN.pass;
    const admins = lsGet(KEYS.admins) || [];
    const ok = admins.find(a=> a.name===user && a.pass===pass);
    if(!ok){ alert('Unauthorized'); return; }
    localStorage.setItem('rrpd_admin_user', user);
    if($('admin_controls')) $('admin_controls').style.display = 'block';
    if($('admin_logout')) $('admin_logout').style.display = 'inline-block';
    if($('admin_hint')) $('admin_hint').innerText = user;
    pushLog('settings','login', user);
    toast('Admin logged in');
    renderSettings();
  });
}

const logoutBtn = $('admin_logout');
if(logoutBtn){
  logoutBtn.addEventListener('click', ()=>{
    if(!confirm('Logout admin?')) return;
    localStorage.removeItem('rrpd_admin_user');
    if($('admin_controls')) $('admin_controls').style.display = 'none';
    if($('admin_logout')) $('admin_logout').style.display = 'none';
    if($('admin_hint')) $('admin_hint').innerText = '—';
    pushLog('settings','logout','');
    toast('Admin logged out');
  });
}

const createAdminBtn = $('create_admin');
if(createAdminBtn){
  createAdminBtn.addEventListener('click', ()=>{
    const n = $('new_admin_name')?.value.trim();
    const p = $('new_admin_pass')?.value.trim();
    if(!n || !p){ alert('Name and pass required'); return; }
    const arr = lsGet(KEYS.admins) || [];
    arr.push({name:n, pass:p});
    lsSet(KEYS.admins, arr);
    pushLog('settings','create_admin', n);
    toast('Admin created');
    renderSettings();
  });
}

// goals & prefs save
const saveGoalsBtn = $('save_goals');
if(saveGoalsBtn){
  saveGoalsBtn.addEventListener('click', ()=>{
    const goals = {
      racks: Number($('goal_racks')?.value)||0,
      eracks: Number($('goal_eracks')?.value)||0,
      axles: Number($('goal_axles')?.value)||0,
      driveshafts: Number($('goal_ds')?.value)||0,
      gearboxes: Number($('goal_gb')?.value)||0
    };
    lsSet(KEYS.goals, goals);
    pushLog('settings','save_goals', JSON.stringify(goals));
    toast('Goals saved');
  });
}

const prefSound = $('pref_sound');
if(prefSound){
  prefSound.addEventListener('change', ()=>{
    const prefs = Object.assign({sound:false,autocalc:true,ui_lang:'en'}, lsGet(KEYS.prefs));
    prefs.sound = !!prefSound.checked;
    lsSet(KEYS.prefs, prefs);
    toast('Preference saved');
  });
}

const prefAuto = $('pref_autocalc');
if(prefAuto){
  prefAuto.addEventListener('change', ()=>{
    const prefs = Object.assign({sound:false,autocalc:true,ui_lang:'en'}, lsGet(KEYS.prefs));
    prefs.autocalc = !!prefAuto.checked;
    lsSet(KEYS.prefs, prefs);
    toast('Preference saved');
  });
}

const uiLang = $('ui_lang');
if(uiLang){
  uiLang.addEventListener('change', ()=>{
    const prefs = Object.assign({sound:false,autocalc:true,ui_lang:'en'}, lsGet(KEYS.prefs));
    prefs.ui_lang = uiLang.value || 'en';
    lsSet(KEYS.prefs, prefs);
    toast('UI language set (content is static demo)');
  });
}

function renderSettings(){
  // restore goals/prefs into inputs
  const goals = lsGet(KEYS.goals) || {};
  if($('goal_racks')) $('goal_racks').value = goals.racks ?? '';
  if($('goal_eracks')) $('goal_eracks').value = goals.eracks ?? '';
  if($('goal_axles')) $('goal_axles').value = goals.axles ?? '';
  if($('goal_ds')) $('goal_ds').value = goals.driveshafts ?? '';
  if($('goal_gb')) $('goal_gb').value = goals.gearboxes ?? '';

  const prefs = Object.assign({sound:false,autocalc:true,ui_lang:'en'}, lsGet(KEYS.prefs));
  if($('pref_sound')) $('pref_sound').checked = !!prefs.sound;
  if($('pref_autocalc')) $('pref_autocalc').checked = !!prefs.autocalc;
  if($('ui_lang')) $('ui_lang').value = prefs.ui_lang || 'en';

  // show admin panel if logged in already
  const user = localStorage.getItem('rrpd_admin_user');
  if(user){
    if($('admin_controls')) $('admin_controls').style.display = 'block';
    if($('admin_logout')) $('admin_logout').style.display = 'inline-block';
    if($('admin_hint')) $('admin_hint').innerText = user;
  }
}

// ---------------------- archive / clear ----------------------
const clearLogsBtn = $('clear_logs_btn');
if(clearLogsBtn){
  clearLogsBtn.addEventListener('click', ()=>{
    if(!localStorage.getItem('rrpd_admin_user')){ alert('Admin required'); return; }
    const logs = lsGet(KEYS.logs) || [];
    const arch = lsGet(KEYS.archive) || [];
    arch.push({ts:nowISO(), type:'logs', data:logs});
    lsSet(KEYS.archive, arch);
    lsSet(KEYS.logs, []);
    toast('Logs archived');
    renderLogs();
  });
}

const clearAllBtn = $('clear_all_btn');
if(clearAllBtn){
  clearAllBtn.addEventListener('click', ()=>{
    if(!confirm('Clear ALL data? (will archive)')) return;
    const archive = lsGet(KEYS.archive) || [];
    archive.push({ts:nowISO(), type:'all', data:{
      racks:lsGet(KEYS.racks), class:lsGet(KEYS.class),
      scanners:lsGet(KEYS.scanners), carriers:lsGet(KEYS.carriers)
    }});
    lsSet(KEYS.archive, archive);
    lsSet(KEYS.racks, []); lsSet(KEYS.class, []); lsSet(KEYS.scanners, []); lsSet(KEYS.carriers, []); lsSet(KEYS.logs, []);
    toast('All data archived');
    renderRacks(); renderClass(); renderScanners(); renderCarriers(); renderLogs();
  });
}

const viewArchBtn = $('view_archive');
if(viewArchBtn){
  viewArchBtn.addEventListener('click', ()=>{
    const arch = lsGet(KEYS.archive) || [];
    const w = window.open('', 'archive', 'width=800,height=600');
    if(!w){ alert('Popup blocked'); return; }
    w.document.write('<pre>'+JSON.stringify(arch,null,2)+'</pre>');
  });
}

const restoreAllBtn = $('restore_all');
if(restoreAllBtn){
  restoreAllBtn.addEventListener('click', ()=>{
    if(!confirm('Restore all archived data?')) return;
    const arch = lsGet(KEYS.archive) || [];
    if(!arch.length){ alert('No archive'); return; }
    const last = arch.pop();
    if(last.type==='all'){
      lsSet(KEYS.racks, last.data.racks);
      lsSet(KEYS.class, last.data.class);
      lsSet(KEYS.scanners, last.data.scanners);
      lsSet(KEYS.carriers, last.data.carriers);
      lsSet(KEYS.logs, []);
      lsSet(KEYS.archive, arch);
      toast('Restored last archive');
      renderRacks(); renderClass(); renderScanners(); renderCarriers(); renderLogs();
    } else alert('No full archive found');
  });
}

// ---------------------- quiz ----------------------
const startQuizBtn = $('start_quiz');
if(startQuizBtn){
  startQuizBtn.addEventListener('click', ()=>{
    const code = prompt('Enter training code:');
    const tc = localStorage.getItem(KEYS.training) || DEFAULT_TRAIN;
    if(code !== tc){ alert('Incorrect code'); return; }
    const qs = lsGet(KEYS.quiz) || [];
    const popup = window.open('', 'quiz', 'width=700,height=700');
    if(!popup){ alert('Popup blocked'); return; }
    let html = '<html><head><title>Quiz</title></head><body><h3>Training Quiz</h3><form id="qform">';
    qs.forEach((q,i)=>{
      html += `<div><strong>${i+1}. ${q.q}</strong>`;
      q.opts.forEach((o,j)=> html += `<div><label><input type="radio" name="q${i}" value="${j}"> ${o}</label></div>`);
      html += '</div><hr>';
    });
    html += '<button type="button" id="submit">Submit</button><div id="result"></div></form><script>document.getElementById("submit").addEventListener("click",()=>{const quiz='+JSON.stringify(lsGet(KEYS.quiz))+';let score=0;quiz.forEach((q,i)=>{const sel=document.querySelector("input[name=\\"q"+i+"\\"]:checked"); if(sel && Number(sel.value)===q.ans) score++;}); document.getElementById("result").innerText="Score: "+score+" / "+quiz.length; window.opener.postMessage({type:"quiz_result",score:score,total:quiz.length},"*");});</script></body></html>';
    popup.document.write(html);
    popup.document.close();
  });
}

window.addEventListener('message', (e)=>{
  if(e.data && e.data.type==='quiz_result'){
    const logs = lsGet(KEYS.logs) || [];
    logs.push({ts:nowISO(), panel:'quiz', action:'result', details:JSON.stringify(e.data), user: localStorage.getItem('rrpd_admin_user')||'user'});
    lsSet(KEYS.logs, logs);
    toast('Quiz result saved');
    renderLogs();
  }
});

// ---------------------- Miss Inspections (guarded) ----------------------
const MISS_KEY = 'rrpd_miss';

function renderMiss(){
  const arr = lsGet(MISS_KEY) || [];
  const container = $('miss_table');
  if(!container) return;
  let html = '<table><thead><tr><th>Date</th><th>Issue</th></tr></thead><tbody>';
  arr.slice().reverse().forEach(r=>{
    html += `<tr><td>${r.date}</td><td>${r.issue}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

const missSubmit = $('miss_submit');
if(missSubmit){
  missSubmit.addEventListener('click', ()=>{
    const date = $('miss_date')?.value || new Date().toISOString().slice(0,10);
    const issue = $('miss_issue')?.value?.trim();
    if(!issue){ alert('Please enter a problem'); return; }
    const arr = lsGet(MISS_KEY) || [];
    arr.push({date, issue, ts: nowISO()});
    lsSet(MISS_KEY, arr);
    pushLog('miss','save_miss', issue); // fixed: was addLog
    toast('Miss Inspection saved');
    renderMiss();
    if($('miss_issue')) $('miss_issue').value='';
  });
}

// ---------------------- logs small bindings (guarded) ----------------------
const logRefresh = $('log_refresh');
if(logRefresh) logRefresh.addEventListener('click', ()=> renderLogs());
const logSearch = $('log_search');
if(logSearch) logSearch.addEventListener('input', ()=> renderLogs());

// ---------------------- navigation ----------------------
function openPanel(id){
  document.querySelectorAll('.panel').forEach(p=> p.classList.remove('active'));
  const target = $(id);
  if(target) target.classList.add('active');
}
window.openPanel = openPanel; // optional global

document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> openPanel(btn.dataset.panel));
});

// ---------------------- initial boot ----------------------
(function boot(){
  // Restore admin UI on reload
  const user = localStorage.getItem('rrpd_admin_user');
  if(user){
    if($('admin_controls')) $('admin_controls').style.display = 'block';
    if($('admin_logout')) $('admin_logout').style.display = 'inline-block';
    if($('admin_hint')) $('admin_hint').innerText = user;
  }

  openPanel('home');
  renderCarriers();
  renderScanners();
  renderRacks();
  renderClass();
  renderCharts();
  renderManual();
  renderLogs();
  renderMiss();
  renderSettings();

  // clock
  setInterval(()=>{ const c = $('clock'); if(c) c.innerText = new Date().toLocaleTimeString(); }, 1000);
})();
