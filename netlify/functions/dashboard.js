// ===== RRPD Dashboard Netlify Function =====

// Import node-fetch (v3+ ESM-compatible)
import fetch from "node-fetch";

// Helper: Timeout-safe fetch
async function safeFetch(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    console.error("Fetch error:", err.message);
    return null;
  }
}

// Helper: Parse Detroit Axle table HTML
function parseRows(html) {
  const regex = /<tr[^>]*>(.*?)<\/tr>/gis;
  const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;
  const rows = [];
  let rowMatch;
  while ((rowMatch = regex.exec(html))) {
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const text = cellMatch[1].replace(/<[^>]*>/g, "").trim();
      cells.push(text);
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// Helper: Count classifications
function summarizeClassifications(rows) {
  const summary = {
    Good: 0,
    Used: 0,
    Core: 0,
    Damaged: 0,
    Missing: 0,
    "Not Our Part": 0,
  };

  for (const r of rows) {
    const description = (r[5] || "").toLowerCase();
    if (description.includes("good")) summary.Good++;
    else if (description.includes("used")) summary.Used++;
    else if (description.includes("core")) summary.Core++;
    else if (description.includes("damaged")) summary.Damaged++;
    else if (description.includes("missing")) summary.Missing++;
    else if (description.includes("not our part")) summary["Not Our Part"]++;
  }

  return summary;
}

// Helper: Count scans per user
function summarizeScanners(rows) {
  const scanners = {};
  for (const r of rows) {
    const user = r[3] || "Unknown";
    scanners[user] = (scanners[user] || 0) + 1;
  }
  return scanners;
}

// ===== Main handler =====
export async function handler(event, context) {
  const RETURN_URL = "https://returns.detroitaxle.com/returns/reports/condition";

  try {
    // Fetch remote data
    const res = await safeFetch(RETURN_URL, { method: "GET" });
    if (!res || !res.ok) {
      console.warn("⚠️ Detroit Axle API unreachable. Returning empty dataset.");
      return jsonResponse({
        scanners: {},
        classifications: {},
        trend: [],
      });
    }

    const html = await res.text();
    const rows = parseRows(html);

    const scanners = summarizeScanners(rows);
    const classifications = summarizeClassifications(rows);

    // Build basic trend (fake for now — backend daily grouping could be added)
    const trend = Object.entries(scanners).map(([name, count]) => ({
      date: new Date().toISOString().split("T")[0],
      total: count,
      scanner: name,
    }));

    return jsonResponse({
      scanners,
      classifications,
      trend,
    });
  } catch (err) {
    console.error("❌ Dashboard Function Error:", err);
    return jsonResponse({
      scanners: {},
      classifications: {},
      trend: [],
    });
  }
}

// ===== Utility: Consistent JSON response =====
function jsonResponse(data) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}
