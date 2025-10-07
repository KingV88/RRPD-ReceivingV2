// Netlify Function: returns.js
// Proxies Detroit Axle returns API, adds optional date filter
export async function handler(event) {
  const date = event.queryStringParameters.date;

  try {
    const res = await fetch("https://returns.detroitaxle.com/api/returns");
    const data = await res.json();

    // If ?date passed, filter client-side by created_at
    let filtered = data;
    if (date) {
      filtered = data.filter(r => r.created_at && r.created_at.startsWith(date));
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(filtered),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to fetch returns", details: err.message }) };
  }
}
