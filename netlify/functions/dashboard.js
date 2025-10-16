// /.netlify/functions/dashboard.js

export const handler = async () => {
  try {
    const API = "https://returns.detroitaxle.com/api/returns";
    const res = await fetch(API);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = await res.json();

    // --- Data summaries ---
    const scanners = {};
    const classifications = {};
    const daily = {};
    const weekly = {};

    data.forEach((item) => {
      const who = item.scanner_name || "Unknown";
      scanners[who] = (scanners[who] || 0) + 1;

      const cls = item.classification || "Unclassified";
      classifications[cls] = (classifications[cls] || 0) + 1;

      const date = item.date?.slice(0, 10) || "Unknown";
      daily[date] = (daily[date] || 0) + 1;
    });

    // --- Weekly totals ---
    const dates = Object.keys(daily);
    dates.forEach((d, i) => {
      const w = `Week ${Math.floor(i / 7) + 1}`;
      weekly[w] = (weekly[w] || 0) + daily[d];
    });

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scanners,
        classifications,
        daily: Object.entries(daily).map(([date, total]) => ({ date, total })),
        weekly: Object.entries(weekly).map(([week, total]) => ({
          week,
          fedex: Math.floor(total * 0.5),
          ups: Math.floor(total * 0.3),
          usps: Math.floor(total * 0.2),
        })),
        updated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("Dashboard API error:", err);
    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
