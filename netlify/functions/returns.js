export async function handler(event, context) {
  const API_URL = "https://returns.detroitaxle.com/api/returns"; // adjust if needed
  const date = event.queryStringParameters.date;

  try {
    let url = API_URL;
    if (date) {
      // pass date filter if API accepts it
      url += `?date=${date}`;
    }

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: "Failed to fetch returns" })
      };
    }

    let data = await res.json();

    // safety net: if backend ignores ?date, filter here
    if (date && Array.isArray(data)) {
      data = data.filter(item =>
        item.created_at && item.created_at.startsWith(date)
      );
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error("returns.js error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error fetching returns" })
    };
  }
}
