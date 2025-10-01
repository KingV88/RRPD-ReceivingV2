/* Production script - simplified functional version */
const KEYS={admins:'rrpd_admins',training:'rrpd_training',carriers:'rrpd_carriers',scanners:'rrpd_scanners',racks:'rrpd_racks',class:'rrpd_class',logs:'rrpd_logs',archive:'rrpd_archive',goals:'rrpd_goals',prefs:'rrpd_prefs',quiz:'rrpd_quiz'};
const DEFAULT_ADMIN={name:'ReesW',pass:'DAX2025'}; const DEFAULT_TRAIN='TRAIN2025';

function lsGet(k){try{return JSON.parse(localStorage.getItem(k))||[];}catch(e){return []}} function lsSet(k,v){localStorage.setItem(k,JSON.stringify(v));}
function nowISO(){return new Date().toISOString();} function num(v){return Number(v)||0;}
function toast(msg){const t=document.getElementById('toast'); t.textContent=msg; t.className='toast show'; setTimeout(()=>t.className='toast',2000);}

function seed(){ if(!localStorage.getItem(KEYS.admins)) lsSet(KEYS.admins,[DEFAULT_ADMIN]); if(!localStorage.getItem(KEYS.training)) localStorage.setItem(KEYS.training,DEFAULT_TRAIN); if(!localStorage.getItem(KEYS.scanners)) lsSet(KEYS.scanners,[{date:'2025-09-21',name:'ReesW',count:564,ts:nowISO()},{date:'2025-09-21',name:'Ceas',count:645,ts:nowISO()},{date:'2025-09-21',name:'Jeff',count:435,ts:nowISO()},{date:'2025-09-21',name:'Julio',count:752,ts:nowISO()}]); if(!localStorage.getItem(KEYS.racks)) lsSet(KEYS.racks,[{date:'2025-09-21',r_total:44,r_core:32,er_total:3,er_core:87,ax_good:54,ax_used:45,ds_good:68,ds_used:75,gb_good:74,gb_used:5,ts:nowISO()}]); if(!localStorage.getItem(KEYS.class)) lsSet(KEYS.class,[{date:'2025-09-21',good:234,used:356,core:563,damaged:45,missing:5,notour:57,ts:nowISO()}]); if(!localStorage.getItem(KEYS.carriers)) lsSet(KEYS.carriers,[{date:'2025-09-21',FedEx:523,UPS:556,USPS:453,Other:321,ts:nowISO()}]); if(!localStorage.getItem(KEYS.logs)) lsSet(KEYS.logs,[]); if(!localStorage.getItem(KEYS.archive)) lsSet(KEYS.archive,[]); if(!localStorage.getItem(KEYS.goals)) lsSet(KEYS.goals,{racks:200,eracks:50,axles:100,driveshafts:80,gearboxes:40}); if(!localStorage.getItem(KEYS.prefs)) lsSet(KEYS.prefs,{sound:false,autocalc:true,ui_lang:'en'}); if(!localStorage.getItem(KEYS.quiz)) lsSet(KEYS.quiz,[{q:'What should you protect and not lose when opening a box?',opts:['Labels','Parts','Tools','Invoice'],ans:0},{q:'Which classification means broken/unusable?',opts:['Good','Used','Damaged','Core'],ans:2},{q:'How do you recognize a core part?',opts:['Marked CORE','Color','Weight','Sticker'],ans:0},{q:'Who to ask if unsure?',opts:['Customer','Supervisor','Trainer','Peer'],ans:1},{q:'What to scan from package?',opts:['Tracking number','Label only','Inner part','Packing slip'],ans:0},{q:'If parts are missing?',opts:['Ignore','Mark Missing','Return later','Throw away'],ans:1},{q:'Used parts classified by?',opts:['Condition','Color','Weight','Size'],ans:0},{q:'Not Our Part indicates?',opts:['Different brand','Same brand','Same factory','Unknown'],ans:0}]); }
seed();

// helpers
function pushLog(panel,action,details){ const logs=lsGet(KEYS.logs)||[]; logs.push({ts:nowISO(),panel,action,details,user:localStorage.getItem('rrpd_admin_user')||'user'}); lsSet(KEYS.logs,logs); }

// charts helper (Chart.js)
const CHS={};
function makeChart(id,type,labels,datasets){ try{ const ctx=document.getElementById(id).getContext('2d'); if(CHS[id]) CHS[id].destroy(); const cfg={type, data:{labels, datasets}, options:{responsive:true, plugins:{legend:{position:'bottom'}}}}; CHS[id]=new Chart(ctx,cfg);}catch(e){console.error(e);} }

// renderers
function renderCarriers(){ const raw=lsGet(KEYS.carriers)||[]; let html='<table><tr><th>Date</th><th>FedEx</th><th>UPS</th><th>USPS</th><th>Other</th></tr>'; raw.forEach(r=> html+=`<tr><td>${r.date}</td><td>${r.FedEx}</td><td>${r.UPS}</td><td>${r.USPS}</td><td>${r.Other}</td></tr>`); html+='</table>'; document.getElementById('carrier_table').innerHTML=html; const sums=raw.reduce((a,r)=>{a[0]+=num(r.FedEx);a[1]+=num(r.UPS);a[2]+=num(r.USPS);a[3]+=num(r.Other);return a},[0,0,0,0]); makeChart('carrier_pie','doughnut',['FedEx','UPS','USPS','Other'],[{data:sums, backgroundColor:['#06b6d4','#ef4444','#10b981','#f59e0b']}]); makeChart('carrier_group','bar', raw.map(r=>r.date), [{label:'FedEx',data:raw.map(r=>num(r.FedEx))},{label:'UPS',data:raw.map(r=>num(r.UPS))},{label:'USPS',data:raw.map(r=>num(r.USPS))},{label:'Other',data:raw.map(r=>num(r.Other))}]); }

function renderScanners(){ const sc=lsGet(KEYS.scanners)||[]; const map={}; sc.forEach(s=> map[s.name]=(map[s.name]||0)+num(s.count)); const arr=Object.keys(map).map(n=>({name:n,count:map[n]})).sort((a,b)=>b.count-a.count); document.getElementById('leaderboard').innerHTML = arr.map((r,i)=>`${i+1}. ${r.name} — ${r.count}`).join('<br>'); makeChart('scanner_bar','bar',arr.map(a=>a.name),[{label:'Scans',data:arr.map(a=>a.count)}]); let mgr='<table><tr><th>Name</th><th>Count</th><th>Actions</th></tr>'; arr.forEach(a=> mgr+=`<tr><td>${a.name}</td><td>${a.count}</td><td><button class="btn" onclick="adjustScanner('${a.name}',10)">+10</button> <button class="btn alt" onclick="adjustScanner('${a.name}',-10)">-10</button></td></tr>`); mgr+='</table>'; document.getElementById('scanner_manager').innerHTML=mgr; }

function renderRacks(){ const raw=lsGet(KEYS.racks)||[]; const totals={r_total:sum(raw,'r_total'), r_core:sum(raw,'r_core'), er_total:sum(raw,'er_total'), er_core:sum(raw,'er_core'), ax_good:sum(raw,'ax_good'), ax_used:sum(raw,'ax_used'), ds_good:sum(raw,'ds_good'), ds_used:sum(raw,'ds_used'), gb_good:sum(raw,'gb_good'), gb_used:sum(raw,'gb_used')}; document.getElementById('donut_racks_text').innerText=`Racks Good:${Math.max(0,totals.r_total-totals.r_core)} Core:${totals.r_core}`; makeChart('donut_racks','doughnut',['Good','Core'],[{data:[Math.max(0,totals.r_total-totals.r_core),totals.r_core]}]); makeChart('donut_eracks','doughnut',['Good','Core'],[{data:[Math.max(0,totals.er_total-totals.er_core),totals.er_core]}]); makeChart('donut_axles','doughnut',['Good','Used'],[{data:[totals.ax_good,totals.ax_used]}]); makeChart('donut_ds','doughnut',['Good','Used'],[{data:[totals.ds_good,totals.ds_used]}]); makeChart('donut_gb','doughnut',['Good','Used'],[{data:[totals.gb_good,totals.gb_used]}]); makeChart('mega_donut','doughnut',['Good','Core','Used'],[{data:[Math.max(0,totals.r_total-totals.r_core)+Math.max(0,totals.er_total-totals.er_core)+totals.ax_good+totals.ds_good+totals.gb_good, totals.r_core+totals.er_core, totals.ax_used+totals.ds_used+totals.gb_used]}]); renderLogTable('racks','racks_log'); renderLeaderboard(); }

function renderClass(){ const raw=lsGet(KEYS.class)||[]; const good=sum(raw,'good'), used=sum(raw,'used'), core=sum(raw,'core'), damaged=sum(raw,'damaged'), missing=sum(raw,'missing'), notour=sum(raw,'notour'); document.getElementById('class_text').innerText=`Good:${good} Used:${used} Core:${core}`; makeChart('class_donut','doughnut',['Good','Used','Core','Damaged','Missing','NotOur'],[{data:[good,used,core,damaged,missing,notour]}]); renderLogTable('classifications','log_class'); }

function renderCharts(){ const raw=lsGet(KEYS.racks)||[]; const totals={r_total:sum(raw,'r_total'), r_core:sum(raw,'r_core'), er_total:sum(raw,'er_total'), er_core:sum(raw,'er_core'), ax_good:sum(raw,'ax_good'), ax_used:sum(raw,'ax_used'), ds_good:sum(raw,'ds_good'), ds_used:sum(raw,'ds_used'), gb_good:sum(raw,'gb_good'), gb_used:sum(raw,'gb_used')}; makeChart('stacked_all','bar',['Racks','E.Racks','Axles','DriveShafts','Gearboxes'],[{label:'Good',data:[Math.max(0,totals.r_total-totals.r_core),Math.max(0,totals.er_total-totals.er_core),totals.ax_good,totals.ds_good,totals.gb_good]},{label:'Core/Used',data:[totals.r_core,totals.er_core,totals.ax_used,totals.ds_used,totals.gb_used]}]); }

function renderManual(){ document.getElementById('manual_en').innerHTML = '<h4>Receiving Parts — Step by step</h4><ol><li>Inspect box.</li><li>Open carefully, keep labels.</li><li>Scan tracking number and classify.</li></ol>'; document.getElementById('manual_es').innerHTML = '<h4>Recepción de piezas — Paso a paso</h4><ol><li>Inspeccione la caja.</li><li>Abrir con cuidado, conservar etiquetas.</li><li>Escanear número de seguimiento y clasificar.</li></ol>'; }

function renderLogs(){ const logs=lsGet(KEYS.logs)||[]; let html='<table><tr><th>Time</th><th>Panel</th><th>User</th><th>Action</th><th>Details</th></tr>'; logs.slice().reverse().forEach(l=> html+=`<tr><td>${new Date(l.ts).toLocaleString()}</td><td>${l.panel}</td><td>${l.user}</td><td>${l.action}</td><td>${l.details}</td></tr>`); html+='</table>'; document.getElementById('all_logs_table').innerHTML=html; renderLeaderboard(); }
function renderLogTable(panel,containerId){ const logs=lsGet(KEYS.logs)||[]; const rows=logs.filter(r=> r.panel===panel); let html='<table><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr>'; rows.slice().reverse().forEach(r=> html+=`<tr><td>${new Date(r.ts).toLocaleString()}</td><td>${r.user}</td><td>${r.action}</td><td>${r.details}</td></tr>`); html+='</table>'; document.getElementById(containerId).innerHTML=html; }

function sum(arr,key){return (arr||[]).reduce((s,i)=> s + (Number(i[key])||0),0); }

// input handling
document.getElementById('di_submit').addEventListener('click',()=>{
  const cat=document.getElementById('di_category').value; const date=document.getElementById('di_date').value || new Date().toISOString().slice(0,10); const n1=num(document.getElementById('di_num1').value); const n2=num(document.getElementById('di_num2').value); const txt=document.getElementById('di_txt').value;
  if(cat==='carriers'){ const arr=lsGet(KEYS.carriers)||[]; arr.push({date,FedEx:n1,UPS:n2,USPS:0,Other:0,ts:nowISO(),note:txt}); lsSet(KEYS.carriers,arr); pushLog('carriers','add',JSON.stringify({date,n1,n2,txt})); toast('Carrier saved'); renderCarriers(); return; }
  if(cat==='racks'){ mergeRacks(date,{r_total:n1,r_core:n2}); pushLog('racks','add',JSON.stringify({date,n1,n2})); toast('Racks saved'); renderRacks(); return; }
  if(cat==='eracks'){ mergeRacks(date,{er_total:n1,er_core:n2}); pushLog('racks','add_er',JSON.stringify({date,n1,n2})); toast('E-Racks saved'); renderRacks(); return; }
  if(cat==='axles'){ mergeRacks(date,{ax_good:n1,ax_used:n2}); pushLog('racks','add_ax',JSON.stringify({date,n1,n2})); toast('Axles saved'); renderRacks(); return; }
  if(cat==='driveshafts'){ mergeRacks(date,{ds_good:n1,ds_used:n2}); pushLog('racks','add_ds',JSON.stringify({date,n1,n2})); renderRacks(); toast('DS saved'); return; }
  if(cat==='gearboxes'){ mergeRacks(date,{gb_good:n1,gb_used:n2}); pushLog('racks','add_gb',JSON.stringify({date,n1,n2})); renderRacks(); toast('GB saved'); return; }
  if(cat==='classifications'){ const arr=lsGet(KEYS.class)||[]; arr.push({date,good:n1,used:n2,core:0,damaged:0,missing:0,notour:0,ts:nowISO()}); lsSet(KEYS.class,arr); pushLog('classifications','add',JSON.stringify({date,n1,n2})); toast('Classification saved'); renderClass(); return; }
  if(cat==='scanners'){ const arr=lsGet(KEYS.scanners)||[]; arr.push({date,name:txt||'Scanner',count:n1,ts:nowISO()}); lsSet(KEYS.scanners,arr); pushLog('scanners','add',JSON.stringify({date,txt,n1})); toast('Scanner saved'); renderScanners(); return; }
  toast('Unknown category');
});

function mergeRacks(date,updates){ const arr=lsGet(KEYS.racks)||[]; const idx=arr.findIndex(x=> x.date===date); if(idx>=0){ arr[idx]=Object.assign({},arr[idx],updates,{ts:nowISO()}); } else { let base={r_total:0,r_core:0,er_total:0,er_core:0,ax_good:0,ax_used:0,ds_good:0,ds_used:0,gb_good:0,gb_used:0}; let o=Object.assign(base,updates); o.date=date; o.ts=nowISO(); arr.push(o);} lsSet(KEYS.racks,arr); }

// scanner adjust
function adjustScanner(name,delta){ const sc=lsGet(KEYS.scanners)||[]; sc.push({date:new Date().toISOString().slice(0,10),name,count:delta,ts:nowISO()}); lsSet(KEYS.scanners,sc); pushLog('scanners','adjust',`${name} ${delta}`); renderScanners(); toast('Scanner adjusted'); }

// backup/export
document.getElementById('backup_json').addEventListener('click',()=>{ const payload={racks:lsGet(KEYS.racks),class:lsGet(KEYS.class),scanners:lsGet(KEYS.scanners),carriers:lsGet(KEYS.carriers),logs:lsGet(KEYS.logs),admins:lsGet(KEYS.admins),goals:lsGet(KEYS.goals)}; const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rrpd_backup_'+(new Date().toISOString().slice(0,10))+'.json'; a.click(); toast('Backup downloaded'); });

document.getElementById('export_csv').addEventListener('click',()=>{ const logs=lsGet(KEYS.logs)||[]; if(!logs.length){ alert('No logs'); return;} const cols=['ts','panel','user','action','details']; const csv=[cols.join(',')].concat(logs.map(r=> cols.map(c=> JSON.stringify(r[c]||'')).join(',')).join('\n')); const blob=new Blob([csv.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rrpd_logs_'+(new Date().toISOString().slice(0,10))+'.csv'; a.click(); toast('CSV exported'); });

// admin login/create
document.getElementById('admin_login').addEventListener('click',()=>{ const user=document.getElementById('admin_user').value||DEFAULT_ADMIN.name; const pass=document.getElementById('admin_pass').value||DEFAULT_ADMIN.pass; const admins=lsGet(KEYS.admins)||[]; const ok=admins.find(a=> a.name===user && a.pass===pass); if(!ok){ alert('Unauthorized'); return;} localStorage.setItem('rrpd_admin_user',user); document.getElementById('admin_controls').style.display='block'; document.getElementById('admin_logout').style.display='inline-block'; document.getElementById('admin_hint').innerText=user; pushLog('settings','login',user); toast('Admin logged in'); renderSettings(); });

document.getElementById('admin_logout').addEventListener('click',()=>{ if(!confirm('Logout admin?')) return; localStorage.removeItem('rrpd_admin_user'); document.getElementById('admin_controls').style.display='none'; document.getElementById('admin_logout').style.display='none'; document.getElementById('admin_hint').innerText='—'; pushLog('settings','logout',''); toast('Admin logged out'); });

document.getElementById('create_admin').addEventListener('click',()=>{ const n=document.getElementById('new_admin_name').value.trim(); const p=document.getElementById('new_admin_pass').value.trim(); if(!n||!p){ alert('Name and pass required'); return;} const arr=lsGet(KEYS.admins)||[]; arr.push({name:n,pass:p}); lsSet(KEYS.admins,arr); pushLog('settings','create_admin',n); toast('Admin created'); renderSettings(); });

// clear/soft-delete/archive
document.getElementById('clear_logs_btn').addEventListener('click',()=>{ if(!localStorage.getItem('rrpd_admin_user')){ alert('Admin required'); return;} const logs=lsGet(KEYS.logs)||[]; const arch=lsGet(KEYS.archive)||[]; arch.push({ts:nowISO(),type:'logs',data:logs}); lsSet(KEYS.archive,arch); lsSet(KEYS.logs,[]); toast('Logs archived'); renderLogs(); });

document.getElementById('clear_all_btn').addEventListener('click',()=>{ if(!confirm('Clear ALL data? (will archive)')) return; const archive=lsGet(KEYS.archive)||[]; archive.push({ts:nowISO(),type:'all',data:{racks:lsGet(KEYS.racks),class:lsGet(KEYS.class),scanners:lsGet(KEYS.scanners),carriers:lsGet(KEYS.carriers)}}); lsSet(KEYS.archive,archive); lsSet(KEYS.racks,[]); lsSet(KEYS.class,[]); lsSet(KEYS.scanners,[]); lsSet(KEYS.carriers,[]); lsSet(KEYS.logs,[]); toast('All data archived'); renderRacks(); renderClass(); renderScanners(); renderCarriers(); renderLogs(); });

document.getElementById('view_archive').addEventListener('click',()=>{ const arch=lsGet(KEYS.archive)||[]; const w=window.open('','archive','width=800,height=600'); w.document.write('<pre>'+JSON.stringify(arch,null,2)+'</pre>'); });

document.getElementById('restore_all').addEventListener('click',()=>{ if(!confirm('Restore all archived data?')) return; const arch=lsGet(KEYS.archive)||[]; if(!arch.length){ alert('No archive'); return;} const last=arch.pop(); if(last.type==='all'){ lsSet(KEYS.racks,last.data.racks); lsSet(KEYS.class,last.data.class); lsSet(KEYS.scanners,last.data.scanners); lsSet(KEYS.carriers,last.data.carriers); lsSet(KEYS.logs,[]); lsSet(KEYS.archive,arch); toast('Restored last archive'); renderRacks(); renderClass(); renderScanners(); renderCarriers(); renderLogs(); } else alert('No full archive found'); });

// quiz start (popup)
document.getElementById('start_quiz').addEventListener('click',()=>{ const code=prompt('Enter training code:'); const tc=localStorage.getItem(KEYS.training)||DEFAULT_TRAIN; if(code!==tc){ alert('Incorrect code'); return;} const qs=lsGet(KEYS.quiz)||[]; const popup=window.open('','quiz','width=700,height=700'); if(!popup){ alert('Popup blocked'); return;} let html='<html><head><title>Quiz</title></head><body><h3>Training Quiz</h3><form id="qform">'; qs.forEach((q,i)=>{ html+=`<div><strong>${i+1}. ${q.q}</strong>`; q.opts.forEach((o,j)=> html+=`<div><label><input type="radio" name="q${i}" value="${j}"> ${o}</label></div>`); html+='</div><hr>'; }); html+='<button type="button" id="submit">Submit</button><div id="result"></div></form><script>document.getElementById("submit").addEventListener("click",()=>{const quiz='+JSON.stringify(lsGet(KEYS.quiz))+';let score=0;quiz.forEach((q,i)=>{const sel=document.querySelector("input[name=\\"q"+i+"\\"]:checked"); if(sel && Number(sel.value)===q.ans) score++;}); document.getElementById("result").innerText="Score: "+score+" / "+quiz.length; window.opener.postMessage({type:"quiz_result",score:score,total:quiz.length},"*");});</script></body></html>'; popup.document.write(html); popup.document.close(); });

window.addEventListener('message',(e)=>{ if(e.data && e.data.type==='quiz_result'){ const logs=lsGet(KEYS.logs)||[]; logs.push({ts:nowISO(),panel:'quiz',action:'result',details:JSON.stringify(e.data),user:localStorage.getItem('rrpd_admin_user')||'user'}); lsSet(KEYS.logs,logs); toast('Quiz result saved'); renderLogs(); } });
/* ----------------------------
   Miss Inspections
   ---------------------------- */
const MISS_KEY = 'rrpd_miss';

function renderMiss() {
  const arr = lsGet(MISS_KEY) || [];
  const container = document.getElementById('miss_table');
  if (!container) return;
  let html = '<table><thead><tr><th>Date</th><th>Issue</th></tr></thead><tbody>';
  arr.slice().reverse().forEach(r=>{
    html += `<tr><td>${r.date}</td><td>${r.issue}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

document.getElementById('miss_submit').addEventListener('click', ()=>{
  const date = document.getElementById('miss_date').value || new Date().toISOString().slice(0,10);
  const issue = document.getElementById('miss_issue').value.trim();
  if(!issue){ alert('Please enter a problem'); return; }
  const arr = lsGet(MISS_KEY) || [];
  arr.push({date, issue, ts: nowISO()});
  lsSet(MISS_KEY, arr);
  addLog('miss','save_miss', issue);
  toast('Miss Inspection saved');
  renderMiss();
  document.getElementById('miss_issue').value='';
});

// small bindings
document.getElementById('log_refresh').addEventListener('click',()=>renderLogs());
document.getElementById('log_search').addEventListener('input',()=>renderLogs());

// initial renders
openPanel('home'); renderCarriers(); renderScanners(); renderRacks(); renderClass(); renderCharts(); renderManual(); renderLogs(); renderScanners();renderMiss();

// clock
setInterval(()=>document.getElementById('clock').innerText = new Date().toLocaleTimeString(),1000);
