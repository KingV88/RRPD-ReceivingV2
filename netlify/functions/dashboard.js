const fetch = require("node-fetch");

exports.handler = async function (event, context) {
  try {
    // --- 1️⃣ Fetch Data from Your Active API Endpoints ---
    const returnsUrl = "https://returns.detroitaxle.com/returns/reports/condition";
    const photosUrl = "https://returns.detroitaxle.com/uploads"; // adjust if needed

    console.log("Fetching RRPD data...");

    const [returnsRes, photosRes] = await Promise.all([
      fetch(returnsUrl),
      fetch(photosUrl)
    ]);

    if (!returnsRes.ok || !photosRes.ok) {
      throw new Error(`Failed API: ${returnsRes.status} / ${photosRes.status}`);
    }

    const returnsHtml = await returnsRes.text();

    // --- 2️⃣ Parse Returns Data (Classification Table) ---
    const rows = [...returnsHtml.matchAll(/<tr>(.*?)<\/tr>/gis)]
      .map(r => r[1].replace(/<\/?[^>]+(>|$)/g, "").split(/\s+/).filter(Boolean))
      .filter(cols => cols.length >= 4);

    let classifications = {};
    let scanners = {};
    let trends = {};

    for (const cols of rows) {
      const date = cols[0] || "Unknown";
      const scanner = cols[2] || "Unassigned";
      const classification = cols[cols.length - 1] || "Unknown";

      // Count by classification
      classifications[classification] = (classifications[classification] || 0) + 1;

      // Count by scanner
      scanners[scanner] = (scanners[scanner] || 0) + 1;

      // Count weekly trend by date
      trends[date] = (trends[date] || 0) + 1;
    }

    // --- 3️⃣ Format Final Dashboard Data ---
    const dashboard = {
      scanners,
      classifications,
      trends,
      summary: {
        totalReturns: rows.length,
        timestamp: new Date().toISOString()
      }
    };

    // --- 4️⃣ Return Data to Frontend ---
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dashboard, null, 2)
    };

  } catch (err) {
    console.error("Dashboard Error:", err);

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Dashboard function failed", message: err.message })
    };
  }
};
