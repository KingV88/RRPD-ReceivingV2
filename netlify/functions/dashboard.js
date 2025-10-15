// netlify/functions/dashboard.js
// RRPD unified data fetcher — works without login, but supports optional cookie auth

const fetch = require("node-fetch");

// Public Detroit Axle pages:
const COND_URL = "https://returns.detroitaxle.com/returns/reports/condition";
const ELP_URL  = "https://returns.detroitaxle.com/elp-dashboard";

// OPTIONAL: paste your cookie string here once you get admin login.
// Example: const SESSION_COOKIE = "connect.sid=YOUR_LONG_COOKIE_VALUE";
const SESSION_COOKIE = "";   // ← leave blank for now

// -------------- Helpers -----------------
const safe = (v,d="") => v??d;
const sum = (a)=>a.reduce((t,n)=>t+n,0);
const clean = (s="") => s.replace(/<[^>]+>/g,"").trim();
const parseRows = (html)=> html.split(/<\/tr>/i).filter(r=>/<td/i.test(r));

// detect x2, 2x, x3 etc. for qty
const qtyFromPart = (txt="")=>{
  const s = txt.toLowerCase();
  const m = s.match(/x(\d+)\b/) || s.match(/\b(\d+)x/);
  return m ? parseInt(m[1],10) : 1;
};

// -------------- Parsing -----------------
function parseCondition(html){
  const rows = parseRows(html);
  const items = [];
  for(const r of rows){
    const cols = [...r.matchAll(/<td[^>]*>(.*?)<\/td>/gi)].map(x=>clean(x[1]));
    if(cols.length<7) continue;
    items.push({
      created_at: cols[2],
      created_by: cols[3],
      status: cols[1],
      part_number: cols[6],
      classification: cols[7],
      qty: qtyFromPart(cols[6])
    });
  }

  const buckets = {Good:0,Used:0,Core:0,Damaged:0,Missing:0,"Not Our Part":0,Other:0};
  for(const it of items){
    const c = it.classification.toLowerCase();
    let key="Other";
    if(c.includes("good")) key="Good";
    else if(c.includes("used")) key="Used";
    else if(c.includes("core")) key="Core";
    else if(c.includes("damaged")) key="Damaged";
    else if(c.includes("missing")) key="Missing";
    else if(c.includes("not our part")) key="Not Our Part";
    buckets[key]+=it.qty;
  }

  const missed = items.filter(it=>{
    const c=it.classification.toLowerCase();
    return !["good","used","core"].some(k=>c.includes(k)) || it.status.toLowerCase()!=="new";
  });

  return {items,buckets,missed};
}

function parseElp(html){
  const rows=parseRows(html);
  const totals={};
  for(const r of rows){
    const cols=[...r.matchAll(/<td[^>]*>(.*?)<\/td>/gi)].map(x=>clean(x[1]));
    if(cols.length<2) continue;
    const name=cols[0];
    const val=parseInt(cols[1].replace(/,/g,""),10);
    if(!name||isNaN(val)) continue;
    totals[name]=(totals[name]||0)+val;
  }
  return totals;
}

// -------------- Main handler -------------
exports.handler = async (event)=>{
  const params=event.queryStringParameters||{};
  const from=params.from||"";
  const to=params.to||"";

  const out={ok:true,updated:new Date().toISOString(),source:"dashboard.js"};
  const headers={"User-Agent":"RRPD/1.0"};
  if(SESSION_COOKIE) headers.Cookie=SESSION_COOKIE;

  try{
    const condRes=await fetch(COND_URL,{headers});
    const condHtml=await condRes.text();
    const elpRes=await fetch(ELP_URL,{headers});
    const elpHtml=await elpRes.text();

    const {items,buckets,missed}=parseCondition(condHtml);
    const scanners=parseElp(elpHtml);

    // monthly trend
    const trend={};
    for(const it of items){
      const k=(it.created_at||"").slice(0,7);
      if(!trend[k]) trend[k]={Good:0,Other:0};
      const good=it.classification.toLowerCase().includes("good");
      trend[k][good?"Good":"Other"]+=it.qty;
    }

    out.classifications=buckets;
    out.items=items.slice(0,4000);
    out.missed=missed.slice(0,1000);
    out.trend=trend;
    out.scannerTotals=scanners;
  }catch(e){
    out.ok=false;
    out.error=e.message;
  }

  return{
    statusCode:200,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    },
    body:JSON.stringify(out)
  };
};
