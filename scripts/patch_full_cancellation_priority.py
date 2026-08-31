from pathlib import Path

INDEX = Path("index.html")
TEST = Path("tests/live-partial-cancellation.test.js")

source = INDEX.read_text(encoding="utf-8")
fn_start = source.find("function classifyOfficialLiveDisruption(")
fn_end = source.find("function extractLiveTrains()", fn_start)
if fn_start < 0 or fn_end < 0:
    raise SystemExit("classifyOfficialLiveDisruption introuvable")

block = source[fn_start:fn_end]
logic_start = block.find("    const partial = ")
default_marker = "    return { statusClass:'', statusLabel:'' };"
logic_end = block.find(default_marker, logic_start)
if logic_start < 0 or logic_end < 0:
    raise SystemExit("bloc de classification attendu introuvable")

replacement = """    // Un CANCELED au niveau du voyage SNCF est autoritaire. Une autre source
    // (notamment HAFAS sur Bettembourg/Luxembourg) ne doit jamais ressusciter
    // un arrêt et transformer une suppression totale en suppression partielle.
    const explicitTripCanceled = !/partial|partiel/.test(statusText)
      && /no_service|cancell|cancel|supprim|annul|deleted|trip canceled/.test(statusText);
    const allStopsDeleted = deletedStops > 0 && runningStops === 0;
    if (explicitTripCanceled || allStopsDeleted) {
      return { statusClass:'cancel', statusLabel:'Supprimé' };
    }

    const partial = /partial|partiel|service reduit|service réduit|terminus exceptionnel|depart exceptionnel|départ exceptionnel|a partir de|à partir de|entre .{2,40} et /.test(combined)
      || (deletedStops > 0 && runningStops > 0);
    if (partial) return { statusClass:'partial', statusLabel:'Suppression partielle' };

    const canceled = !/partial|partiel/.test(combined)
      && /no_service|cancell|cancel|supprim|annul|deleted|trip canceled/.test(combined);
    if (canceled) return { statusClass:'cancel', statusLabel:'Supprimé' };
"""

new_block = block[:logic_start] + replacement + block[logic_end:]
new_source = source[:fn_start] + new_block + source[fn_end:]
if new_source == source:
    raise SystemExit("aucune modification index.html")
INDEX.write_text(new_source, encoding="utf-8")

# Remplace uniquement le premier test de priorité, les autres contrats restent inchangés.
test_source = TEST.read_text(encoding="utf-8")
start = test_source.find("test('LIVE classifies a partial cancellation before a full cancellation'")
end = test_source.find("\ntest('GTFS extraction and SNCF hub hydration use the same classifier'", start)
if start < 0 or end < 0:
    raise SystemExit("test de classification attendu introuvable")

new_test = r'''test('LIVE gives trip-level full cancellation priority without breaking partial cancellations', () => {
  const block = between('function classifyOfficialLiveDisruption(', 'function extractLiveTrains()');
  const classify = Function(`${block}\nreturn classifyOfficialLiveDisruption;`)();
  const deleted = { stop_time_effect: 'deleted' };
  const running = { stop_time_effect: 'scheduled' };

  // Cas réel 88748 : le voyage SNCF est CANCELED. Même si un texte ou une
  // autre source laisse croire à un terminus exceptionnel, il reste supprimé.
  assert.equal(classify({
    status: 'CANCELED',
    cause: 'Suppression partielle · terminus exceptionnel à Bettembourg',
    stops: [deleted, running]
  }).statusClass, 'cancel');

  // Une vraie suppression partielle continue de fonctionner normalement.
  assert.equal(classify({
    status: 'SCHEDULED',
    cause: 'Suppression partielle entre Thionville et Luxembourg',
    stops: [running, deleted]
  }).statusClass, 'partial');

  // Tous les arrêts supprimés = suppression totale, même sans libellé CANCELED.
  assert.equal(classify({
    status: 'SCHEDULED',
    stops: [deleted, deleted]
  }).statusClass, 'cancel');

  assert.match(block, /explicitTripCanceled/);
  assert.match(block, /deletedStops > 0 && runningStops > 0/);
});
'''

TEST.write_text(test_source[:start] + new_test + test_source[end:], encoding="utf-8")
print("Correctif appliqué à index.html et au test LIVE")
