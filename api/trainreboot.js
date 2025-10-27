const { createSncfProxyHandler } = require('./sncfProxy.js');

function resolveApiUrl(req) {
  const { id } = req.query || {};
  if (!id) {
    const error = new Error('Paramètre "id" requis');
    error.statusCode = 400;
    throw error;
  }
 return `https://api.sncf.com/v1/coverage/sncf/vehicle_journeys/${id}`;
}

module.exports = createSncfProxyHandler({ resolveApiUrl });
