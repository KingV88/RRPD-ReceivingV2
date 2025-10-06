exports.handler = async function(event) {
  try {
    const apiUrl = "https://returns.detroitaxle.com/api/returns";

    // Check for ?date=YYYY-MM-DD in the request
    const { date } = event.queryStringParameters || {};

    const response = await fetch(apiUrl, { method: "GET" });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Upstream error: ${response.statusText}` })
      };
    }

    const allData = await response.json();

    let filtered = allData;

    // If a date was passed, filter by created_at field
    if (date) {
      filtered = allData.filter(item => {
        if (!item.created_at) return false;
        // created_at is like "2025-09-26 14:02:51"
        const itemDate = item.created_at.split(" ")[0];
        return itemDate === date;
      });
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filtered)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
