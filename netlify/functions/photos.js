// Netlify Function: photos.js
// Fetches photos by tracking number OR return ID, tries multiple filename patterns
export async function handler(event) {
  const id = event.queryStringParameters.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing id" }) };
  }

  const base = "https://returns.detroitaxle.com/uploads/";
  const possible = [];

  // Patterns to check: plain, dash, underscore, up to 10
  possible.push(`${id}.jpg`);
  for (let i=1;i<=10;i++){
    possible.push(`${id}-${i}.jpg`);
    possible.push(`${id}_${i}.jpg`);
  }

  const found = [];
  for (const file of possible) {
    try {
      const check = await fetch(base + file, { method: "HEAD" });
      if (check.ok) found.push(base + file);
    } catch {}
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(found),
  };
}
