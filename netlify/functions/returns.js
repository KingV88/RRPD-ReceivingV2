// netlify/functions/returns.js
const fetch = require("node-fetch");

exports.handler = async () => {
  try {
    // Replace this with your actual data source API endpoint:
    const apiUrl = "https://returns.detroitaxle.com/api/returns";

    const res = await fetch(apiUrl);
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `API request failed: ${res.statusText}` }),
      };
    }

    const data = await res.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Returns data successfully fetched",
        count: data.length || 0,
        results: data,
      }),
    };
  } catch (err) {
    console.error("❌ Returns fetch error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal Server Error", details: err.message }),
    };
  }
};
