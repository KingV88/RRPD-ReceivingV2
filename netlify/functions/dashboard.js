import fetch from "node-fetch";

// tiny timeout helper so we never hang
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

export const handler = async () => {
  const API = "https://returns.detroitaxle.com/api/returns";
  try {
    const res = await safeFetch(API);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const arr = await res.json(); // array of returns

    // shape -> you may need to tweak field names if the API differs
    const scanners = {};
    const classifications = {};
    for (const r of arr) {
      const who = (r.createdBy || r.scanned_by || "Unknown").trim();
      const cls = (r.description || r.classification || "Unclassified").trim();
      scanners[who] = (scanners[who] || 0) + 1;
      classifications[cls] = (classifications[cls] || 0) + 1;
    }

    return json({ scanners, classifications, updated: new Date().toISOString() });
  } catch (err) {
    console.error("dashboard.js error:", err.message);
    // graceful empty payload so frontend never crashes
    return json({ scanners: {}, classifications: {}, updated: new Date().toISOString(), error: err.message });
  }
};

function json(body) {
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
