import { createSncfProxyHandler } from './sncfProxy.js';

function resolveApiUrl(req) {
  const { id } = req.query || {};
  if (!id) {
    const error = new Error('Paramètre "id" requis');
    error.statusCode = 400;
    throw error;
  }
 return `https://api.sncf.com/v1/coverage/sncf/vehicle_journeys/${id}`;
}

export default createSncfProxyHandler({ resolveApiUrl });
