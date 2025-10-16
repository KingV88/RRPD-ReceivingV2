/**
 * Netlify Function: /api/dashboard
 * 
 * Provides JSON data for RRPD Dashboard:
 * - Scanners
 * - Weekly summaries
 * - Classifications
 * - All-time totals
 * 
 * Pulls from live Detroit Axle Returns API if available,
 * otherwise serves mock fallback data for testing.
 */

import fetch from "node-fetch";

/* ==================== CONFIG ==================== */
// If you want to change refresh rate or fallback behavior:
const DETROIT_AXLE_API = "https://returns.detroitaxle.com/api/returns";
const DAYS_BACK = 7; // how many days of weekly data
const MOCK_SCANNERS = ["Alex", "Maria", "Jeff", "Brianna", "Terry"];

/* ================ UTILITIES ===================== */
function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function parseQty(part) {
  if (!part) return 1;
  const s = part.toLowerCase().replace(/×/g, "x").replace(/\s+/g, "");
  const m = s.match(/(?:x(\d+)|(\d+)x)/);
  if (m) return Number(m[1] || m[2] || 1);
  return 1;
}

/* ================ MAIN HANDLER ================== */
export async function handler() {
  try {
    let rawData = [];
    try {
      const res = await fetch(DETROIT_AXLE_API, { timeout: 10000 });
      if (!res.ok) throw new Error("Detroit Axle API unavailable");
      const json = await res.json();
      if (Array.isArray(json)) rawData = json;
      else if (json.data && Array.isArray(json.data)) rawData = json.data;
    } catch (err) {
      console.warn("⚠️ Using mock data (API offline)", err.message);
      // Generate mock data for 7 days
      const today = new Date();
      for (let i = 0; i < 60; i++) {
        const day = new Date(today);
        day.setDate(today.getDate() - Math.floor(Math.random() * 7));
        rawData.push({
          scanner: MOCK_SCANNERS[Math.floor(Math.random() * MOCK_SCANNERS.length)],
          classification: ["Good", "Used", "Core", "Damaged", "Return Label", "Not Our Part"][Math.floor(Math.random() * 6)],
          part_number: "PN" + Math.floor(Math.random() * 1000000),
          created_at: day.toISOString(),
          qty: Math.ceil(Math.random() * 3)
        });
      }
    }

    // 🔹 Normalize records
    const records = rawData.map(r => ({
      scanner: r.scanner || r.user || "Unknown",
      classification: r.classification || r.status || "Good",
      part: r.part_number || r.part || r.tracking || "",
      created_at: r.created_at || r.date || new Date().toISOString(),
      qty: parseQty(r.part_number || "") || 1
    }));

    // 🔹 Scanners totals (today)
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRecords = records.filter(r => (r.created_at || "").startsWith(todayStr));
    const scanners = {};
    for (const r of todayRecords) {
      scanners[r.scanner] = (scanners[r.scanner] || 0) + (r.qty || 1);
    }

    // 🔹 Weekly totals (by scanner, per day)
    const weekly = { labels: [], seriesByName: {} };
    const days = [];
    for (let i = DAYS_BACK - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    weekly.labels = days;
    for (const name of new Set(records.map(r => r.scanner))) {
      weekly.seriesByName[name] = days.map(day => {
        const recs = records.filter(r => (r.created_at || "").startsWith(day) && r.scanner === name);
        return recs.reduce((s, x) => s + (x.qty || 1), 0);
      });
    }

    // 🔹 Classifications
    const classifications = {
      today: todayRecords.map(r => ({
        scanner: r.scanner,
        class: r.classification,
        part: r.part,
        qty: r.qty,
        time: r.created_at
      })),
      monthly: records
        .filter(r => {
          const dt = new Date(r.created_at);
          const now = new Date();
          return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
        })
        .map(r => ({
          date: r.created_at,
          class: r.classification,
          qty: r.qty
        }))
    };

    // 🔹 All-time totals (per scanner)
    const allTime = {};
    for (const r of records) {
      allTime[r.scanner] = (allTime[r.scanner] || 0) + (r.qty || 1);
    }

    // 🔹 Final response
    const payload = {
      updated: new Date().toISOString(),
      scanners,
      weekly,
      classifications,
      allTime
    };

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    };
  } catch (err) {
    console.error("❌ Dashboard function failed", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message })
    };
  }
}
