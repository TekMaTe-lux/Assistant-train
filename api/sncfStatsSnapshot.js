const fs = require('fs');
const path = require('path');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'sncf-stats-snapshot.json');

function loadSncfStatsSnapshot() {
  try {
    const buffer = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    if (!buffer) {
      return null;
    }
    const parsed = JSON.parse(buffer);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      ...parsed,
      source: 'snapshot'
    };
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('[SNCF proxy] Impossible de lire le snapshot statique', err);
    }
    return null;
  }
}

module.exports = {
  loadSncfStatsSnapshot,
  SNAPSHOT_PATH
};
