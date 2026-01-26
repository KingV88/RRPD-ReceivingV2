/* RRPD Receiving Dashboard - FINAL
   - Tracking rows: ONLY classification Return Label / Packing Slip
   - Parts: everything else
   - Part qty multiplier: xN / Nx / xN... cap 50
   - Panels in order: Dashboard, Carriers, Returns Condition, Manual Counts, Manifest, Loose Parts, Logs
   - Logs stay on site only (localStorage), not exported
   - Export modal never locks page (Cancel/backdrop/ESC)
*/

(() => {
  "use strict";

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const STATUS = $("#statusLine");

  const TRACKING_ONLY_CLASSES = new Set(["return label", "packing slip"]);
  const MULTIPLIER_CAP = 50;

  function nowIso() {
    const d = new Date();
    return d.toISOString();
  }

  function fmtWhen(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }

  function normStr(v) {
    return (v ?? "").toString().trim();
  }

  function normLower(v) {
    return normStr(v).toLowerCase();
  }

  function isTrackingClassification(classification) {
    const c = normLower(classification);
    return TRACKING_ONLY_CLASSES.has(c);
  }

  // Extract qty from strings like:
  //  "683318050259x2", "683318050259 x2", "x10", "10x", "6833...x10", "6833... 10x"
  // If no multiplier -> 1
  // Cap at 50
  function extractQty(partFieldRaw) {
    const s = normStr(partFieldRaw);
    if (!s) return 1;

    // Look for xN or Nx
    // Examples: "...x2", "x2", "... 2x", "2x"
    const m1 = s.match(/(?:^|\s|[^a-z0-9])x\s*(\d{1,3})(?:$|\s|[^a-z0-9])/i);
    const m2 = s.match(/(?:^|\s|[^a-z0-9])(\d{1,3})\s*x(?:$|\s|[^a-z0-9])/i);

    let qty = 1;
    if (m1?.[1]) qty = parseInt(m1[1], 10);
    else if (m2?.[1]) qty = parseInt(m2[1], 10);

    if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    if (qty > MULTIPLIER_CAP) qty = MULTIPLIER_CAP;
    return qty;
  }

  // Strip the multiplier suffix to get a cleaner part number display
  function stripMultiplier(partFieldRaw) {
    let s = normStr(partFieldRaw);
    if (!s) return "";
    // Remove patterns xN or Nx near end or surrounded
    s = s.replace(/\s*(x\s*\d{1,3}|\d{1,3}\s*x)\s*$/i, "").trim();
    return s;
  }

  function looksEmptyTracking(t) {
    const s = normStr(t);
    if (!s) return true;
    if (normLower(s) === "null") return true;
    return false;
  }

  // Carrier guess from explicit field OR tracking pattern
  function guessCarrier(rowCarrier, tracking) {
    const c = normLower(rowCarrier);
    if (c.includes("fedex")) return "FedEx";
    if (c.includes("ups")) return "UPS";
    if (c.includes("usps")) return "USPS";

    const t = normStr(tracking).replace(/\s+/g, "");

    // UPS usually starts with 1Z
    if (/^1Z[0-9A-Z]{8,}$/i.test(t)) return "UPS";

    // USPS often 20-22 digits starting with 9 (not always)
    if (/^9\d{19,21}$/.test(t)) return "USPS";

    // FedEx common: 12, 15, 20, 22 digits (varies). If it’s long numeric and not USPS pattern, mark FedEx.
    if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t) || /^\d{20}$/.test(t) || /^\d{22}$/.test(t)) return "FedEx";

    return "Other";
  }

  function safeFilename(prefix, ext) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    return `${prefix}_${stamp}.${ext}`;
  }

  // ---------- State ----------
  const state = {
    whRows: [],
    manifest: {
      headers: [],
      rows: [],
    },
    manualCounts: [],
    chart: null,
  };

  // ---------- Column Detection (WH CSV) ----------
  function detectWhColumns(headers) {
    const H = headers.map(h => normLower(h));

    const findIdx = (preds) => {
      for (const p of preds) {
        const idx = H.findIndex(h => h.includes(p));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    // flexible mapping
    const idxTracking = findIdx(["tracking", "track"]);
    const idxCarrier = findIdx(["carrier", "shipper"]);
    const idxClass = findIdx(["classification", "class", "type"]);
    const idxPart = findIdx(["part number", "part", "pn"]);
    const idxStatus = findIdx(["status", "condition"]);
    const idxNotes = findIdx(["notes", "note", "comment"]);
    const idxUser = findIdx(["user", "employee", "operator"]);

    return { idxTracking, idxCarrier, idxClass, idxPart, idxStatus, idxNotes, idxUser };
  }

  function whRowFromCsvRow(csvRow, cols) {
    const vals = Array.isArray(csvRow) ? csvRow : [];
    const get = (i) => (i >= 0 ? vals[i] : "");

    const tracking = normStr(get(cols.idxTracking));
    const carrierRaw = normStr(get(cols.idxCarrier));
    const classification = normStr(get(cols.idxClass));
    const partField = normStr(get(cols.idxPart));
    const status = normStr(get(cols.idxStatus));
    const notes = normStr(get(cols.idxNotes));
    const user = normStr(get(cols.idxUser));

    const carrier = guessCarrier(carrierRaw, tracking);
    const isTrackingRow = isTrackingClassification(classification);

    const qty = isTrackingRow ? 0 : extractQty(partField);
    const partNo = isTrackingRow ? "" : stripMultiplier(partField);

    return {
      tracking,
      carrier,
      classification,
      isTrackingRow,
      partField,
      partNo,
      qty,
      status,
      notes,
      user,
    };
  }

  // ---------- Compute Metrics ----------
  function computeAll() {
    const wh = state.whRows;

    const trackingRows = wh.filter(r => r.isTrackingRow && !looksEmptyTracking(r.tracking));
    const partsRows = wh.filter(r => !r.isTrackingRow); // parts can exist even if tracking missing

    // Carrier counts (tracking rows only)
    const carrierCounts = { "FedEx": 0, "UPS": 0, "USPS": 0, "Other": 0 };
    for (const r of trackingRows) carrierCounts[r.carrier] = (carrierCounts[r.carrier] ?? 0) + 1;

    // Tracking IDs
    const trackingFreq = new Map();
    const trackingToCarrier = new Map();
    for (const r of trackingRows) {
      const t = normStr(r.tracking);
      if (!t) continue;
      trackingFreq.set(t, (trackingFreq.get(t) ?? 0) + 1);
      if (!trackingToCarrier.has(t)) trackingToCarrier.set(t, r.carrier);
    }
    const uniqueTracking = trackingFreq.size;

    // Repeated tracking list
    const repeated = Array.from(trackingFreq.entries())
      .filter(([, c]) => c > 1)
      .map(([t, c]) => ({ tracking: t, scans: c, carrier: trackingToCarrier.get(t) ?? "Other" }))
      .sort((a, b) => b.scans - a.scans || a.tracking.localeCompare(b.tracking));

    // Parts total in pieces (qty)
    const totalParts = partsRows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

    // Multi-part boxes: group parts by tracking/box id; count boxes with total parts > 1
    const boxParts = new Map(); // tracking -> pieces
    for (const r of partsRows) {
      const key = normStr(r.tracking) || "(no tracking)";
      boxParts.set(key, (boxParts.get(key) ?? 0) + (Number(r.qty) || 0));
    }
    let multiPartBoxes = 0;
    for (const [, pieces] of boxParts.entries()) if (pieces > 1) multiPartBoxes++;

    // Returns condition table (parts only, in pieces)
    const condition = new Map(); // status -> pieces
    for (const r of partsRows) {
      const key = normStr(r.status) || "Unknown";
      condition.set(key, (condition.get(key) ?? 0) + (Number(r.qty) || 0));
    }
    const conditionRows = Array.from(condition.entries())
      .map(([status, pieces]) => ({ status, pieces }))
      .sort((a, b) => b.pieces - a.pieces || a.status.localeCompare(b.status));

    // Loose parts: parts rows where tracking empty/null
    const looseParts = partsRows
      .filter(r => looksEmptyTracking(r.tracking))
      .map(r => ({
        tracking: r.tracking,
        part: r.partNo || r.partField || "(no part)",
        qty: r.qty || 1,
        status: r.status || "Unknown",
        classification: r.classification || "(blank)"
      }));

    // Samples latest 25 (tracking rows only)
    const samples = trackingRows
      .slice(-25)
      .reverse()
      .map(r => ({
        tracking: r.tracking,
        carrier: r.carrier,
        classification: r.classification
      }));

    // Carrier table rows
    const carrierTable = ["FedEx", "UPS", "USPS", "Other"].map(name => {
      const ids = trackingRows.filter(r => r.carrier === name).map(r => normStr(r.tracking)).filter(Boolean);
      return {
        carrier: name,
        rows: carrierCounts[name] ?? 0,
        unique: new Set(ids).size
      };
    });

    return {
      carrierCounts,
      trackingRowsCount: trackingRows.length,
      uniqueTracking,
      totalParts,
      multiPartBoxes,
      repeated,
      samples,
      carrierTable,
      conditionRows,
      looseParts
    };
  }

  // ---------- Render ----------
  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  }

  function renderKpis(m) {
    setText("kpiFedex", m.carrierCounts["FedEx"] ?? 0);
    setText("kpiUps", m.carrierCounts["UPS"] ?? 0);
    setText("kpiUsps", m.carrierCounts["USPS"] ?? 0);
    setText("kpiOther", m.carrierCounts["Other"] ?? 0);
    setText("kpiTrackingRows", m.trackingRowsCount);
    setText("kpiUniqueTracking", m.uniqueTracking);
    setText("kpiTotalParts", m.totalParts);
    setText("kpiMultiPartBoxes", m.multiPartBoxes);
  }

  function renderRepeated(m) {
    const tbody = $("#repeatedTable tbody");
    tbody.innerHTML = "";
    const top = m.repeated.slice(0, 25);
    for (const r of top) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.tracking)}</td><td>${r.scans}</td><td>${escapeHtml(r.carrier)}</td>`;
      tbody.appendChild(tr);
    }
  }

  function renderSamples(m) {
    const tbody = $("#sampleTable tbody");
    tbody.innerHTML = "";
    for (const r of m.samples) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.tracking)}</td><td>${escapeHtml(r.carrier)}</td><td>${escapeHtml(r.classification)}</td>`;
      tbody.appendChild(tr);
    }
  }

  function renderCarrierTable(m) {
    const tbody = $("#carrierTable tbody");
    tbody.innerHTML = "";
    for (const r of m.carrierTable) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.carrier)}</td><td>${r.rows}</td><td>${r.unique}</td>`;
      tbody.appendChild(tr);
    }
  }

  function renderCondition(m) {
    const tbody = $("#conditionTable tbody");
    tbody.innerHTML = "";
    for (const r of m.conditionRows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.status)}</td><td>${r.pieces}</td>`;
      tbody.appendChild(tr);
    }
  }

  function renderLoose(m) {
    const tbody = $("#looseTable tbody");
    tbody.innerHTML = "";
    const rows = m.looseParts.slice(0, 250);
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.tracking || "")}</td>
                      <td>${escapeHtml(r.part)}</td>
                      <td>${r.qty}</td>
                      <td>${escapeHtml(r.status)}</td>
                      <td>${escapeHtml(r.classification)}</td>`;
      tbody.appendChild(tr);
    }
  }

  function renderChart(m) {
    const ctx = $("#carrierChart");
    if (!ctx) return;

    const labels = ["FedEx", "UPS", "USPS", "Other"];
    const data = labels.map(k => m.carrierCounts[k] ?? 0);

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = data;
      state.chart.update();
      return;
    }

    state.chart = new Chart(ctx, {
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
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  function renderManual() {
    const tbody = $("#manualTable tbody");
    tbody.innerHTML = "";
    for (const item of state.manualCounts) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(fmtWhen(item.when))}</td>
        <td>${escapeHtml(item.box || "")}</td>
        <td>${escapeHtml(item.label)}</td>
        <td>${item.qty}</td>
        <td><button class="btn danger" data-remove-manual="${item.id}">Remove</button></td>
      `;
      tbody.appendChild(tr);
    }
  }

  function renderManifest() {
    const thead = $("#manifestThead");
    const tbody = $("#manifestTbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    if (!state.manifest.headers.length) {
      thead.innerHTML = "<tr><th>No manifest loaded</th></tr>";
      return;
    }

    // header row
    const hr = document.createElement("tr");
    for (const h of state.manifest.headers) {
      const th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    }
    thead.appendChild(hr);

    // rows (limit render for performance)
    const rows = state.manifest.rows.slice(0, 500);
    for (const r of rows) {
      const tr = document.createElement("tr");
      for (let i = 0; i < state.manifest.headers.length; i++) {
        const td = document.createElement("td");
        td.textContent = (r[i] ?? "");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function renderAll() {
    const m = computeAll();

    renderKpis(m);
    renderRepeated(m);
    renderSamples(m);
    renderCarrierTable(m);
    renderCondition(m);
    renderLoose(m);
    renderChart(m);
    renderManual();
    renderManifest();

    // modal preview values
    setText("prevTrackingRows", m.trackingRowsCount);
    setText("prevUniqueTracking", m.uniqueTracking);
    setText("prevTotalParts", m.totalParts);
    setText("prevMultiPartBoxes", m.multiPartBoxes);

    return m;
  }

  function escapeHtml(s) {
    return normStr(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- Tabs ----------
  function initTabs() {
    $$(".tab").forEach(btn => {
      btn.addEventListener("click", () => {
        $$(".tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const name = btn.dataset.tab;
        $$(".panel").forEach(p => p.classList.remove("active"));
        $("#panel-" + name).classList.add("active");
      });
    });
  }

  // ---------- CSV Loading ----------
  function loadWhCsv(file) {
    if (!file) return;

    STATUS.textContent = `Loading WH CSV: ${file.name} ...`;

    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data || [];
        if (!data.length) {
          STATUS.textContent = "WH CSV loaded but empty.";
          state.whRows = [];
          renderAll();
          return;
        }

        const headers = data[0].map(h => normStr(h));
        const cols = detectWhColumns(headers);

        // If we cannot detect required fields, try fallback with best guess columns:
        // tracking = col0, classification = last col? part = some middle
        // but we still keep it safe.
        const body = data.slice(1);
        const rows = body.map(r => whRowFromCsvRow(r, cols));

        state.whRows = rows;

        // reset modal checkbox each load
        $("#confirmSnapshot").checked = false;

        STATUS.textContent = `WH CSV loaded: ${file.name} (${rows.length} rows parsed)`;
        renderAll();
      },
      error: (err) => {
        console.error(err);
        STATUS.textContent = "Failed to parse WH CSV.";
      }
    });
  }

  function loadManifestCsv(file) {
    if (!file) return;

    STATUS.textContent = `Loading Manifest CSV: ${file.name} ...`;

    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data || [];
        if (!data.length) {
          state.manifest.headers = [];
          state.manifest.rows = [];
          STATUS.textContent = "Manifest loaded but empty.";
          renderManifest();
          return;
        }

        state.manifest.headers = (data[0] || []).map(h => normStr(h) || "(blank)");
        state.manifest.rows = (data.slice(1) || []).map(r => (Array.isArray(r) ? r : []));

        STATUS.textContent = `Manifest loaded: ${file.name} (${state.manifest.rows.length} rows)`;
        renderManifest();
      },
      error: (err) => {
        console.error(err);
        STATUS.textContent = "Failed to parse manifest CSV.";
      }
    });
  }

  // ---------- Logs ----------
  const LOG_KEY = "rrpd_logs_v2";
  function loadLogs() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveLogs(arr) {
    localStorage.setItem(LOG_KEY, JSON.stringify(arr));
  }

  function renderLogsTable() {
    const logs = loadLogs();
    const tbody = $("#logsTable tbody");
    tbody.innerHTML = "";

    for (const l of logs) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(fmtWhen(l.when))}</td>
        <td>${l.trackingRows}</td>
        <td>${l.uniqueTracking}</td>
        <td>${l.totalParts}</td>
        <td>${l.multiPartBoxes}</td>
        <td><button class="btn danger" data-remove-log="${l.id}">Remove</button></td>
      `;
      tbody.appendChild(tr);
    }
  }

  function addLogSnapshot() {
    const m = computeAll();
    const logs = loadLogs();
    logs.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2),
      when: nowIso(),
      trackingRows: m.trackingRowsCount,
      uniqueTracking: m.uniqueTracking,
      totalParts: m.totalParts,
      multiPartBoxes: m.multiPartBoxes,
    });
    saveLogs(logs);
    renderLogsTable();
    STATUS.textContent = "Saved snapshot to Logs (site-only).";
  }

  // ---------- Export Modal (fix: never blocks clicks when hidden) ----------
  function openModal() {
    $("#confirmSnapshot").checked = false;
    $("#modalBackdrop").classList.remove("hidden");
    $("#exportModal").classList.remove("hidden");
    $("#modalBackdrop").setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    $("#modalBackdrop").classList.add("hidden");
    $("#exportModal").classList.add("hidden");
    $("#modalBackdrop").setAttribute("aria-hidden", "true");
    $("#confirmSnapshot").checked = false;
  }

  function initModal() {
    $("#exportSummaryBtn").addEventListener("click", () => {
      renderAll(); // refresh preview numbers first
      openModal();
    });

    $("#cancelExportBtn").addEventListener("click", closeModal);
    $("#closeModalX").addEventListener("click", closeModal);

    // backdrop click closes
    $("#modalBackdrop").addEventListener("click", closeModal);

    // ESC closes
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#exportModal").classList.contains("hidden")) {
        closeModal();
      }
    });
  }

  function requireConfirmed() {
    if (!$("#confirmSnapshot").checked) {
      alert("Please confirm the snapshot checkbox before exporting.");
      return false;
    }
    return true;
  }

  // ---------- Export: Excel ----------
  async function exportExcel() {
    if (!requireConfirmed()) return;

    const m = computeAll();

    const wb = new ExcelJS.Workbook();
    wb.creator = "RRPD Receiving V2";

    // Dashboard sheet
    const s1 = wb.addWorksheet("Dashboard");
    s1.addRow(["Metric", "Value"]);
    s1.addRow(["Tracking Rows (Return Label/Packing Slip)", m.trackingRowsCount]);
    s1.addRow(["Unique Tracking Numbers", m.uniqueTracking]);
    s1.addRow(["Total Parts (pieces)", m.totalParts]);
    s1.addRow(["Multi-Part Boxes", m.multiPartBoxes]);
    s1.addRow([]);
    s1.addRow(["Carrier", "Tracking Rows"]);
    for (const k of ["FedEx", "UPS", "USPS", "Other"]) s1.addRow([k, m.carrierCounts[k] ?? 0]);

    // Repeated tracking sheet
    const s2 = wb.addWorksheet("Repeated Tracking");
    s2.addRow(["Tracking", "Scans", "Carrier"]);
    m.repeated.slice(0, 500).forEach(r => s2.addRow([r.tracking, r.scans, r.carrier]));

    // Returns condition sheet (parts only)
    const s3 = wb.addWorksheet("Returns Condition");
    s3.addRow(["Status/Condition", "Pieces"]);
    m.conditionRows.forEach(r => s3.addRow([r.status, r.pieces]));

    // Manual counts (these DO export)
    const s4 = wb.addWorksheet("Manual Counts");
    s4.addRow(["When", "Box/Tracking", "Label", "Pieces"]);
    state.manualCounts.forEach(x => s4.addRow([fmtWhen(x.when), x.box, x.label, x.qty]));

    // Manifest (exports)
    const s5 = wb.addWorksheet("Manifest");
    if (state.manifest.headers.length) {
      s5.addRow(state.manifest.headers);
      state.manifest.rows.forEach(r => s5.addRow(r));
    } else {
      s5.addRow(["No manifest loaded"]);
    }

    // Loose parts (exports)
    const s6 = wb.addWorksheet("Loose Parts");
    s6.addRow(["Tracking", "Part", "Qty", "Status", "Classification"]);
    m.looseParts.slice(0, 2000).forEach(r => {
      s6.addRow([r.tracking || "", r.part, r.qty, r.status, r.classification]);
    });

    // IMPORTANT: Logs are NOT exported

    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), safeFilename("RRPD_Summary", "xlsx"));
    STATUS.textContent = "Excel exported.";
    closeModal();
  }

  // ---------- Export: PDF ----------
  function exportPdf() {
    if (!requireConfirmed()) return;

    const m = computeAll();
    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

    doc.setFontSize(16);
    doc.text("RRPD Receiving Summary", 40, 50);

    doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 70);

    doc.autoTable({
      startY: 90,
      head: [["Metric", "Value"]],
      body: [
        ["Tracking Rows (Return Label/Packing Slip)", String(m.trackingRowsCount)],
        ["Unique Tracking Numbers", String(m.uniqueTracking)],
        ["Total Parts (pieces)", String(m.totalParts)],
        ["Multi-Part Boxes", String(m.multiPartBoxes)],
      ],
      theme: "grid",
      styles: { fontSize: 10 },
      headStyles: { fillColor: [25, 40, 70] }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 18,
      head: [["Carrier", "Tracking Rows"]],
      body: ["FedEx", "UPS", "USPS", "Other"].map(k => [k, String(m.carrierCounts[k] ?? 0)]),
      theme: "grid",
      styles: { fontSize: 10 },
      headStyles: { fillColor: [25, 40, 70] }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 18,
      head: [["Repeated Tracking (Top)", "Scans", "Carrier"]],
      body: m.repeated.slice(0, 25).map(r => [r.tracking, String(r.scans), r.carrier]),
      theme: "grid",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [25, 40, 70] }
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 18,
      head: [["Returns Condition (Parts Only)", "Pieces"]],
      body: m.conditionRows.slice(0, 30).map(r => [r.status, String(r.pieces)]),
      theme: "grid",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [25, 40, 70] }
    });

    // Manual counts (exports)
    if (state.manualCounts.length) {
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 18,
        head: [["Manual Counts", "Box/Tracking", "Label", "Pieces"]],
        body: state.manualCounts.map(x => [fmtWhen(x.when), x.box || "", x.label, String(x.qty)]),
        theme: "grid",
        styles: { fontSize: 9 },
        headStyles: { fillColor: [25, 40, 70] }
      });
    }

    // Manifest (exports - only if small-ish)
    if (state.manifest.headers.length && state.manifest.rows.length) {
      const maxCols = Math.min(state.manifest.headers.length, 8);
      const head = [state.manifest.headers.slice(0, maxCols)];
      const body = state.manifest.rows.slice(0, 25).map(r => r.slice(0, maxCols));
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 18,
        head,
        body,
        theme: "grid",
        styles: { fontSize: 8 },
        headStyles: { fillColor: [25, 40, 70] }
      });
      doc.setFontSize(9);
      doc.text("(Manifest preview limited in PDF. Full manifest is in Excel.)", 40, doc.lastAutoTable.finalY + 14);
    }

    doc.save(safeFilename("RRPD_Summary", "pdf"));
    STATUS.textContent = "PDF exported.";
    closeModal();
  }

  // ---------- Manifest Export (CSV passthrough) ----------
  function exportManifestCsv() {
    if (!state.manifest.headers.length) {
      alert("No manifest loaded.");
      return;
    }
    const rows = [state.manifest.headers, ...state.manifest.rows];
    const csv = Papa.unparse(rows);
    saveAs(new Blob([csv], { type: "text/csv;charset=utf-8" }), safeFilename("Manifest", "csv"));
    STATUS.textContent = "Manifest CSV exported.";
  }

  // ---------- Manual Counts ----------
  function initManualCounts() {
    $("#addManualBtn").addEventListener("click", () => {
      const box = normStr($("#manualBoxId").value);
      const label = normStr($("#manualLabel").value);
      const qty = parseInt($("#manualQty").value, 10);

      if (!label) return alert("Please enter a label.");
      if (!Number.isFinite(qty) || qty <= 0) return alert("Please enter a valid pieces number.");

      state.manualCounts.unshift({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2),
        when: nowIso(),
        box,
        label,
        qty
      });

      $("#manualBoxId").value = "";
      $("#manualLabel").value = "";
      $("#manualQty").value = "";

      renderManual();
      STATUS.textContent = "Manual count added.";
    });

    $("#manualTable").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-manual]");
      if (!btn) return;
      const id = btn.getAttribute("data-remove-manual");
      state.manualCounts = state.manualCounts.filter(x => x.id !== id);
      renderManual();
      STATUS.textContent = "Manual count removed.";
    });
  }

  // ---------- Init ----------
  function initEvents() {
    $("#whCsvInput").addEventListener("change", (e) => loadWhCsv(e.target.files?.[0]));
    $("#manifestCsvInput").addEventListener("change", (e) => loadManifestCsv(e.target.files?.[0]));

    $("#saveShows").addEventListener?.("click", () => {}); // (safe noop if older HTML)

    $("#saveLogsBtn").addEventListener("click", () => {
      addLogSnapshot();
      renderLogsTable();
    });

    $("#clearLogsBtn").addEventListener("click", () => {
      if (!confirm("Clear all logs?")) return;
      saveLogs([]);
      renderLogsTable();
      STATUS.textContent = "Logs cleared.";
    });

    $("#logsTable").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-log]");
      if (!btn) return;
      const id = btn.getAttribute("data-remove-log");
      const logs = loadLogs().filter(x => x.id !== id);
      saveLogs(logs);
      renderLogsTable();
      STATUS.textContent = "Log removed.";
    });

    $("#exportPdfBtn").addEventListener("click", exportPdf);
    $("#exportExcelBtn").addEventListener("click", exportExcel);

    $("#exportManifestBtn").addEventListener("click", exportManifestCsv);
    $("#clearManifestBtn").addEventListener("click", () => {
      if (!confirm("Clear manifest?")) return;
      state.manifest.headers = [];
      state.manifest.rows = [];
      renderManifest();
      STATUS.textContent = "Manifest cleared.";
    });
  }

  function init() {
    initTabs();
    initModal();
    initManualCounts();
    initEvents();
    renderAll();
    renderLogsTable();

    // If assets fail to load (like logo), do not break app:
    window.addEventListener("error", (e) => {
      // Keep this quiet, but still show in console
      console.warn("Asset/script error:", e?.message || e);
    });
  }

  // Run after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
