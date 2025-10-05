// netlify/functions/returns.js
const fetch = require("node-fetch");

exports.handler = async function (event, context) {
  try {
    const response = await fetch("https://returns.detroitaxle.com/api/returns");
    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch returns data" }),
    };
  }
};
