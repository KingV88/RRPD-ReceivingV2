(() => {
"use strict";

/* =========================
   STATE
========================= */
const state = {
  rows: [],
  labelScans: [],
  partRows: [],
  manual: []
};

/* =========================
   HELPERS
========================= */
const $ = id => document.getElementById(id);

function clean(v){
  return String(v || "").trim();
}

function lower(v){
  return clean(v).toLowerCase();
}

function isLabel(desc){
  const d = lower(desc);
  return d.includes("return label") || d.includes("packing slip");
}

function getField(row, names){
  for (let n of names){
    if (row[n]) return row[n];
  }
  return "";
}

function parseQty(part){
  let s = clean(part);
  let qty = 1;

  const x1 = s.match(/x(\d+)/i);
  const x2 = s.match(/(\d+)x/i);

  if (x1) qty = parseInt(x1[1]);
  if (x2) qty = parseInt(x2[1]);

  s = s.replace(/x\d+/i,"").replace(/\d+x/i,"").trim();

  return { part:s, qty: qty || 1 };
}

/* =========================
   CONDITION LOGIC
========================= */
function normalizeCondition(desc){
  const d = lower(desc);

  if (d.includes("good")) return "Good";
  if (d.includes("used")) return "Used";
  if (d.includes("core")) return "Core";
  if (d.includes("missing")) return "Missing";
  if (d.includes("damage")) return "Damaged";
  if (d.includes("not")) return "Not Our";

  return "Other";
}

/* =========================
   PROCESS CSV
========================= */
function process(rows){

  state.labelScans = [];
  state.partRows = [];

  rows.forEach(row => {

    const desc = getField(row, ["PN Description","Description"]);
    const track = getField(row, ["Tracking","Track Num"]);
    const partRaw = getField(row, ["Part Number","Part Num"]);

    if (isLabel(desc)){
      state.labelScans.push(track);
      return;
    }

    const parsed = parseQty(partRaw);
    const condition = normalizeCondition(desc);

    state.partRows.push({
      part: parsed.part,
      qty: parsed.qty,
      condition
    });

  });

  render();
}

/* =========================
   CALCULATIONS
========================= */
function getTotals(){

  const parts = state.partRows.reduce((a,b)=>a+b.qty,0);

  const cond = {
    Good:0,
    Used:0,
    Core:0,
    Missing:0,
    Damaged:0,
    "Not Our":0
  };

  state.partRows.forEach(p=>{
    if(cond[p.condition] !== undefined){
      cond[p.condition]+=p.qty;
    }
  });

  return {
    packages: state.labelScans.length,
    parts,
    cond
  };
}

/* =========================
   RENDER
========================= */
function render(){

  const t = getTotals();

  $("mPackages").textContent = t.packages;
  $("mParts").textContent = t.parts;

  $("cGood").textContent = t.cond.Good;
  $("cUsed").textContent = t.cond.Used;
  $("cCore").textContent = t.cond.Core;
  $("cMissing").textContent = t.cond.Missing;
  $("cDamaged").textContent = t.cond.Damaged;
  $("cNotOur").textContent = t.cond["Not Our"];

  renderReturns();
}

/* =========================
   RETURNS TABLE
========================= */
function renderReturns(){

  const map = {};

  state.partRows.forEach(p=>{
    if(!map[p.condition]) map[p.condition]={rows:0,pieces:0};
    map[p.condition].rows++;
    map[p.condition].pieces+=p.qty;
  });

  const body = $("tblReturns").querySelector("tbody");
  body.innerHTML="";

  Object.entries(map).forEach(([k,v])=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${v.rows}</td><td>${v.pieces}</td>`;
    body.appendChild(tr);
  });
}

/* =========================
   EMAIL COPY
========================= */
function copyEmail(){

  const t = getTotals();

  const text = `
RRPD SUMMARY

Packages: ${t.packages}
Parts: ${t.parts}

Good: ${t.cond.Good}
Used: ${t.cond.Used}
Core: ${t.cond.Core}
Missing: ${t.cond.Missing}
Damaged: ${t.cond.Damaged}
Not Our: ${t.cond["Not Our"]}
`;

  navigator.clipboard.writeText(text);
  alert("Copied!");
}

/* =========================
   FILE UPLOAD
========================= */
$("whFile").addEventListener("change", e=>{
  const file = e.target.files[0];
  Papa.parse(file,{
    header:true,
    complete: res => process(res.data)
  });
});

/* =========================
   BUTTONS
========================= */
$("btnCopyEmail").onclick = copyEmail;

/* =========================
   TABS
========================= */
document.querySelectorAll(".tab").forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
    document.getElementById("panel-"+btn.dataset.tab).classList.add("active");
  };
});

})();
