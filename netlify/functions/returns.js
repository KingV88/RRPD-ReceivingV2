// netlify/functions/returns.js

// Helper: Extract rows from Detroit Axle returns table
function parseRows(html) {
  const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gi)].map(r => {
    const cols = [...r[1].matchAll(/<td[^>]*>(.*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").trim()
    );
    return cols;
  });
  return rows;
}

// Helper: Convert rows to objects
function parseReturns(html) {
  const rows = parseRows(html);
  const records = [];

  for (const r of rows) {
    if (r.length < 5) continue;

    const record = {
      orderNumber: r[0],
      status: r[1],
      createdAt: r[2],
      updatedAt: r[3],
      partNumber: r[4],
      classification: r[5] || "Unknown"
    };
    records.push(record);
  }

  return records;
}

// Main function
exports.handler = async (event) => {
  try {
    const date = event.queryStringParameters?.date || "";
    const url = date
      ? `https://returns.detroitaxle.com/api/returns?date=${date}`
      : "https://returns.detroitaxle.com/api/returns";

    console.log("Fetching returns data from:", url);

    const res = await fetch(url, { method: "GET" });

    if (!res.ok) {
      throw new Error(`Returns API responded with ${res.status}`);
    }

    const html = await res.text();
    const data = parseReturns(html);

    console.log("Returns data parsed successfully.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Returns loaded successfully",
        count: data.length,
        data
      }),
      headers: { "Content-Type": "application/json" }
    };

  } catch (err) {
    console.error("Error fetching returns:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to load returns data",
        details: err.message
      })
    };
  }
};
