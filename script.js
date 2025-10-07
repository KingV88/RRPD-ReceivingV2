// ===== Global State =====
let state = {
  returns: [],
  racks: JSON.parse(localStorage.getItem("racks") || "{}"),
  carriers: JSON.parse(localStorage.getItem("carriers") || "{}"),
  inspections: JSON.parse(localStorage.getItem("inspections") || "[]"),
};

// ===== Helpers =====
function getSelectedDate() {
  const input = document.getElementById("globalDate");
  return input?.value || new Date().toISOString().split("T")[0];
}
function formatDateForHeader(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}
function updateTimestamp(elId) {
  const el = document.getElementById(elId);
  if (el) {
    const now = new Date();
    el.textContent = "Last updated: " + now.toLocaleTimeString();
  }
}

// ===== Navigation =====
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("visible"));
    document.getElementById(btn.dataset.target).classList.add("visible");
  });
});

// ===== Fetch Returns =====
async function fetchReturns() {
  const date = getSelectedDate();
  try {
    const res = await fetch(`/.netlify/functions/returns?date=${date}`);
    const json = await res.json();
    // fallback: filter by created_at if server ignored ?date
    const filtered = json.filter(r => r.created_at?.startsWith(date));
    state.returns = filtered;
  } catch (err) {
    console.error("Returns fetch failed", err);
    state.returns = [];
  }
}

// ===== Render Functions =====
function renderScanners() {
  const dailyEl = document.getElementById("scannersDailyChart");
  const allTimeEl = document.getElementById("scannersAllTimeChart");
  if (!dailyEl || !allTimeEl) return;

  const data = state.returns;
  if (!data.length) {
    document.getElementById("scannersEmpty").textContent = "No scans found.";
    return;
  } else {
    document.getElementById("scannersEmpty").textContent = "";
  }

  // counts by scanner
  const counts = {};
  data.forEach(r => counts[r.scanner] = (counts[r.scanner] || 0) + 1);

  new Chart(dailyEl, {
    type: "bar",
    data: { labels: Object.keys(counts), datasets: [{
      label: "Scans", data: Object.values(counts),
      backgroundColor: "#3a7ce0"
    }]},
    options: { responsive: true, plugins:{legend:{display:false}} }
  });

  updateTimestamp("scannersUpdated");
}

function renderClassifications() {
  const donutEl = document.getElementById("classificationsDonut");
  if (!donutEl) return;
  const data = state.returns;
  if (!data.length) {
    document.getElementById("classificationsEmpty").textContent = "No classifications.";
    return;
  } else {
    document.getElementById("classificationsEmpty").textContent = "";
  }
  const counts = {};
  data.forEach(r => counts[r.classification] = (counts[r.classification]||0)+1);

  new Chart(donutEl, {
    type: "doughnut",
    data: { labels: Object.keys(counts), datasets: [{
      data: Object.values(counts),
      backgroundColor: ["#3a7ce0","#2ecc71","#f1c40f","#e67e22","#e74c3c","#9b59b6"]
    }]},
    options: { responsive:true, plugins:{legend:{position:"bottom"}} }
  });
  updateTimestamp("classificationsUpdated");
}

// ===== Racks =====
document.getElementById("racksForm").addEventListener("submit", e=>{
  e.preventDefault();
  const date = getSelectedDate();
  state.racks[date] = {
    racks: +document.getElementById("racks").value||0,
    coreRacks: +document.getElementById("coreRacks").value||0,
    electricRacks: +document.getElementById("electricRacks").value||0,
    coreElectricRacks: +document.getElementById("coreElectricRacks").value||0,
    axlesGood: +document.getElementById("axlesGood").value||0,
    axlesUsed: +document.getElementById("axlesUsed").value||0,
    driveshaftsGood: +document.getElementById("driveshaftsGood").value||0,
    driveshaftsUsed: +document.getElementById("driveshaftsUsed").value||0,
    gearboxesGood: +document.getElementById("gearboxesGood").value||0,
    gearboxesUsed: +document.getElementById("gearboxesUsed").value||0,
  };
  localStorage.setItem("racks", JSON.stringify(state.racks));
  renderRacks();
});
document.getElementById("resetRacksBtn").addEventListener("click", ()=>{
  if (confirm("Reset racks logs for all dates?")) {
    state.racks = {};
    localStorage.setItem("racks", "{}");
    renderRacks();
    document.getElementById("lastResetDate").textContent =
      "Last reset: " + new Date().toLocaleDateString();
  }
});
function renderRacks() {
  const date = getSelectedDate();
  const data = state.racks[date];
  if (!data) {
    document.getElementById("racksEmpty").textContent="No racks logged.";
    return;
  } else { document.getElementById("racksEmpty").textContent=""; }
  // Example: just render 1 donut for Racks vs Core
  new Chart(document.getElementById("racksDonut"), {
    type:"doughnut",
    data:{labels:["Racks","Core"],datasets:[{data:[data.racks,data.coreRacks],backgroundColor:["#3a7ce0","#e74c3c"]}]}
  });
  updateTimestamp("racksUpdated");
}

// ===== Carriers =====
document.getElementById("carriersForm").addEventListener("submit", e=>{
  e.preventDefault();
  const date = getSelectedDate();
  state.carriers[date] = {
    fedex:+document.getElementById("fedex").value||0,
    ups:+document.getElementById("ups").value||0,
    usps:+document.getElementById("usps").value||0,
    other:+document.getElementById("otherCarrier").value||0,
  };
  localStorage.setItem("carriers", JSON.stringify(state.carriers));
  renderCarriers();
});
function renderCarriers() {
  const date = getSelectedDate();
  const data = state.carriers[date];
  if (!data) {
    document.getElementById("carriersEmpty").textContent="No carriers logged.";
    return;
  } else { document.getElementById("carriersEmpty").textContent=""; }
  new Chart(document.getElementById("carriersTodayDonut"), {
    type:"doughnut",
    data:{labels:["FedEx","UPS","USPS","Other"],datasets:[{data:Object.values(data),backgroundColor:["#3a7ce0","#f1c40f","#2ecc71","#e74c3c"]}]}
  });
  updateTimestamp("carriersUpdated");
}

// ===== Miss Inspections =====
document.getElementById("missInspectionForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const tracking = document.getElementById("trackingNumber").value.trim();
  const reason = document.getElementById("reason").value.trim();
  const date = getSelectedDate();

  let returnId=null, scanner="N/A";
  const rec = state.returns.find(r=>r.tracking_number===tracking);
  if (rec) { returnId=rec.id; scanner=rec.scanner; }

  const entry={tracking,returnId,scanner,reason,date,time:new Date().toLocaleTimeString()};
  state.inspections.push(entry);
  localStorage.setItem("inspections",JSON.stringify(state.inspections));
  renderMissInspections();
});
function renderMissInspections() {
  const tbody=document.querySelector("#missInspectionsTable tbody");
  tbody.innerHTML="";
  const date=getSelectedDate();
  const list=state.inspections.filter(i=>i.date===date);
  if(!list.length){tbody.innerHTML=`<tr><td colspan="6">No inspections logged.</td></tr>`;return;}
  list.forEach(i=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${i.tracking}</td><td>${i.returnId||"-"}</td><td>${i.scanner}</td><td>${i.reason}</td><td>${i.time}</td>
    <td><button onclick="viewPhotos('${i.tracking}','${i.returnId||""}')">View</button></td>`;
    tbody.appendChild(tr);
  });
}
async function viewPhotos(tracking,returnId){
  const modal=document.getElementById("photoModal");
  const grid=document.getElementById("photoContainer");
  grid.innerHTML="Loading...";
  modal.style.display="flex";
  try{
    const res=await fetch(`/.netlify/functions/photos?id=${tracking}`);
    const json=await res.json();
    grid.innerHTML="";
    if(!json.length && returnId){
      const res2=await fetch(`/.netlify/functions/photos?id=${returnId}`);
      const json2=await res2.json();
      json2.forEach(url=>{
        const img=document.createElement("img");img.src=url;grid.appendChild(img);
      });
    } else {
      json.forEach(url=>{
        const img=document.createElement("img");img.src=url;grid.appendChild(img);
      });
    }
  }catch(err){grid.innerHTML="No photos found.";}
}
document.getElementById("closeModal").onclick=()=>{document.getElementById("photoModal").style.display="none";};

// ===== Reports =====
function printReport(){
  const date=getSelectedDate();
  document.getElementById("reportHeader").textContent=`Daily Report — ${formatDateForHeader(date)}`;
  window.print();
}

// ===== Init =====
async function refreshAll(){
  await fetchReturns();
  renderScanners();
  renderClassifications();
  renderRacks();
  renderCarriers();
  renderMissInspections();
}
document.getElementById("globalDate").addEventListener("change",refreshAll);
refreshAll();
setInterval(refreshAll,15000);
