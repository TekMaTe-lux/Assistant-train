const SILLON_BOUNDS = L.latLngBounds([[48.45, 5.70], [49.65, 6.35]]);
const map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([47.1, 2.4], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap — données ferroviaires SNCF Réseau'
}).addTo(map);

const infrastructureLayer = L.geoJSON(null, {
  style(feature) {
    const kind = feature?.properties?.kind;
    if (kind === 'lgv') return { color: '#b529e8', weight: 3.5, opacity: .88 };
    if (kind === 'closed') return { color: '#647080', weight: 1, opacity: .3, dashArray: '4 5' };
    return { color: '#00a968', weight: 2, opacity: .62 };
  }
}).addTo(map);
const trainLayer = L.layerGroup().addTo(map);
let selectedPathLayer = null;
let refreshTimer = null;
let requestSerial = 0;
const statusEl = document.querySelector('#status');
const detailEl = document.querySelector('#detail');
const detailContentEl = document.querySelector('#detail-content');

function bboxString() {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => v.toFixed(5)).join(',');
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function trainEnabled(train) {
  return document.querySelector(`#filter-${train.category}`).checked;
}

function trainIcon(train) {
  const delay = Math.max(0, Math.round((train.delaySeconds || 0) / 60));
  const delayed = delay > 0 ? ' delayed' : '';
  const dataDelay = delay > 0 ? `+${delay}` : '';
  return L.divIcon({
    className: 'train-icon',
    html: `<span class="train-pill ${train.category}${delayed}" data-delay="${dataDelay}">${train.number}</span>`,
    iconSize: [70, 22], iconAnchor: [35, 11]
  });
}

async function showTrain(train) {
  const [trip, path] = await Promise.all([
    getJson(`/api/map-v2/trips/${encodeURIComponent(train.tripId)}`),
    getJson(`/api/map-v2/paths/${encodeURIComponent(train.pathId)}`)
  ]);
  if (selectedPathLayer) selectedPathLayer.remove();
  selectedPathLayer = L.geoJSON(path, { style: { color: '#168dff', weight: 7, opacity: .95 } }).addTo(map);
  selectedPathLayer.bringToFront();
  const stops = trip.stops.map(stop => `<li><span class="stop-time">${stop.time}</span>${stop.name}</li>`).join('');
  detailContentEl.innerHTML = `<h2>${train.category.toUpperCase()} ${train.number}</h2><div class="meta">${trip.origin} → ${trip.destination}</div><ul class="stops">${stops}</ul>`;
  detailEl.classList.remove('hidden');
}

async function refreshInfrastructure(serial) {
  const data = await getJson(`/api/map-v2/infrastructure?bbox=${bboxString()}`);
  if (serial !== requestSerial) return;
  infrastructureLayer.clearLayers().addData(data);
}

async function refreshTrains(serial) {
  const data = await getJson(`/api/map-v2/trains?bbox=${bboxString()}`);
  if (serial !== requestSerial) return;
  trainLayer.clearLayers();
  for (const train of data.trains || []) {
    if (!trainEnabled(train)) continue;
    L.marker([train.lat, train.lon], { icon: trainIcon(train), keyboard: false })
      .on('click', event => { L.DomEvent.stopPropagation(event); showTrain(train).catch(showError); })
      .addTo(trainLayer);
  }
  statusEl.textContent = `${data.trains?.length || 0} trains · ${data.generatedAt?.slice(11, 19) || ''}`;
}

function showError(error) {
  console.error(error);
  statusEl.textContent = 'Erreur de données';
}

async function refreshAll() {
  const serial = ++requestSerial;
  try {
    await Promise.all([refreshInfrastructure(serial), refreshTrains(serial)]);
  } catch (error) { showError(error); }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshAll, 180);
}

map.on('moveend', scheduleRefresh);
map.on('click', () => {
  detailEl.classList.add('hidden');
  if (selectedPathLayer) { selectedPathLayer.remove(); selectedPathLayer = null; }
});
document.querySelector('#close-detail').addEventListener('click', () => detailEl.classList.add('hidden'));
document.querySelector('#sillon').addEventListener('click', () => map.fitBounds(SILLON_BOUNDS));
for (const checkbox of document.querySelectorAll('.filters input')) checkbox.addEventListener('change', refreshAll);
setInterval(() => refreshTrains(requestSerial).catch(showError), 10_000);
refreshAll();
