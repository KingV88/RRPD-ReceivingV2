/* RRPD Receiving Dashboard - FINAL (patched)
   Tracking rows: ONLY classification Return Label / Packing Slip
   Parts: any other classification
   Quantity multiplier: xN / Nx / x N / N x (cap 50)

   PATCHES:
   - No manual double counting: renderAll() recomputes from scratch every time
   - Logs snapshot recomputes safely (no mutation)
   - Tracking fallback only runs on tracking rows (prevents part numbers turning into tracking IDs)
   - Manual delete uses event delegation without {once:true}
*/

(() => {
  "use strict";

  // ----------------------------
  // Utilities
  // ----------------------------
  const $ = (id) => document.getElementById(id);

  function setText(id, val) {
    const el = $(id);
    if (el) el.textContent = String(val);
  }

  function safeLower(v) {
    return (v ?? "").toString().trim().toLowerCase();
  }

  function asString(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  function looksLikeScientific(str) {
    return /^[0-9]+(\.[0-9]+)?e\+?[0-9]+$/i.test(str.trim());
  }

  // Convert "1.96367E+11" into a plain integer string (best effort)
  function sciToPlainString(s) {
    const t = asString(s);
    if (!t) return "";
    if (!looksLikeScientific(t)) return t;

    // WARNING: JS Number can lose precision if value is too large.
    // These Excel sci values in your screenshots were ~1e11, so safe enough here.
    const n = Number(t);
    if (!Number.isFinite(n)) return t;
    return Math.round(n).toString();
  }

  // Robust multiplier parsing: "x10", "10x", "x 10", "10 x", "*10"
  // returns { basePart, qty }
  function parsePartAndQty(partRaw) {
    let part = asString(partRaw);
    if (!part) return { basePart: "", qty: 1 };

    let qty = 1;
    const cap = 50;

    // normalize spaces
    let s = part.replace(/\s+/g, " ").trim();

    // capture any multiplier near end
    const m1 = s.match(/(?:^|[\s\-])x\s*(\d{1,3})\s*$/i);
    const m2 = s.match(/(?:^|[\s\-])(\d{1,3})\s*x\s*$/i);
    const m3 = s.match(/(?:^|[\s\-])\*\s*(\d{1,3})\s*$/i);

    let found = null;
    if (m1) found = m1[1];
    else if (m2) found = m2[1];
    else if (m3) found = m3[1];

    if (found) {
      const n = parseInt(found, 10);
      if (Number.isFinite(n) && n > 0) qty = Math.min(n, cap);

      // remove trailing multiplier token
      s = s
        .replace(/(?:^|[\s\-])x\s*\d{1,3}\s*$/i, "")
        .replace(/(?:^|[\s\-])\d{1,3}\s*x\s*$/i, "")
        .replace(/(?:^|[\s\-])\*\s*\d{1,3}\s*$/i, "")
        .trim();
    }

    // handle "PARTx2" stuck with no space
    const stuck = s.match(/^(.*?)(?:x|\*)(\d{1,3})$/i);
    if (stuck) {
      const n = parseInt(stuck[2], 10);
      if (Number.isFinite(n) && n > 0) qty = Math.min(n, cap);
      s = stuck[1].trim();
    }

    return { basePart: s, qty };
  }

  function guessCarrier(trackingRaw) {
    const tracking = asString(trackingRaw);
    if (!tracking) return "Other";

    // UPS: 1Z...
    if (/^1Z/i.test(tracking)) return "UPS";

    // USPS common: 92/93/94/95 + 20-22 digits, or 22 digits starting with 9
    if (/^(92|93|94|95)\d{20,22}$/.test(tracking)) return "USPS";
    if (/^9\d{21,22}$/.test(tracking)) return "USPS";

    // FedEx heuristics:
    if (/^\d{12,15}$/.test(tracking)) return "FedEx";
    if (/^\d{20,22}$/.test(tracking)) return "FedEx";

    return "Other";
  }

  function isTrackingClassification(classification) {
    const c = safeLower(classification);
    return c === "return label" || c === "packing slip";
  }

  function pickField(row, keys) {
    for (const k of keys) {
      if (row && Object.prototype.hasOwnProperty.call(row, k)) {
        const v = asString(row[k]);
        if (v) return v;
      }
    }
    // case-insensitive match
    const rowKeys = Object.keys(row || {});
    const lowered = rowKeys.map((x) => [x, x.toLowerCase()]);
    for (const want of keys) {
      const w = want.toLowerCase();
      const found = lowered.find((p) => p[1] === w);
      if (found) {
        const v = asString(row[found[0]]);
        if (v) return v;
      }
    }
    return "";
  }

  // ----------------------------
  // State
  // ----------------------------
  const state = {
    rows: [],
    byTracking: new Map(), // tracking -> aggregate object
    looseParts: [],        // part rows without valid tracking
    manual: [],            // manual entries
    logs: [],
    chart: null
  };

  // ----------------------------
  // Parsing + Aggregation
  // ----------------------------
  function resetComputed() {
    state.byTracking.clear();
    state.looseParts = [];
  }

  function upsertAgg(tracking) {
    if (!state.byTracking.has(tracking)) {
      state.byTracking.set(tracking, {
        tracking,
        carrier: guessCarrier(tracking),
        trackingRows: 0,
        partsPieces: 0,
        partRows: 0,
        parts: [],        // {part, qty, status}
        classifications: new Map()
      });
    }
    return state.byTracking.get(tracking);
  }

  function computeFromRows(rows) {
    resetComputed();

    const classificationKeys = [
      "Classification", "classification", "Type", "type", "Category", "category"
    ];

    const trackingKeys = [
      "Tracking", "tracking", "Tracking Number", "tracking number",
      "TrackingNumber", "trackingNumber",
      "Return Tracking", "return tracking"
    ];

    const partKeys = [
      "Deposo PN", "DeposoPN", "Part", "Part Number", "PartNumber", "part", "part number"
    ];

    const statusKeys = ["Status", "status", "Condition", "condition"];
    const qtyKeys = ["Qty", "qty", "Quantity", "quantity", "Pieces", "pieces"];

    for (const row of rows) {
      const classification = pickField(row, classificationKeys);
      const isTrackingRow = isTrackingClassification(classification);

      let tracking = pickField(row, trackingKeys);

      // IMPORTANT PATCH:
      // Only guess tracking from random cells IF it's a tracking row.
      if (!tracking && isTrackingRow) {
        const values = Object.values(row || {}).map(asString).filter(Boolean);
        const candidate = values.find(v =>
          /^1Z/i.test(v) || /^\d{12,22}$/.test(v) || looksLikeScientific(v)
        );
        tracking = candidate ? candidate : "";
      }

      tracking = sciToPlainString(tracking);

      const status = pickField(row, statusKeys);

      // PART row logic
      if (!isTrackingRow) {
        let partRaw = pickField(row, partKeys);

        // fallback: pick first non-tracking-like value
        if (!partRaw) {
          const values = Object.values(row || {}).map(asString).filter(Boolean);
          partRaw = values.find(v =>
            !/^1Z/i.test(v) &&
            !/^\d{12,22}$/.test(v) &&
            !looksLikeScientific(v)
          ) || "";
        }

        const qtyFromColumnRaw = pickField(row, qtyKeys);
        let qtyFromColumn = 0;
        if (qtyFromColumnRaw) {
          const n = parseInt(qtyFromColumnRaw.replace(/[^\d]/g, ""), 10);
          if (Number.isFinite(n) && n > 0) qtyFromColumn = Math.min(n, 50);
        }

        const parsed = parsePartAndQty(partRaw);
        const qty = qtyFromColumn > 0 ? qtyFromColumn : parsed.qty;
        const basePart = parsed.basePart || partRaw;

        const partObj = { part: basePart || "(blank)", qty, status: status || "" };

        if (tracking) {
          const agg = upsertAgg(tracking);
          agg.partRows += 1;
          agg.partsPieces += qty;
          agg.parts.push(partObj);
        } else {
          state.looseParts.push({ ...partObj, rawTracking: tracking || "" });
        }

      } else {
        // TRACKING row logic
        if (!tracking) continue;
        const agg = upsertAgg(tracking);
        agg.trackingRows += 1;

        const c = safeLower(classification) || "(blank)";
        agg.classifications.set(c, (agg.classifications.get(c) || 0) + 1);
      }
    }
  }

  function applyManual() {
    for (const m of state.manual) {
      const tracking = asString(m.tracking);
      if (!tracking) continue;
      const agg = upsertAgg(tracking);
      agg.carrier = m.carrier || agg.carrier;
      agg.partsPieces += m.pieces;
    }
  }

  // ----------------------------
  // Rendering
  // ----------------------------
  function updateChart(counts) {
    const canvas = $("carrierChart");
    if (!canvas) return;

    const labels = ["FedEx", "UPS", "USPS", "Other"];
    const data = [counts.FedEx, counts.UPS, counts.USPS, counts.Other];

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = data;
      state.chart.update();
      return;
    }

    state.chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Tracking Rows",
          data
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  function renderManualTable() {
    const body = $("tblManual")?.querySelector("tbody");
    if (!body) return;

    body.innerHTML = "";
    state.manual.forEach((m, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.tracking}</td>
        <td>${m.carrier}</td>
        <td>${m.pieces}</td>
        <td><button class="btn danger" data-del="${idx}">Delete</button></td>
      `;
      body.appendChild(tr);
    });
  }

  function renderLogsTable() {
    const body = $("tblLogs")?.querySelector("tbody");
    if (!body) return;

    body.innerHTML = "";
    state.logs.forEach((l, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${l.when}</td>
        <td>${l.note || ""}</td>
        <td>${l.totalParts}</td>
        <td>${l.uniqueTracking}</td>
        <td><button class="btn danger" data-del="${idx}">Delete</button></td>
      `;
      body.appendChild(tr);
    });
  }

  function renderAll() {
    // ✅ CRITICAL PATCH: always recompute cleanly
    computeFromRows(state.rows);
    applyManual();

    let counts = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
    let totalScans = 0;
    let uniqueTracking = 0;
    let totalParts = 0;
    let multiPartBoxes = 0;

    const list = Array.from(state.byTracking.values());

    for (const agg of list) {
      uniqueTracking += 1;
      totalScans += agg.trackingRows;
      totalParts += agg.partsPieces;
      if (agg.partsPieces > 1) multiPartBoxes += 1;

      counts[agg.carrier] = (counts[agg.carrier] || 0) + agg.trackingRows;
    }

    setText("mFedEx", counts.FedEx || 0);
    setText("mUPS", counts.UPS || 0);
    setText("mUSPS", counts.USPS || 0);
    setText("mOther", counts.Other || 0);
    setText("mTotalScans", totalScans);
    setText("mUniqueTracking", uniqueTracking);
    setText("mTotalParts", totalParts);
    setText("mMultiPartBoxes", multiPartBoxes);

    updateChart({
      FedEx: counts.FedEx || 0,
      UPS: counts.UPS || 0,
      USPS: counts.USPS || 0,
      Other: counts.Other || 0
    });

    // samples latest 25
    const samplesBody = $("tblSamples")?.querySelector("tbody");
    if (samplesBody) {
      samplesBody.innerHTML = "";
      const latest = list.slice(-25).reverse();
      latest.forEach((agg, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${i + 1}</td><td>${agg.tracking}</td><td>${agg.carrier}</td><td>${agg.partsPieces}</td>`;
        samplesBody.appendChild(tr);
      });
    }

    // repeated tracking
    const repBody = $("tblRepeated")?.querySelector("tbody");
    if (repBody) {
      repBody.innerHTML = "";
      const repeated = list
        .filter(a => a.trackingRows > 1)
        .sort((a, b) => b.trackingRows - a.trackingRows)
        .slice(0, 25);

      repeated.forEach((agg) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${agg.tracking}</td><td>${agg.trackingRows}</td><td>${agg.carrier}</td>`;
        repBody.appendChild(tr);
      });
    }

    // carriers table
    const carriersBody = $("tblCarriers")?.querySelector("tbody");
    if (carriersBody) {
      carriersBody.innerHTML = "";
      ["FedEx", "UPS", "USPS", "Other"].forEach((c) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${c}</td><td>${counts[c] || 0}</td>`;
        carriersBody.appendChild(tr);
      });
    }

    // returns condition summary
    const returnsBody = $("tblReturns")?.querySelector("tbody");
    if (returnsBody) {
      returnsBody.innerHTML = "";
      const statusMap = new Map(); // status -> {rows, pieces}

      for (const agg of list) {
        for (const p of agg.parts) {
          const key = asString(p.status) || "(blank)";
          if (!statusMap.has(key)) statusMap.set(key, { rows: 0, pieces: 0 });
          const obj = statusMap.get(key);
          obj.rows += 1;
          obj.pieces += (p.qty || 1);
        }
      }

      const sorted = Array.from(statusMap.entries()).sort((a, b) => b[1].pieces - a[1].pieces);
      sorted.forEach(([status, v]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${status}</td><td>${v.rows}</td><td>${v.pieces}</td>`;
        returnsBody.appendChild(tr);
      });
    }

    // manifest
    const manBody = $("tblManifest")?.querySelector("tbody");
    if (manBody) {
      manBody.innerHTML = "";
      const sorted = list.slice().sort((a, b) => b.partsPieces - a.partsPieces);
      sorted.forEach((agg) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${agg.tracking}</td><td>${agg.carrier}</td><td>${agg.trackingRows}</td><td>${agg.partsPieces}</td>`;
        manBody.appendChild(tr);
      });
    }

    // loose parts
    const looseBody = $("tblLoose")?.querySelector("tbody");
    if (looseBody) {
      looseBody.innerHTML = "";
      state.looseParts.forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${p.part}</td><td>${p.qty}</td><td>${p.status || ""}</td><td>${p.rawTracking || ""}</td>`;
        looseBody.appendChild(tr);
      });
    }

    renderManualTable();
    renderLogsTable();

    setText("pTotalScans", totalScans);
    setText("pUnique", uniqueTracking);
    setText("pParts", totalParts);
    setText("pMulti", multiPartBoxes);

    const statusLine = $("statusLine");
    if (statusLine) {
      statusLine.textContent =
        uniqueTracking === 0 && state.rows.length === 0 && state.manual.length === 0
          ? "No WH CSV loaded."
          : `Loaded ${state.rows.length} CSV rows. Unique tracking: ${uniqueTracking}. Total parts (pieces): ${totalParts}.`;
    }
  }

  // ----------------------------
  // Tabs
  // ----------------------------
  function setActiveTab(tabName) {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tabName);
    });
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    const panel = $(`panel-${tabName}`);
    if (panel) panel.classList.add("active");
  }

  function bindTabs() {
    const tabs = $("tabs");
    if (!tabs) return;
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      setActiveTab(btn.dataset.tab);
    });
  }

  // ----------------------------
  // Modal
  // ----------------------------
  function showSummaryModal() {
    const modal = $("modalSummary");
    const backdrop = $("modalBackdrop");
    if (!modal || !backdrop) return;

    const chk = $("chkConfirm");
    if (chk) chk.checked = false;

    backdrop.classList.remove("hidden");
    modal.classList.remove("hidden");
  }

  function hideSummaryModal() {
    const modal = $("modalSummary");
    const backdrop = $("modalBackdrop");
    if (!modal || !backdrop) return;
    modal.classList.add("hidden");
    backdrop.classList.add("hidden");
  }

  function bindModal() {
    $("modalBackdrop")?.addEventListener("click", hideSummaryModal);
    $("btnModalX")?.addEventListener("click", hideSummaryModal);
    $("btnModalCancel")?.addEventListener("click", hideSummaryModal);
  }

  // ----------------------------
  // CSV load
  // ----------------------------
  function bindCSV() {
    const input = $("csvFile");
    if (!input) return;

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          state.rows = Array.isArray(res.data) ? res.data : [];
          computeFromRows(state.rows);
          renderAll();
        },
        error: (err) => {
          console.error("CSV parse error:", err);
          alert("CSV parse error. Check the file format.");
        }
      });
    });
  }

  // ----------------------------
  // Manual
  // ----------------------------
  function bindManual() {
    $("btnManualAdd")?.addEventListener("click", () => {
      const tracking = asString($("manTracking")?.value);
      const carrier = asString($("manCarrier")?.value) || "Other";
      const piecesRaw = asString($("manPieces")?.value);

      const pieces = parseInt(piecesRaw.replace(/[^\d]/g, ""), 10);
      if (!tracking) return alert("Enter Tracking ID.");
      if (!Number.isFinite(pieces) || pieces <= 0) return alert("Enter a valid pieces number.");

      state.manual.push({ tracking, carrier, pieces: Math.min(pieces, 999999) });
      renderAll();
    });

    $("btnManualClear")?.addEventListener("click", () => {
      if ($("manTracking")) $("manTracking").value = "";
      if ($("manPieces")) $("manPieces").value = "";
      if ($("manCarrier")) $("manCarrier").value = "FedEx";
    });

    // event delegation for delete
    const body = $("tblManual")?.querySelector("tbody");
    if (body) {
      body.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-del]");
        if (!btn) return;
        const i = parseInt(btn.dataset.del, 10);
        if (!Number.isFinite(i)) return;
        state.manual.splice(i, 1);
        renderAll();
      });
    }
  }

  // ----------------------------
  // Logs
  // ----------------------------
  const LOG_KEY = "rrpd_logs_v2";

  function loadLogs() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveLogs() {
    localStorage.setItem(LOG_KEY, JSON.stringify(state.logs));
  }

  function exportLogsCSV() {
    const header = ["when", "note", "totalParts", "uniqueTracking", "totalScans"];
    const lines = [header.join(",")];

    for (const l of state.logs) {
      lines.push([
        l.when,
        `"${(l.note || "").replace(/"/g, '""')}"`,
        l.totalParts,
        l.uniqueTracking,
        l.totalScans
      ].join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    saveAs(blob, `rrpd_logs_${new Date().toISOString().slice(0,10)}.csv`);
  }

  function bindLogs() {
    state.logs = loadLogs();
    renderLogsTable();

    $("btnLogAdd")?.addEventListener("click", () => {
      // safe snapshot
      computeFromRows(state.rows);
      applyManual();
      const list = Array.from(state.byTracking.values());

      const totalScans = list.reduce((a, x) => a + x.trackingRows, 0);
      const uniqueTracking = list.length;
      const totalParts = list.reduce((a, x) => a + x.partsPieces, 0);

      state.logs.unshift({
        when: new Date().toLocaleString(),
        note: asString($("logNote")?.value),
        totalParts,
        uniqueTracking,
        totalScans
      });

      saveLogs();
      renderLogsTable();
    });

    $("btnLogExport")?.addEventListener("click", exportLogsCSV);

    $("btnLogClearAll")?.addEventListener("click", () => {
      if (!confirm("Delete all logs?")) return;
      state.logs = [];
      saveLogs();
      renderLogsTable();
    });

    const body = $("tblLogs")?.querySelector("tbody");
    if (body) {
      body.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-del]");
        if (!btn) return;
        const i = parseInt(btn.dataset.del, 10);
        if (!Number.isFinite(i)) return;
        state.logs.splice(i, 1);
        saveLogs();
        renderLogsTable();
      });
    }
  }

  // ----------------------------
  // Export Summary
  // ----------------------------
  function requireConfirm() {
    const chk = $("chkConfirm");
    if (!chk || !chk.checked) {
      alert("Please check: 'I confirm this snapshot is correct.'");
      return false;
    }
    return true;
  }

  function buildSummaryRows() {
    const list = Array.from(state.byTracking.values());
    return list
      .slice()
      .sort((a, b) => b.partsPieces - a.partsPieces)
      .map(a => [a.tracking, a.carrier, a.trackingRows, a.partsPieces]);
  }

  function exportPDF() {
    if (!requireConfirm()) return;

    computeFromRows(state.rows);
    applyManual();
    const list = Array.from(state.byTracking.values());

    const totalScans = list.reduce((a, x) => a + x.trackingRows, 0);
    const uniqueTracking = list.length;
    const totalParts = list.reduce((a, x) => a + x.partsPieces, 0);
    const multi = list.filter(x => x.partsPieces > 1).length;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

    doc.setFontSize(16);
    doc.text("RRPD Receiving Summary", 40, 50);
    doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 70);
    doc.text(`Total Scans (tracking rows): ${totalScans}`, 40, 88);
    doc.text(`Unique Tracking: ${uniqueTracking}`, 40, 104);
    doc.text(`Total Parts (pieces): ${totalParts}`, 40, 120);
    doc.text(`Multi-Part Boxes: ${multi}`, 40, 136);

    doc.autoTable({
      startY: 160,
      head: [["Tracking", "Carrier", "Tracking Rows", "Pieces"]],
      body: buildSummaryRows(),
      styles: { fontSize: 9 }
    });

    doc.save(`rrpd_summary_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  async function exportExcel() {
    if (!requireConfirm()) return;

    computeFromRows(state.rows);
    applyManual();
    const list = Array.from(state.byTracking.values());

    const totalScans = list.reduce((a, x) => a + x.trackingRows, 0);
    const uniqueTracking = list.length;
    const totalParts = list.reduce((a, x) => a + x.partsPieces, 0);
    const multi = list.filter(x => x.partsPieces > 1).length;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("RRPD Summary");

    ws.addRow(["RRPD Receiving Summary"]);
    ws.addRow([`Generated: ${new Date().toLocaleString()}`]);
    ws.addRow([]);

    ws.addRow(["Total Scans (tracking rows)", totalScans]);
    ws.addRow(["Unique Tracking", uniqueTracking]);
    ws.addRow(["Total Parts (pieces)", totalParts]);
    ws.addRow(["Multi-Part Boxes", multi]);
    ws.addRow([]);

    ws.addRow(["Tracking", "Carrier", "Tracking Rows", "Pieces"]);
    ws.lastRow.font = { bold: true };

    for (const r of buildSummaryRows()) ws.addRow(r);
    ws.columns.forEach(c => (c.width = 22));

    const buf = await wb.xlsx.writeBuffer();
    saveAs(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `rrpd_summary_${new Date().toISOString().slice(0,10)}.xlsx`
    );
  }

  function bindExport() {
    $("btnExportSummary")?.addEventListener("click", showSummaryModal);
    $("btnExportPDF")?.addEventListener("click", exportPDF);
    $("btnExportExcel")?.addEventListener("click", exportExcel);
    $("btnSaveLogs")?.addEventListener("click", () => setActiveTab("logs"));
  }

  // ----------------------------
  // Init
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    try {
      bindTabs();
      bindModal();
      bindCSV();
      bindManual();
      bindLogs();
      bindExport();

      renderAll();

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") hideSummaryModal();
      });
    } catch (err) {
      console.error("Init error:", err);
      alert("RRPD page init error — open Console for details.");
    }
  });

})();
