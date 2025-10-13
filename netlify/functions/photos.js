// netlify/functions/photos.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const { id } = event.queryStringParameters;

    if (!id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing id parameter" }),
      };
    }

    const baseUrl = "https://returns.detroitaxle.com/uploads/";
    const candidates = [];

    // Try common file naming patterns
    candidates.push(`${id}.jpg`);
    for (let i = 1; i <= 10; i++) {
      candidates.push(`${id}-${i}.jpg`);
      candidates.push(`${id}_${i}.jpg`);
    }

    const foundPhotos = [];

    for (const file of candidates) {
      const res = await fetch(baseUrl + file, { method: "HEAD" });
      if (res.ok) foundPhotos.push(baseUrl + file);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        photoCount: foundPhotos.length,
        photos: foundPhotos,
      }),
    };
  } catch (err) {
    console.error("❌ Photos function error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal Server Error", details: err.message }),
    };
  }
};
