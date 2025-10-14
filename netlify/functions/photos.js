// CommonJS + native fetch
// GET /.netlify/functions/photos?id=<return_id_or_tracking>

exports.handler = async (event) => {
  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: 'Missing id parameter' })
    };
  }

  const baseUrl = 'https://returns.detroitaxle.com/uploads/';
  const candidates = [];

  // Single name
  candidates.push(`${id}.jpg`);

  // id-1..10
  for (let i = 1; i <= 10; i++) candidates.push(`${id}-${i}.jpg`);
  // id_1..10
  for (let i = 1; i <= 10; i++) candidates.push(`${id}_${i}.jpg`);

  const found = [];
  for (const file of candidates) {
    try {
      const head = await fetch(baseUrl + file, { method: 'HEAD' });
      if (head.ok) found.push(baseUrl + file);
    } catch (_) {}
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify({ id, photos: found })
  };
};
