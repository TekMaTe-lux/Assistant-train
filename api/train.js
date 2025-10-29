const { createSncfProxyHandler } = require('./sncfProxy.js');
const { requestWantsStats, serveStatsResponse } = require('./sncfStatsHelpers.js');

function resolveApiUrl(req) {
  const { id, url } = req.query || {};
  if (id) {
    return `https://api.sncf.com/v1/coverage/sncf/${id}`;
  }
  if (url) {
    try {
      const decoded = decodeURIComponent(url);
      return `https://api.sncf.com/v1/coverage/sncf/${decoded}`;
    } catch (err) {
      const error = new Error('Paramètre "url" invalide');
      error.statusCode = 400;
      throw error;
    }
  }
  const error = new Error('Paramètre "id" ou "url" requis');
  error.statusCode = 400;
  throw error;
}

const proxyHandler = createSncfProxyHandler({ resolveApiUrl });

module.exports = function handler(req, res) {
  if (requestWantsStats(req)) {
    return serveStatsResponse(req, res);
  }
  return proxyHandler(req, res);
};
