// CommonJS + native fetch (Node 18 on Netlify)
// GET /.netlify/functions/returns
// GET /.netlify/functions/returns?date=YYYY-MM-DD

exports.handler = async (event) => {
  const url = new URL(event.rawUrl || `https://dummy${event.path}${event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters).toString() : ''}`);
  const date = url.searchParams.get('date');

  const UPSTREAM = 'https://returns.detroitaxle.com/api/returns';

  try {
    const res = await fetch(UPSTREAM, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: `Upstream returned ${res.status}` })
      };
    }

    let data = await res.json();
    if (!Array.isArray(data)) data = data?.data ?? [];

    if (date) {
      data = data.filter(r => (r.created_at || r.createdAt || '').startsWith(date));
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: 'Proxy failure', detail: String(e) })
    };
  }
};
