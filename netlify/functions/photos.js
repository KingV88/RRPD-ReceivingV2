// netlify/functions/photos.js

exports.handler = async () => {
  try {
    console.log("Fetching photo data...");

    const res = await fetch("https://returns.detroitaxle.com/api/photos", {
      method: "GET"
    });

    if (!res.ok) throw new Error(`Photo API responded with ${res.status}`);

    const data = await res.json();

    console.log("Photos loaded successfully.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Photos retrieved successfully",
        total: data.length || 0,
        photos: data
      }),
      headers: { "Content-Type": "application/json" }
    };
  } catch (err) {
    console.error("Error fetching photos:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to load photo data",
        details: err.message
      })
    };
  }
};
