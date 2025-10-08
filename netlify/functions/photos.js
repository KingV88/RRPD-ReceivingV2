export async function handler(event, context) {
  const id = event.queryStringParameters.id;
  if (!id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing id parameter" })
    };
  }

  // Detroit Axle uploads path
  const BASE = "https://returns.detroitaxle.com/uploads";

  // possible filename patterns
  const candidates = [];
  // plain
  candidates.push(`${id}.jpg`);
  candidates.push(`${id}.jpeg`);
  candidates.push(`${id}.png`);
  // dashed suffix
  for (let i = 1; i <= 10; i++) {
    candidates.push(`${id}-${i}.jpg`);
    candidates.push(`${id}-${i}.jpeg`);
  }
  // underscored suffix
  for (let i = 1; i <= 10; i++) {
    candidates.push(`${id}_${i}.jpg`);
    candidates.push(`${id}_${i}.jpeg`);
  }

  const found = [];
  for (const file of candidates) {
    try {
      const res = await fetch(`${BASE}/${file}`, { method: "HEAD" });
      if (res.ok) {
        found.push(`${BASE}/${file}`);
      }
    } catch (err) {
      // ignore errors for non-existing
    }
  }

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ photos: found })
  };
}
