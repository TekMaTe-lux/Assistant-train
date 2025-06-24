export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.SNCF_KEY;
  const auth = Buffer.from(`${apiKey}:`).toString("base64");

  let apiUrl = null;

  if (req.query.id) {
    apiUrl = `https://api.sncf.com/v1/coverage/sncf/${req.query.id}`;
  } else if (req.query.url) {
    const decoded = decodeURIComponent(req.query.url);
    apiUrl = `https://api.sncf.com/v1/coverage/sncf/${decoded}`;
  } else {
    return res.status(400).json({ error: 'Paramètre "id" ou "url" requis' });
  }

  try {
    const response = await fetch(apiUrl, {
      headers: { Authorization: `Basic ${auth}` }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Erreur API SNCF : ${response.statusText}` });
    }

    const data = await response.json();
    res.status(200).json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du proxy SNCF', details: err.message });
  }
}
