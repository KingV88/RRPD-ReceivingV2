export async function handler(event, context) {
  try {
    const date = event.queryStringParameters.date || "";
    const url = "https://returns.detroitaxle.com/api/returns";
    const res = await fetch(url);
    const data = await res.json();

    // If date is passed, filter results by that date (YYYY-MM-DD)
    const filtered = date
      ? data.filter(item => item.created_at && item.created_at.startsWith(date))
      : data;

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(filtered),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
