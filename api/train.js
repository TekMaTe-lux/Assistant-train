export default async function handler(req, res) {
  // Autoriser toutes les origines (à ajuster si besoin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  // (Optionnel) Autoriser certaines méthodes HTTP
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  // (Optionnel) Autoriser certains headers dans la requête
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Gérer la prérequête OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    // Répondre rapidement pour la prérequête CORS
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
