export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;

  const apiKey = process.env.SNCF_KEY;
  const auth = Buffer.from(`${apiKey}:`).toString("base64");

  const response = await fetch(
    `https://api.sncf.com/v1/coverage/sncf/vehicle_journeys/${id}`,
    {
      headers: { Authorization: `Basic ${auth}` }
    }
  );

  const data = await response.json();
  res.status(200).json(data);
}
