/* RRPD Receiving Dashboard - FINAL (CLICK-SAFE v4)
   Tracking rows: ONLY classification Return Label / Packing Slip
   Parts: any other classification
   Quantity multiplier: xN / Nx / x N / N x (cap 50)
*/

(() => {
  "use strict";

  // ----------------------------
  // Utilities
  // ----------------------------
  const $ = (id) => document.getElementById(id);

  function on(id, evt, fn, opts) {
    const el = $(id);
    if (!el) return false;
    el.addEventListener(evt, fn, opts);
    return true;
  }

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

  function sciToPlainString(s) {
    const t = asString(s);
    if (!t) return "";
    if (!looksLikeScientific(t)) return t;
    const n = Number(t);
    if (!Number.isFinite(n)) return t;
    return Math.round(n).toString();
  }

  function parsePartAndQty(partRaw) {
    let part = asString(partRaw);
    if (!part) return { basePart: "", qty: 1 };

    let qty = 1;
    const cap = 50;
    let s = part.replace(/\s+/g, " ").trim();

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

      s = s
        .replace(/(?:^|[\s\-])x\s*\d{1,3}\s*$/i, "")
        .replace(/(?:^|[\s\-])\d{1,3}\s*x\s*$/i, "")
        .replace(/(?:^|[\s\-])\*\s*\d{1,3}\s*$/i, "")
        .trim();
    }

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

    if (/^1Z/i.test(tracking)) return "UPS";
    if (/^(92|93|94|95)\d{20,22}$/.test(tracking)) return "USPS";
    if (/^9\d{21,22}$/.test(tracking)) return "USPS";
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
    byTracking: new Map(),
    looseParts: [],
    manualCounts: [],     // { item, qty, carrier }
    logs: [],
    carrierChart: null,
    returnsChart: null
  };

  // ----------------------------
  // Compute
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
        parts: [], // {part, qty, status}
      });
    }
    return state.byTracking.get(tracking);
  }

  function computeFromRows(rows) {
    resetComputed();

    const classificationKeys = ["Classification","classification","Type","type","Category","category"];
    const trackingKeys = ["Tracking","tracking","Tracking Number","tracking number","TrackingNumber","trackingNumber","Return Tracking","return tracking"];
    const partKeys = ["Deposo PN","DeposoPN","Part","Part Number","PartNumber","part","part number"];
    const statusKeys = ["Status","status","Condition","condition"];
    const qtyKeys = ["Qty","qty","Quantity","quantity","Pieces","pieces"];

    for (const row of rows) {
      const classification = pickField(row, classificationKeys);
      const isTrackingRow = isTrackingClassification(classification);

      let tracking = pickField(row, trackingKeys);

      if (!tracking) {
        const values = Object.values(row || {}).map(asString).filter(Boolean);
        const candidate = values.find(v =>
          /^1Z/i.test(v) || /^\d{12,22}$/.test(v) || looksLikeScientific(v)
        );
        tracking = candidate || "";
      }

      tracking = sciToPlainString(tracking);
      const status = pickField(row, statusKeys);

      if (!isTrackingRow) {
        let partRaw = pickField(row, partKeys);

        if (!partRaw) {
          const values = Object.values(row || {}).map(asString).filter(Boolean);
          partRaw =
            values.find(v => !/^1Z/i.test(v) && !/^\d{12,22}$/.test(v) && !looksLikeScientific(v)) || "";
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
          state.looseParts.push({ ...partObj, rawTracking: "" });
        }
      } else {
        if (!tracking) continue;
        const agg = upsertAgg(tracking);
        agg.trackingRows += 1;
      }
    }
  }

  function manualTotalQty() {
    return state.manualCounts.reduce((a, x) => a + (x.qty || 0), 0);
  }

  // ----------------------------
  // Charts (never allowed to break the page)
  // ----------------------------
  function safeChartDestroy(chart) {
    try { chart?.destroy?.(); } catch {}
  }

  function updateCarrierChart(counts) {
    const canvas = $("carrierChart");
    if (!canvas || !window.Chart) return;

    const labels = ["FedEx", "UPS", "USPS", "Other"];
    const data = [counts.FedEx, counts.UPS, counts.USPS, counts.Other];

    try {
      if (state.carrierChart) {
        state.carrierChart.data.labels = labels;
        state.carrierChart.data.datasets[0].data = data;
        state.carrierChart.update();
        return;
      }

      state.carrierChart = new Chart(canvas, {
        type: "bar",
        data: { labels, datasets: [{ label: "Tracking Rows", data }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    } catch (e) {
      console.error("Carrier chart error:", e);
      safeChartDestroy(state.carrierChart);
      state.carrierChart = null;
    }
  }

  function updateReturnsChart(statusPairs) {
    const canvas = $("returnsChart");
    if (!canvas || !window.Chart) return;

    const top = statusPairs.slice(0, 8);
    const labels = top.map(x => x[0]);
    const data = top.map(x => x[1].pieces);

    try {
      if (state.returnsChart) {
        state.returnsChart.data.labels = labels;
        state.returnsChart.data.datasets[0].data = data;
        state.returnsChart.update();
        return;
      }

      state.returnsChart = new Chart(canvas, {
        type: "bar",
        data: { labels, datasets: [{ label: "Pieces", data }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    } catch (e) {
      console.error("Returns chart error:", e);
      safeChartDestroy(state.returnsChart);
      state.returnsChart = null;
    }
  }

  // ----------------------------
  // Render
  // ----------------------------
  function renderAll() {
    const list = Array.from(state.byTracking.values());

    let counts = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
    let totalScans = 0;
    let uniqueTracking = list.length;
    let totalParts = 0;
    let multiPartBoxes = 0;

    for (const agg of list) {
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

    updateCarrierChart({
      FedEx: counts.FedEx || 0,
      UPS: counts.UPS || 0,
      USPS: counts.USPS || 0,
      Other: counts.Other || 0
    });

    // samples
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

    // repeated
    const repBody = $("tblRepeated")?.querySelector("tbody");
    if (repBody) {
      repBody.innerHTML = "";
      const repeated = list
        .filter(a => a.trackingRows > 1)
        .sort((a,b) => b.trackingRows - a.trackingRows)
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
      ["FedEx","UPS","USPS","Other"].forEach((c) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${c}</td><td>${counts[c] || 0}</td>`;
        carriersBody.appendChild(tr);
      });
    }

    // returns condition
    const returnsBody = $("tblReturns")?.querySelector("tbody");
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
    const statusPairs = Array.from(statusMap.entries())
      .sort((a,b) => b[1].pieces - a[1].pieces);

    if (returnsBody) {
      returnsBody.innerHTML = "";
      statusPairs.forEach(([status, v]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${status}</td><td>${v.rows}</td><td>${v.pieces}</td>`;
        returnsBody.appendChild(tr);
      });
    }

    updateReturnsChart(statusPairs);

    // manifest
    const manBody = $("tblManifest")?.querySelector("tbody");
    if (manBody) {
      manBody.innerHTML = "";
      const sorted = list.slice().sort((a,b) => b.partsPieces - a.partsPieces);
      sorted.forEach((agg) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${agg.tracking}</td><td>${agg.carrier}</td><td>${agg.trackingRows}</td><td>${agg.partsPieces}</td>`;
        manBody.appendChild(tr);
      });
    }

    // loose
    const looseBody = $("tblLoose")?.querySelector("tbody");
    if (looseBody) {
      looseBody.innerHTML = "";
      state.looseParts.forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${p.part}</td><td>${p.qty}</td><td>${p.status || ""}</td><td>${p.rawTracking || ""}</td>`;
        looseBody.appendChild(tr);
      });
    }

    // manual table
    renderManualTable();

    // modal preview numbers
    setText("pTotalScans", totalScans);
    setText("pUnique", uniqueTracking);
    setText("pParts", totalParts);
    setText("pMulti", multiPartBoxes);

    // status line
    const statusLine = $("statusLine");
    if (statusLine) {
      const manQty = manualTotalQty();
      const base =
        uniqueTracking === 0 && state.rows.length === 0 && state.manualCounts.length === 0
          ? "No WH CSV loaded."
          : `Loaded ${state.rows.length} CSV rows. Unique tracking: ${uniqueTracking}. Total parts (pieces): ${totalParts}. Manual qty: ${manQty}.`;
      statusLine.textContent = base;
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
    $("modalSummary")?.classList.add("hidden");
    $("modalBackdrop")?.classList.add("hidden");
  }

  function bindModal() {
    on("modalBackdrop", "click", hideSummaryModal);
    on("btnModalX", "click", hideSummaryModal);
    on("btnModalCancel", "click", hideSummaryModal);
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

      if (!window.Papa) {
        alert("PapaParse failed to load. Check internet/CDN.");
        return;
      }

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
  // Manual Counts (FIXED delete works now)
  // ----------------------------
  function renderManualTable() {
    const body = $("tblManual")?.querySelector("tbody");
    if (!body) return;

    body.innerHTML = "";
    state.manualCounts.forEach((m, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.item}</td>
        <td>${m.qty}</td>
        <td>${m.carrier}</td>
        <td><button class="btn danger" data-del="${idx}" type="button">Delete</button></td>
      `;
      body.appendChild(tr);
    });
  }

  function bindManual() {
    on("btnManualAdd", "click", () => {
      const item = asString($("manItem")?.value);
      const qtyRaw = asString($("manQty")?.value);
      const carrier = asString($("manCarrier")?.value) || "All";

      const qty = parseInt(qtyRaw.replace(/[^\d]/g, ""), 10);
      if (!item) return alert("Enter an item (ex: Racks, Axles).");
      if (!Number.isFinite(qty) || qty <= 0) return alert("Enter a valid qty.");

      state.manualCounts.unshift({ item, qty, carrier });

      if ($("manItem")) $("manItem").value = "";
      if ($("manQty")) $("manQty").value = "";
      if ($("manCarrier")) $("manCarrier").value = "All";

      renderAll();
    });

    on("btnManualClear", "click", () => {
      if ($("manItem")) $("manItem").value = "";
      if ($("manQty")) $("manQty").value = "";
      if ($("manCarrier")) $("manCarrier").value = "All";
    });

    // ✅ Delete handler (delegated) — this was missing in your version
    const body = $("tblManual")?.querySelector("tbody");
    if (body) {
      body.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-del]");
        if (!btn) return;
        const i = parseInt(btn.dataset.del, 10);
        if (!Number.isFinite(i)) return;
        state.manualCounts.splice(i, 1);
        renderAll();
      });
    }
  }

  // ----------------------------
  // Logs (localStorage)
  // ----------------------------
  const LOG_KEY = "rrpd_logs_final_v4";

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
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(state.logs));
    } catch (e) {
      console.error("localStorage save failed:", e);
      alert("Saving logs failed (storage blocked/full).");
    }
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
        <td>${l.manualQty}</td>
        <td><button class="btn danger" data-del="${idx}" type="button">Delete</button></td>
      `;
      body.appendChild(tr);
    });
  }

  function exportLogsCSV() {
    if (!window.saveAs) {
      alert("FileSaver failed to load. Check internet/CDN.");
      return;
    }

    const header = ["when","note","totalParts","uniqueTracking","totalScans","manualQty"];
    const lines = [header.join(",")];
    for (const l of state.logs) {
      lines.push([
        l.when,
        `"${(l.note || "").replace(/"/g, '""')}"`,
        l.totalParts,
        l.uniqueTracking,
        l.totalScans,
        l.manualQty
      ].join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    saveAs(blob, `rrpd_logs_${new Date().toISOString().slice(0,10)}.csv`);
  }

  function bindLogs() {
    state.logs = loadLogs();
    renderLogsTable();

    on("btnLogAdd", "click", () => {
      const list = Array.from(state.byTracking.values());
      const totalScans = list.reduce((a, x) => a + x.trackingRows, 0);
      const uniqueTracking = list.length;
      const totalParts = list.reduce((a, x) => a + x.partsPieces, 0);
      const manualQty = manualTotalQty();

      state.logs.unshift({
        when: new Date().toLocaleString(),
        note: asString($("logNote")?.value),
        totalParts,
        uniqueTracking,
        totalScans,
        manualQty
      });

      saveLogs();
      renderLogsTable();
    });

    on("btnLogExport", "click", exportLogsCSV);

    on("btnLogClearAll", "click", () => {
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
      .sort((a,b) => b.partsPieces - a.partsPieces)
      .map(a => [a.tracking, a.carrier, a.trackingRows, a.partsPieces]);
  }

  function buildManualRows() {
    return state.manualCounts.map(m => [m.item, m.qty, m.carrier]);
  }

  function exportPDF() {
    if (!requireConfirm()) return;
    if (!window.jspdf?.jsPDF) {
      alert("jsPDF failed to load. Check internet/CDN.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

    const list = Array.from(state.byTracking.values());
    const totalScans = list.reduce((a, x) => a + x.trackingRows, 0);
    const uniqueTracking = list.length;
    const totalParts = list.reduce((a, x) => a + x.partsPieces, 0);
    const multi = list.filter(x => x.partsPieces > 1).length;
    const manualQty = manualTotalQty();

    doc.setFontSize(16);
    doc.text("RRPD Receiving Summary", 40, 50);

    doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 70);
    doc.text(`Total Scans (tracking rows): ${totalScans}`, 40, 88);
    doc.text(`Unique Tracking: ${uniqueTracking}`, 40, 104);
    doc.text(`Total Parts (pieces): ${totalParts}`, 40, 120);
    doc.text(`Multi-Part Boxes: ${multi}`, 40, 136);
    doc.text(`Manual Qty (racks/axles/etc): ${manualQty}`, 40, 152);

    doc.autoTable({
      startY: 175,
      head: [["Tracking", "Carrier", "Tracking Rows", "Pieces"]],
      body: buildSummaryRows(),
      styles: { fontSize: 9 }
    });

    const after = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 18 : 520;

    const manual = buildManualRows();
    if (manual.length) {
      doc.text("Manual Counts", 40, after);
      doc.autoTable({
        startY: after + 10,
        head: [["Item", "Qty", "Carrier"]],
        body: manual,
        styles: { fontSize: 9 }
      });
    }

    doc.save(`rrpd_summary_${new Date().toISOString().slice(0,10)}.pdf`);
    hideSummaryModal(); // ✅ close modal after export
  }

  async function exportExcel() {
    if (!requireConfirm()) return;
    if (!window.ExcelJS || !window.saveAs) {
      alert("ExcelJS or FileSaver failed to load. Check internet/CDN.");
      return;
    }

    const wb = new ExcelJS.Workbook();

    const list = Array.from(state.byTracking.values());
    const totalScans = list.reduce((a, x) => a + x.trackingRows, 0);
    const uniqueTracking = list.length;
    const totalParts = list.reduce((a, x) => a + x.partsPieces, 0);
    const multi = list.filter(x => x.partsPieces > 1).length;
    const manualQty = manualTotalQty();

    const ws = wb.addWorksheet("RRPD Summary");
    ws.addRow(["RRPD Receiving Summary"]);
    ws.addRow([`Generated: ${new Date().toLocaleString()}`]);
    ws.addRow([]);
    ws.addRow(["Total Scans (tracking rows)", totalScans]);
    ws.addRow(["Unique Tracking", uniqueTracking]);
    ws.addRow(["Total Parts (pieces)", totalParts]);
    ws.addRow(["Multi-Part Boxes", multi]);
    ws.addRow(["Manual Qty (racks/axles/etc)", manualQty]);
    ws.addRow([]);

    const header = ws.addRow(["Tracking", "Carrier", "Tracking Rows", "Pieces"]);
    header.font = { bold: true };

    for (const r of buildSummaryRows()) ws.addRow(r);
    ws.columns.forEach(c => (c.width = 24));

    const ws2 = wb.addWorksheet("Manual Counts");
    const header2 = ws2.addRow(["Item", "Qty", "Carrier"]);
    header2.font = { bold: true };
    for (const r of buildManualRows()) ws2.addRow(r);
    ws2.columns.forEach(c => (c.width = 26));

    const buf = await wb.xlsx.writeBuffer();
    saveAs(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `rrpd_summary_${new Date().toISOString().slice(0,10)}.xlsx`
    );

    hideSummaryModal(); // ✅ close modal after export
  }

  function bindExport() {
    on("btnExportSummary", "click", showSummaryModal);
    on("btnExportPDF", "click", exportPDF);
    on("btnExportExcel", "click", exportExcel);

    on("btnSaveLogs", "click", () => setActiveTab("logs"));
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

      computeFromRows([]);
      renderAll();

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") hideSummaryModal();
      });
    } catch (err) {
      console.error("Init error:", err);
      alert("RRPD init error — open Console for details.");
    }
  });
})();
