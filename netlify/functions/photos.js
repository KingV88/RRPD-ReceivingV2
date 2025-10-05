// netlify/functions/photos.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const id = event.queryStringParameters.id; // can be return ID or tracking #
    if (!id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing id parameter" }),
      };
    }

    // Base URL where photos live
    const baseUrl = "https://returns.detroitaxle.com/uploads/";

    // Two possible patterns:
    // 1. Return ID (like 436701-1370426-....jpg)
    // 2. Tracking number (like 1ZR0960D9096191779-...jpg)
    // We'll try both.

    const possiblePhotos = [];
    for (let i = 0; i < 10; i++) {
      // Common photo filename patterns (may vary, adjust if needed)
      possiblePhotos.push(`${baseUrl}${id}-${i}.jpg`);
      possiblePhotos.push(`${baseUrl}${id}-${i}.jpeg`);
      possiblePhotos.push(`${baseUrl}${id}-${i}.png`);
    }

    // Validate which URLs exist by attempting HEAD request
    const validPhotos = [];
    for (const url of possiblePhotos) {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) validPhotos.push(url);
      } catch (err) {
        // ignore errors
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ photos: validPhotos }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      }
    };

  } catch (err) {
    console.error("Photo proxy error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
