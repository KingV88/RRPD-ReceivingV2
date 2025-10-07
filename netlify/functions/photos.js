export async function handler(event, context) {
  try {
    const id = event.queryStringParameters.id;
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing id" }) };
    }

    const base = "https://returns.detroitaxle.com/uploads/";
    const candidates = [
      `${id}.jpg`,
      ...Array.from({ length: 10 }).map((_, i) => `${id}-${i+1}.jpg`),
      ...Array.from({ length: 10 }).map((_, i) => `${id}_${i+1}.jpg`),
    ];

    const urls = [];
    for (const file of candidates) {
      try {
        const r = await fetch(base + file, { method: "HEAD" });
        if (r.ok) urls.push(base + file);
      } catch {}
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(urls),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
