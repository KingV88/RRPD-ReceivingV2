/* RRPD Receiving Dashboard — robust + matches your full index.html IDs
   Uses WH CSV columns:
   - Tracking number (Track Num / Tracking / Tracking Number)
   - Part number   (Part Num / Part Number / Deposo PN)
   - PN Description (condition + label markers)

   Label scan rows: PN Description == Return Label / Packing Slip (case-insensitive, trimmed)
   Part rows: everything else
*/

(() => {
  "use strict";

  // ----------------------------
  // Helpers
  // ----------------------------
  const $ = (id) => document.getElementById(id);

  function on(id, evt, fn) {
    const el = $(id);
    if (!el) return;
    el.addEventListener(evt, fn);
  }

  function asString(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  function safeLower(v) {
    return asString(v).toLowerCase();
  }

  function setText(id, v) {
    const el = $(id);
    if (el) el.textContent = String(v);
  }

  function pickField(row, keys) {
    // exact keys first
    for (const k of keys) {
      if (row && Object.prototype.hasOwnProperty.call(row, k)) {
        const v = asString(row[k]);
        if (v) return v;
      }
    }
    // case-insensitive fallback
    const rowKeys = Object.keys(row || {});
    const lowerMap = new Map(rowKeys.map(k => [k.toLowerCase(), k]));
    for (const want of keys) {
      const found = lowerMap.get(want.toLowerCase());
      if (found) {
        const v = asString(row[found]);
        if (v) return v;
      }
    }
    return "";
  }

  // Excel scientific notation string → plain digits (string math, no Number())
  function sciToPlainString(raw) {
    const s = asString(raw);
    if (!s) return "";
    const m = s.match(/^([0-9]+)(?:\.([0-9]+))?[eE]\+?([0-9]+)$/);
    if (!m) return s;

    const intPart = m[1];
    const fracPart = m[2] || "";
    const exp = parseInt(m[3], 10);
    if (!Number.isFinite(exp)) return s;

    const digits = intPart + fracPart;
    const decimalPlaces = fracPart.length;
    const shift = exp - decimalPlaces;

    if (shift >= 0) return digits + "0".repeat(shift);
    return s; // don’t produce decimals for IDs
  }

  function normalizeTracking(t) {
    const x = sciToPlainString(t);
    return asString(x).replace(/\s+/g, "");
  }

  // Stronger label detection without accidentally matching real conditions.
  // Accepts:
  // - "Return Label"
  // - "Packing Slip"
  // - "Return Label Scan"
  // - "Packing Slip Scan"
function isLabelType(descRaw) {
  const d = safeLower(descRaw)
    .replace(/\s+/g, " ")
    .replace(/[^a-z\s]/g, "")
    .trim();

  if (!d) return false;

  // flexible match
  if (d.includes("return label")) return true;
  if (d.includes("packing slip")) return true;

  return false;
}

  function parseIntSafe(v) {
    const s = asString(v);
    if (!s) return 0;
    const n = parseInt(s.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // Qty parsing: use Qty column if exists, else allow "x2" / "2x" on part number
  function parseQtyFromPart(partRaw) {
    const cap = 50;
    let s = asString(partRaw);
    if (!s) return { part: "", qty: 1 };

    s = s.replace(/\s+/g, " ").trim();

    let qty = 1;
    const m1 = s.match(/(?:^|[\s\-])x\s*(\d{1,3})\s*$/i);
    const m2 = s.match(/(?:^|[\s\-])(\d{1,3})\s*x\s*$/i);

    const found = m1?.[1] || m2?.[1] || null;
    if (found) {
      const n = parseInt(found, 10);
      if (Number.isFinite(n) && n > 0) qty = Math.min(n, cap);
      s = s
        .replace(/(?:^|[\s\-])x\s*\d{1,3}\s*$/i, "")
        .replace(/(?:^|[\s\-])\d{1,3}\s*x\s*$/i, "")
        .trim();
    }

    // handle stuck: "68331804x2"
    const stuck = s.match(/^(.*?)(?:x)(\d{1,3})$/i);
    if (stuck) {
      const n = parseInt(stuck[2], 10);
      if (Number.isFinite(n) && n > 0) qty = Math.min(n, cap);
      s = stuck[1].trim();
    }

    return { part: sciToPlainString(s) || s, qty };
  }

  function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }

  // ----------------------------
  // State
  // ----------------------------
  const state = {
    whRows: [],
    labelScans: [],  // { tracking, type }
    partRows: [],    // { tracking, part, qty, condition }

    manualCounts: [], // { item, qty, condition }
    looseParts: [],   // { part, qty, condition }

    carriers: { FedEx: 0, UPS: 0, USPS: 0, Other: 0 },

    manifestRows: [],
    manifestTracking: [],

    logs: [],

    returnsChart: null,
    manualChart: null,
    carrierChart: null
  };

  // ----------------------------
  // Compute WH from CSV
  // ----------------------------
  function computeFromWH(rows) {
    state.labelScans = [];
    state.partRows = [];

    const trackingKeys = ["Track Num","Tracking","Tracking Number","TrackingNumber","Return Tracking"];
    const partKeys = ["Part Num","Part Number","PN","Deposo PN","DeposoPN"];
    const descKeys = ["PN Description","PNDescription","Description","Part Description"];
    const qtyKeys = ["Qty","Quantity","Pieces"];

    // small debug: show headers it saw
    if (rows?.[0]) {
      console.log("[RRPD] WH headers:", Object.keys(rows[0] || {}));
    }

    for (const row of rows) {
      const trackingRaw = pickField(row, trackingKeys);
      const partRaw = pickField(row, partKeys);
      const descRaw = pickField(row, descKeys);

      const tracking = normalizeTracking(trackingRaw);
      const pnDesc = asString(descRaw);

      // LABEL ROW
      if (isLabelType(pnDesc)) {
        if (tracking) state.labelScans.push({ tracking, type: pnDesc.trim() });
        continue;
      }

      // PART ROW
      const qtyCol = parseIntSafe(pickField(row, qtyKeys));
      const parsed = parseQtyFromPart(partRaw);
      const qty = qtyCol > 0 ? Math.min(qtyCol, 50) : (parsed.qty || 1);

      const part = sciToPlainString(parsed.part || partRaw || "") || "(blank)";
      const condition = pnDesc || "(blank)";

      state.partRows.push({ tracking, part, qty, condition });
    }
  }

  function whPackagesCount() {
    return state.labelScans.length; // NOT unique
  }

  function whPartsPieces() {
    return state.partRows.reduce((a, x) => a + (x.qty || 0), 0);
  }

  // ----------------------------
  // Returns Condition (WH parts)
  // ----------------------------
  function computeReturnsCondition() {
    const map = new Map(); // condition -> {rows, pieces}
    for (const p of state.partRows) {
      const key = asString(p.condition) || "(blank)";
      if (!map.has(key)) map.set(key, { rows: 0, pieces: 0 });
      const obj = map.get(key);
      obj.rows += 1;
      obj.pieces += (p.qty || 1);
    }
    return Array.from(map.entries()).sort((a,b) => b[1].pieces - a[1].pieces);
  }

  // ----------------------------
  // Manifest Compare
  // ----------------------------
  function computeManifestCompare() {
    const scannedSet = new Set(state.labelScans.map(x => x.tracking).filter(Boolean));
    const manifestSet = new Set(state.manifestTracking.filter(Boolean));

    const missing = [];
    for (const t of manifestSet) if (!scannedSet.has(t)) missing.push(t);

    const extra = [];
    for (const t of scannedSet) if (!manifestSet.has(t)) extra.push(t);

    missing.sort();
    extra.sort();

    return {
      manifestTotal: manifestSet.size,
      matched: Math.max(0, manifestSet.size - missing.length),
      missing,
      extra
    };
  }

  // ----------------------------
  // Charts (safe guards)
  // ----------------------------
  function chartSafeCreate(existing, canvasId, config) {
    const canvas = $(canvasId);
    if (!canvas || !window.Chart) return existing;
    try {
      if (existing) return existing;
      return new Chart(canvas, config);
    } catch (e) {
      console.warn("[RRPD] Chart error:", e);
      return existing;
    }
  }

  function updateReturnsChart(pairs) {
    const top = pairs.slice(0, 10);
    const labels = top.map(x => x[0]);
    const data = top.map(x => x[1].pieces);

    if (state.returnsChart) {
      state.returnsChart.data.labels = labels;
      state.returnsChart.data.datasets[0].data = data;
      state.returnsChart.update();
      return;
    }

    state.returnsChart = chartSafeCreate(state.returnsChart, "returnsChart", {
      type: "bar",
      data: { labels, datasets: [{ label: "Pieces", data }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  function updateManualChart() {
    const map = new Map(); // condition -> qty
    for (const m of state.manualCounts) {
      const k = asString(m.condition) || "(blank)";
      map.set(k, (map.get(k) || 0) + (m.qty || 0));
    }
    const pairs = Array.from(map.entries()).sort((a,b) => b[1] - a[1]).slice(0, 10);

    const labels = pairs.map(x => x[0]);
    const data = pairs.map(x => x[1]);

    if (state.manualChart) {
      state.manualChart.data.labels = labels;
      state.manualChart.data.datasets[0].data = data;
      state.manualChart.update();
      return;
    }

    state.manualChart = chartSafeCreate(state.manualChart, "manualChart", {
      type: "bar",
      data: { labels, datasets: [{ label: "Qty", data }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  function updateCarrierChart() {
    const labels = ["FedEx","UPS","USPS","Other"];
    const data = labels.map(k => state.carriers[k] || 0);

    if (state.carrierChart) {
      state.carrierChart.data.labels = labels;
      state.carrierChart.data.datasets[0].data = data;
      state.carrierChart.update();
      return;
    }

    state.carrierChart = chartSafeCreate(state.carrierChart, "carrierChart", {
      type: "bar",
      data: { labels, datasets: [{ label: "Count", data }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  // ----------------------------
  // Render
  // ----------------------------
  function renderDashboard() {
    setText("mPackages", whPackagesCount());
    setText("mParts", whPartsPieces());

    const tbody = $("tblTrackingSamples")?.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = "";
      const latest = state.labelScans.slice(-25).reverse();
      latest.forEach((x, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${i+1}</td><td>${x.tracking}</td><td>${x.type}</td>`;
        tbody.appendChild(tr);
      });
    }
  }

  function renderReturns() {
    const pairs = computeReturnsCondition();
    const tbody = $("tblReturns")?.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = "";
      pairs.forEach(([cond, v]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${cond}</td><td>${v.rows}</td><td>${v.pieces}</td>`;
        tbody.appendChild(tr);
      });
    }
    updateReturnsChart(pairs);
  }

  function renderManualTable() {
    const tbody = $("tblManual")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    state.manualCounts.forEach((m, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.item}</td>
        <td>${m.qty}</td>
        <td>${m.condition}</td>
        <td><button class="btn danger" data-del="${idx}" type="button">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderLooseTable() {
    const tbody = $("tblLoose")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    state.looseParts.forEach((m, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.part}</td>
        <td>${m.qty}</td>
        <td>${m.condition}</td>
        <td><button class="btn danger" data-del="${idx}" type="button">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCarriersTable() {
    const tbody = $("tblCarriers")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    ["FedEx","UPS","USPS","Other"].forEach(k => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${k}</td><td>${state.carriers[k] || 0}</td>`;
      tbody.appendChild(tr);
    });

    updateCarrierChart();
  }

  function renderManifest() {
    const out = computeManifestCompare();

    setText("mManifestTotal", out.manifestTotal);
    setText("mManifestMatched", out.matched);
    setText("mManifestMissing", out.missing.length);

    const missBody = $("tblMissing")?.querySelector("tbody");
    if (missBody) {
      missBody.innerHTML = "";
      out.missing.slice(0, 5000).forEach((t, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${i+1}</td><td>${t}</td>`;
        missBody.appendChild(tr);
      });
    }

    const extraBody = $("tblExtra")?.querySelector("tbody");
    if (extraBody) {
      extraBody.innerHTML = "";
      out.extra.slice(0, 5000).forEach((t, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${i+1}</td><td>${t}</td>`;
        extraBody.appendChild(tr);
      });
    }

    setText("pManifestMissing", out.missing.length);
  }

  function manualTotalQty() {
    return state.manualCounts.reduce((a, x) => a + (x.qty || 0), 0);
  }

  function renderStatusLine() {
    const status = $("statusLine");
    if (!status) return;

    const msg =
      state.whRows.length === 0
        ? "No WH CSV loaded."
        : `Loaded ${state.whRows.length} WH rows. Packages (label scans): ${whPackagesCount()}. Parts (pieces): ${whPartsPieces()}. Manual qty: ${manualTotalQty()}.`;

    status.textContent = msg;

    setText("pPackages", whPackagesCount());
    setText("pParts", whPartsPieces());
    setText("pManualQty", manualTotalQty());
  }

  function renderAll() {
    renderDashboard();
    renderReturns();
    renderManualTable();
    renderLooseTable();
    renderCarriersTable();
    renderManifest();
    updateManualChart();
    renderStatusLine();
    renderLogsTable();
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
  // Modal: View All Tracking (with fallback)
  // ----------------------------
  function showTrackingModalOrDownload() {
    // If modal exists, show it
    const backdrop = $("modalBackdrop");
    const modal = $("modalTracking");
    const body = $("tblAllTracking")?.querySelector("tbody");

    if (backdrop && modal && body) {
      backdrop.classList.remove("hidden");
      modal.classList.remove("hidden");

      body.innerHTML = "";
      state.labelScans.forEach((x, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${i+1}</td><td>${x.tracking}</td><td>${x.type}</td>`;
        body.appendChild(tr);
      });
      return;
    }

    // Fallback: download CSV
    const lines = ["#,tracking,type"];
    state.labelScans.forEach((x, i) => {
      lines.push(`${i+1},${x.tracking},"${String(x.type || "").replace(/"/g,'""')}"`);
    });
    downloadText(`rrpd_all_label_scans_${new Date().toISOString().slice(0,10)}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  }

  function hideTrackingModal() {
    $("modalBackdrop")?.classList.add("hidden");
    $("modalTracking")?.classList.add("hidden");
  }

  // ----------------------------
  // Modal: Export
  // ----------------------------
  function showExportModal() {
    const chk = $("chkConfirm");
    if (chk) chk.checked = false;
    $("exportBackdrop")?.classList.remove("hidden");
    $("exportModal")?.classList.remove("hidden");
  }

  function hideExportModal() {
    $("exportBackdrop")?.classList.add("hidden");
    $("exportModal")?.classList.add("hidden");
  }

  function requireConfirm() {
    const chk = $("chkConfirm");
    if (!chk || !chk.checked) {
      alert("Please check: 'I confirm this snapshot is correct.'");
      return false;
    }
    return true;
  }

  // ----------------------------
  // CSV Upload: WH
  // ----------------------------
  function bindWHUpload() {
    const input = $("whFile");
    if (!input) return;

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      if (!window.Papa) {
        alert("PapaParse failed to load (internet issue). Refresh and try again.");
        return;
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          state.whRows = Array.isArray(res.data) ? res.data : [];
          computeFromWH(state.whRows);
          renderAll();
        },
        error: (err) => {
          console.error("WH CSV parse error:", err);
          alert("WH CSV parse error. Check the file format.");
        }
      });
    });
  }

  // ----------------------------
  // CSV Upload: Manifest
  // ----------------------------
  function bindManifestUpload() {
    const input = $("manifestFile");
    if (!input) return;

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      if (!window.Papa) {
        alert("PapaParse failed to load (internet issue). Refresh and try again.");
        return;
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          state.manifestRows = Array.isArray(res.data) ? res.data : [];

          const keys = ["Tracking","Tracking Number","TrackingNumber","Track Num","TrackNum","Shipment Tracking Number"];
          const list = [];

          for (const row of state.manifestRows) {
            let t = pickField(row, keys);

            if (!t) {
              const values = Object.values(row || {}).map(asString).filter(Boolean);
              t = values.find(v =>
                /^1Z/i.test(v) ||
                /^\d{12,22}$/.test(v) ||
                /^[0-9]+(\.[0-9]+)?e\+?[0-9]+$/i.test(v)
              ) || "";
            }

            const nt = normalizeTracking(t);
            if (nt) list.push(nt);
          }

          state.manifestTracking = list;
          renderAll();
        },
        error: (err) => {
          console.error("Manifest CSV parse error:", err);
          alert("Manifest CSV parse error. Check the file format.");
        }
      });
    });

    on("btnManifestClear", "click", () => {
      state.manifestRows = [];
      state.manifestTracking = [];
      if ($("manifestFile")) $("manifestFile").value = "";
      renderAll();
    });
  }

  // ----------------------------
  // Manual Counts
  // ----------------------------
  function bindManualCounts() {
    on("btnManualAdd", "click", () => {
      const item = asString($("manItem")?.value);
      const qty = parseIntSafe($("manQty")?.value);
      const condition = asString($("manCondition")?.value);

      if (!item) return alert("Enter an item (ex: Racks / Axles / Gearboxes).");
      if (!qty || qty <= 0) return alert("Enter a valid qty.");
      if (!condition) return alert("Enter a condition (ex: Good / Damaged / Not Our Part).");

      state.manualCounts.unshift({ item, qty, condition });
      if ($("manItem")) $("manItem").value = "";
      if ($("manQty")) $("manQty").value = "";
      if ($("manCondition")) $("manCondition").value = "";
      renderAll();
    });

    on("btnManualClear", "click", () => {
      if ($("manItem")) $("manItem").value = "";
      if ($("manQty")) $("manQty").value = "";
      if ($("manCondition")) $("manCondition").value = "";
    });

    // delete delegation (bind once)
    const tbody = $("tblManual")?.querySelector("tbody");
    if (tbody) {
      tbody.addEventListener("click", (e) => {
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
  // Loose Parts (manual)
  // ----------------------------
  function bindLooseParts() {
    on("btnLooseAdd", "click", () => {
      const part = asString($("loosePart")?.value);
      const qty = parseIntSafe($("looseQty")?.value);
      const condition = asString($("looseCondition")?.value);

      if (!part) return alert("Enter a part.");
      if (!qty || qty <= 0) return alert("Enter a valid qty.");
      if (!condition) return alert("Enter a condition.");

      state.looseParts.unshift({ part: sciToPlainString(part) || part, qty, condition });
      if ($("loosePart")) $("loosePart").value = "";
      if ($("looseQty")) $("looseQty").value = "";
      if ($("looseCondition")) $("looseCondition").value = "";
      renderAll();
    });

    on("btnLooseClear", "click", () => {
      if ($("loosePart")) $("loosePart").value = "";
      if ($("looseQty")) $("looseQty").value = "";
      if ($("looseCondition")) $("looseCondition").value = "";
    });

    // delete delegation (bind once)
    const tbody = $("tblLoose")?.querySelector("tbody");
    if (tbody) {
      tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-del]");
        if (!btn) return;
        const i = parseInt(btn.dataset.del, 10);
        if (!Number.isFinite(i)) return;
        state.looseParts.splice(i, 1);
        renderAll();
      });
    }
  }

  // ----------------------------
  // Carriers (manual totals)
  // ----------------------------
  function bindCarriers() {
    on("btnCarriersApply", "click", () => {
      state.carriers.FedEx = parseIntSafe($("carFedEx")?.value);
      state.carriers.UPS   = parseIntSafe($("carUPS")?.value);
      state.carriers.USPS  = parseIntSafe($("carUSPS")?.value);
      state.carriers.Other = parseIntSafe($("carOther")?.value);
      renderAll();
    });

    on("btnCarriersClear", "click", () => {
      state.carriers = { FedEx: 0, UPS: 0, USPS: 0, Other: 0 };
      if ($("carFedEx")) $("carFedEx").value = "";
      if ($("carUPS")) $("carUPS").value = "";
      if ($("carUSPS")) $("carUSPS").value = "";
      if ($("carOther")) $("carOther").value = "";
      renderAll();
    });
  }

  // ----------------------------
  // Logs
  // ----------------------------
  const LOG_KEY = "rrpd_logs_v4";

  function loadLogs() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveLogs() {
    localStorage.setItem(LOG_KEY, JSON.stringify(state.logs));
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
        <td>${l.packages}</td>
        <td>${l.parts}</td>
        <td>${l.manualQty}</td>
        <td><button class="btn danger" data-del="${idx}" type="button">Delete</button></td>
      `;
      body.appendChild(tr);
    });
  }

  function bindLogs() {
    state.logs = loadLogs();
    renderLogsTable();

    on("btnLogAdd", "click", () => {
      state.logs.unshift({
        when: new Date().toLocaleString(),
        note: asString($("logNote")?.value),
        packages: whPackagesCount(),
        parts: whPartsPieces(),
        manualQty: manualTotalQty()
      });
      saveLogs();
      renderAll();
    });

    on("btnLogExport", "click", () => {
      if (!window.saveAs) {
        alert("FileSaver (saveAs) failed to load. Refresh and try again.");
        return;
      }
      const header = ["when","note","packages","parts","manualQty"];
      const lines = [header.join(",")];
      for (const l of state.logs) {
        lines.push([
          l.when,
          `"${(l.note || "").replace(/"/g, '""')}"`,
          l.packages,
          l.parts,
          l.manualQty
        ].join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
      saveAs(blob, `rrpd_logs_${new Date().toISOString().slice(0,10)}.csv`);
    });

    on("btnLogClearAll", "click", () => {
      if (!confirm("Delete all logs?")) return;
      state.logs = [];
      saveLogs();
      renderAll();
    });

    // delete delegation (bind once)
    const body = $("tblLogs")?.querySelector("tbody");
    if (body) {
      body.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-del]");
        if (!btn) return;
        const i = parseInt(btn.dataset.del, 10);
        if (!Number.isFinite(i)) return;
        state.logs.splice(i, 1);
        saveLogs();
        renderAll();
      });
    }
  }

  // ----------------------------
  // Export Summary (PDF / Excel)
  // ----------------------------
  function bindExport() {
    on("btnExportSummary", "click", showExportModal);

    on("btnExportCancel", "click", hideExportModal);
    on("btnExportX", "click", hideExportModal);
    on("exportBackdrop", "click", hideExportModal);

    on("btnExportPDF", "click", exportPDF);
    on("btnExportExcel", "click", exportExcel);
  }

  function exportPDF() {
    if (!requireConfirm()) return;

    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("jsPDF failed to load. Refresh and try again.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

    const packages = whPackagesCount();
    const parts = whPartsPieces();
    const manQty = manualTotalQty();
    const manifestOut = computeManifestCompare();

    doc.setFontSize(16);
    doc.text("RRPD Summary", 40, 50);

    doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 70);
    doc.text(`Packages (label scans): ${packages}`, 40, 88);
    doc.text(`Parts (pieces): ${parts}`, 40, 104);
    doc.text(`Manual qty total: ${manQty}`, 40, 120);
    doc.text(`Manifest missing: ${manifestOut.missing.length}`, 40, 136);

    if (doc.autoTable) {
      const returnsPairs = computeReturnsCondition();
      doc.text("Returns Condition (WH parts)", 40, 160);
      doc.autoTable({
        startY: 170,
        head: [["Condition", "Part Rows", "Pieces"]],
        body: returnsPairs.map(([k,v]) => [k, v.rows, v.pieces]).slice(0, 40),
        styles: { fontSize: 9 }
      });
    }

    doc.save(`rrpd_summary_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  async function exportExcel() {
    if (!requireConfirm()) return;

    if (!window.ExcelJS) {
      alert("ExcelJS failed to load. Refresh and try again.");
      return;
    }
    if (!window.saveAs) {
      alert("FileSaver (saveAs) failed to load. Refresh and try again.");
      return;
    }

    const wb = new ExcelJS.Workbook();

    const ws = wb.addWorksheet("Summary");
    const packages = whPackagesCount();
    const parts = whPartsPieces();
    const manQty = manualTotalQty();
    const manifestOut = computeManifestCompare();

    ws.addRow(["RRPD Summary"]);
    ws.addRow([`Generated: ${new Date().toLocaleString()}`]);
    ws.addRow([]);
    ws.addRow(["Packages (label scans)", packages]);
    ws.addRow(["Parts (pieces)", parts]);
    ws.addRow(["Manual qty total", manQty]);
    ws.addRow(["Manifest missing", manifestOut.missing.length]);
    ws.addRow([]);

    ws.addRow(["Returns Condition"]);
    ws.addRow(["Condition", "Part Rows", "Pieces"]).font = { bold: true };
    for (const [k,v] of computeReturnsCondition()) ws.addRow([k, v.rows, v.pieces]);
    ws.columns.forEach(c => (c.width = 24));

    const ws2 = wb.addWorksheet("Manual Counts");
    ws2.addRow(["Item","Qty","Condition"]).font = { bold: true };
    for (const m of state.manualCounts) ws2.addRow([m.item, m.qty, m.condition]);
    ws2.columns.forEach(c => (c.width = 26));

    const ws3 = wb.addWorksheet("Manifest Missing");
    ws3.addRow(["Tracking"]).font = { bold: true };
    for (const t of manifestOut.missing) ws3.addRow([t]);
    ws3.columns.forEach(c => (c.width = 30));

    const buf = await wb.xlsx.writeBuffer();
    saveAs(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `rrpd_summary_${new Date().toISOString().slice(0,10)}.xlsx`
    );
  }

  // ----------------------------
  // Bind Tracking Modal
  // ----------------------------
  function bindTrackingModal() {
    on("btnViewAllTracking", "click", showTrackingModalOrDownload);
    on("btnModalX", "click", hideTrackingModal);
    on("btnModalClose", "click", hideTrackingModal);
    on("modalBackdrop", "click", hideTrackingModal);
  }

  function bindTopButtons() {
    on("btnSaveLogs", "click", () => setActiveTab("logs"));
  }

  // ----------------------------
  // Init
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    bindTabs();
    bindWHUpload();
    bindManifestUpload();
    bindManualCounts();
    bindLooseParts();
    bindCarriers();
    bindTrackingModal();
    bindLogs();
    bindExport();
    bindTopButtons();

    renderAll();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideTrackingModal();
        hideExportModal();
      }
    });
  });
})();
