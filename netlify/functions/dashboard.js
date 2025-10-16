// /.netlify/functions/dashboard.js
import fetch from "node-fetch";

export const handler = async () => {
  try {
    const res = await fetch("https://returns.detroitaxle.com/api/returns");
    const data = await res.json();

    // Transform API into simplified dashboard summary
    const scanners = {};
    const classifications = {};
    const daily = {};
    const weekly = {};

    data.forEach((item) => {
      const user = item.scanner_name || "Unknown";
      scanners[user] = (scanners[user] || 0) + 1;

      const cls = item.classification || "Unclassified";
      classifications[cls] = (classifications[cls] || 0) + 1;

      const date = item.date?.slice(0, 10);
      daily[date] = (daily[date] || 0) + 1;
    });

    // Weekly grouping (simple aggregate)
    const weekKeys = Object.keys(daily);
    weekKeys.forEach((d, i) => {
      const week = `Week ${Math.floor(i / 7) + 1}`;
      weekly[week] = (weekly[week] || 0) + daily[d];
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
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to load API" }),
    };
  }
};
