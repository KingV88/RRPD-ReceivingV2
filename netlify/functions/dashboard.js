// netlify/functions/dashboard.js

function parseRows(html) {
  const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gi)].map(r => {
    const cols = [...r[1].matchAll(/<td[^>]*>(.*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").trim()
    );
    return cols;
  });
  return rows;
}

function parseData(html) {
  const rows = parseRows(html);
  const items = [];
  const buckets = {};

  for (const r of rows) {
    if (r.length < 2) continue;
    const part = r[0];
    const classification = r[1].toLowerCase();

    const item = { part, classification };
    items.push(item);

    if (!buckets[classification]) buckets[classification] = 0;
    buckets[classification]++;
  }

  const missed = items.filter(it => {
    const c = it.classification;
    return !["good", "used", "core"].some(k => c.includes(k));
  });

  return { items, buckets, missed };
}

exports.handler = async () => {
  try {
    console.log("Fetching dashboard data...");

    const res = await fetch("https://returns.detroitaxle.com/returns/reports/condition", {
      method: "GET",
      headers: {
        "User-Agent": "RRPD-Dashboard",
        "Accept": "text/html"
      }
    });

    if (!res.ok) throw new Error(`Dashboard API responded with ${res.status}`);

    const html = await res.text();
    const parsed = parseData(html);

    console.log("Dashboard parsed successfully.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Dashboard loaded",
        items: parsed.items,
        buckets: parsed.buckets,
        missed: parsed.missed,
        timestamp: new Date().toISOString()
      }),
      headers: { "Content-Type": "application/json" }
    };
  } catch (err) {
    console.error("Error fetching dashboard:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to load dashboard data",
        details: err.message
      })
    };
  }
};
