const fetch = require("node-fetch");

exports.handler = async function(event) {
  const id = event.queryStringParameters.id;
  if (!id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing id parameter" })
    };
  }

  const baseUrl = "https://returns.detroitaxle.com/uploads/";
  const candidates = [];

  // Plain filename (single photo case)
  candidates.push(`${id}.jpg`);

  // Try with dash + index, up to 10
  for (let i = 1; i <= 10; i++) {
    candidates.push(`${id}-${i}.jpg`);
  }

  // Try with underscore + index, up to 10
  for (let i = 1; i <= 10; i++) {
    candidates.push(`${id}_${i}.jpg`);
  }

  const foundPhotos = [];

  for (const file of candidates) {
    try {
      const res = await fetch(baseUrl + file, { method: "HEAD" });
      if (res.ok) {
        foundPhotos.push(baseUrl + file);
      }
    } catch (err) {
      console.error("Check failed for", file, err);
    }
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({ photos: foundPhotos })
  };
};
