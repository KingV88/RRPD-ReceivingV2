let csvRows = [];
let summary = {};

document.getElementById("csvInput").addEventListener("change", e => {
  Papa.parse(e.target.files[0], {
    header: true,
    skipEmptyLines: true,
    complete: res => {
      csvRows = res.data;
      processData();
    }
  });
});

function processData() {
  summary = {
    carriers: { FedEx:0, UPS:0, USPS:0, Other:0 },
    totalScans: 0,
    uniqueTracking: new Set(),
    totalParts: 0,
    multiPartBoxes: 0
  };

  const boxParts = {};

  csvRows.forEach(r => {
    const tracking = String(r.tracking || "").trim();
    const cls = String(r.classification || "").toLowerCase();
    const pn = String(r.part_number || "");

    if (cls === "return label" || cls === "packing slip") {
      summary.totalScans++;
      summary.uniqueTracking.add(tracking);
      classifyCarrier(tracking);
    } else {
      let qty = parseMultiplier(pn);
      summary.totalParts += qty;
      boxParts[tracking] = (boxParts[tracking] || 0) + qty;
    }
  });

  Object.values(boxParts).forEach(v => {
    if (v > 1) summary.multiPartBoxes++;
  });

  renderDashboard();
}

function parseMultiplier(pn) {
  const m = pn.match(/x(\d+)|(\d+)x/i);
  if (!m) return 1;
  const n = parseInt(m[1] || m[2], 10);
  return Math.min(n, 50);
}

function classifyCarrier(t) {
  if (t.startsWith("96") || t.startsWith("797")) summary.carriers.FedEx++;
  else if (t.startsWith("1Z")) summary.carriers.UPS++;
  else if (t.length === 22) summary.carriers.USPS++;
  else summary.carriers.Other++;
}

function renderDashboard() {
  document.getElementById("content").innerHTML = `
    <div class="grid">
      <div>FedEx<br>${summary.carriers.FedEx}</div>
      <div>UPS<br>${summary.carriers.UPS}</div>
      <div>USPS<br>${summary.carriers.USPS}</div>
      <div>Other<br>${summary.carriers.Other}</div>
      <div>Total Scans<br>${summary.totalScans}</div>
      <div>Unique Tracking<br>${summary.uniqueTracking.size}</div>
      <div>Total Parts<br>${summary.totalParts}</div>
      <div>Multi-Part Boxes<br>${summary.multiPartBoxes}</div>
    </div>
  `;
}

function showTab(){}

function openExport() {
  document.getElementById("exportModal").classList.remove("hidden");
  document.getElementById("exportPreview").innerText = JSON.stringify(summary, null, 2);
}

function closeExport() {
  document.getElementById("exportModal").classList.add("hidden");
}

document.getElementById("confirmExport").addEventListener("change", e => {
  document.getElementById("pdfBtn").disabled = !e.target.checked;
  document.getElementById("xlsBtn").disabled = !e.target.checked;
});
