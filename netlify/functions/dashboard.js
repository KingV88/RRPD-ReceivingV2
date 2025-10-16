import * as fetchModule from "node-fetch";
const fetch = fetchModule.default || fetchModule;

// Safe fetch with timeout
async function safeFetch(url, ms = 15000) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Helper to extract quantity multiplier from part number
function extractQty(partNum = "") {
  // Match patterns like "x2", "2x", "X4", "x10", etc.
  const match = partNum.match(/(?:x\s*|X\s*|)(\d+)(?:x|X)?$/);
  if (!match) return 1;
  const qty = parseInt(match[1], 10);
  return isNaN(qty) ? 1 : qty;
}

export const handler = async () => {
  const API = "https://returns.detroitaxle.com/api/returns";

  try {
    const res = await safeFetch(API);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const arr = await res.json();

    const scanners = {};
    const classifications = {};
    const missed = [];

    for (const r of arr) {
      const who = (r.createdBy || r.scanned_by || "Unknown").trim();
      const cls = (r.description || r.classification || "Unclassified").trim();
      const part = (r.partNumber || r.part_number || "").trim();

      // Extract quantity multiplier (e.g. x2, 2x, x4, etc.)
      const qty = extractQty(part);

      // Add to scanner totals
      scanners[who] = (scanners[who] || 0) + qty;

      // Add to classification totals
      const key = cls.toLowerCase();
      if (["good", "used", "core", "damaged", "return label"].some(k => key.includes(k))) {
        classifications[key] = (classifications[key] || 0) + qty;
      } else {
        missed.push({ part, cls });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        scanners,
        classifications,
        missed,
        updated: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error("Dashboard API error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message
      })
    };
  }
};
