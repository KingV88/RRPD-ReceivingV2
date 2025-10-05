// netlify/functions/photos.js
const fetch = require("node-fetch");

exports.handler = async function (event, context) {
  const { id } = event.queryStringParameters;

  if (!id) {
    return { statusCode: 400, body: "Missing photo id" };
  }

  try {
    const response = await fetch(`https://returns.detroitaxle.com/uploads/${id}`);
    const buffer = await response.buffer();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "image/jpeg",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch photo" }),
    };
  }
};
