// /netlify/functions/dashboard.js
export async function handler(event, context) {
  const API_URL = "https://returns.detroitaxle.com/api/returns";
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const raw = await res.json();

    // --- Extract Scanner Counts ---
    const scanners = {};
    raw.forEach(r => {
      const s = r?.scanner?.trim() || "Unknown";
      scanners[s] = (scanners[s] || 0) + 1;
    });

    // --- Extract Classifications ---
    const classifications = {};
    raw.forEach(r => {
      const c = (r?.classification || "Unclassified").trim();
      // detect “x2”, “3x” etc
      const qtyMatch = (r?.partnumber || "").match(/x(\d+)|(\d+)x/i);
      const qty = qtyMatch ? Number(qtyMatch[1] || qtyMatch[2]) : 1;
      classifications[c] = (classifications[c] || 0) + qty;
    });

    // --- Daily Totals ---
    const totals = {};
    raw.forEach(r => {
      const d = (r?.date || r?.created_at || "").slice(0,10);
      if (!d) return;
      totals[d] = (totals[d] || 0) + 1;
    });

    // --- Weekly Totals (last 7 days) ---
    const week = {};
    const now = new Date();
    for (let i=6; i>=0; i--){
      const d = new Date(now);
      d.setDate(now.getDate()-i);
      const ds = d.toISOString().slice(0,10);
      week[ds] = totals[ds] || 0;
    }

    // --- Optional All-time per scanner ---
    const scannerAlltime = { ...scanners };

    // --- Build Response ---
    const out = {
      scanners,
      scannerAlltime,
      classifications,
      totals: { labels: Object.keys(totals), values: Object.values(totals) },
      weekly: week
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(out)
    };
  } catch (err) {
    console.error("Dashboard error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
