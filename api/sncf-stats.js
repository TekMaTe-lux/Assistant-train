const { serveStatsResponse } = require('./sncfStatsHelpers.js');

module.exports = function handler(req, res) {
  return serveStatsResponse(req, res);
};
