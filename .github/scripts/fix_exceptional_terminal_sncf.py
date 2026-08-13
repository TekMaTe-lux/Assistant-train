from pathlib import Path
import re

p = Path('index.html')
s = p.read_text(encoding='utf-8')

pattern = re.compile(r'''        const isArrivalKeptDepartureDeletedTerminal = !!imp\n          && !isArrivalReallyDeleted\(imp, stop\)\n          && isDepartureReallyDeleted\(imp, stop\)\n          && !!\(imp\.amended_arrival_time \|\| imp\.base_arrival_time \|\| stop\?\.arrival_time\)\n          && index >= 0\n          && index < lastIndex\n          && hasDeletedArrivalAfterCurrent\n          && !hasServedArrivalAfterCurrent;''')

replacement = '''        // SNCF : une arrivée maintenue/amendée avec un départ supprimé à un arrêt\n        // intermédiaire signifie explicitement que cet arrêt devient le terminus réel.\n        // Exemple 88503 : Metz arrive 08:10 (base 07:30), départ supprimé ;\n        // Hagondange/Uckange/Thionville sont ensuite supprimés.\n        const isSncfExplicitPartialTerminal = !!imp\n          && imp.arrival_status !== 'deleted'\n          && imp.departure_status === 'deleted'\n          && !!imp.amended_arrival_time\n          && index >= 0\n          && index < lastIndex;\n\n        const isArrivalKeptDepartureDeletedTerminal = isSncfExplicitPartialTerminal || (\n          !!imp\n          && !isArrivalReallyDeleted(imp, stop)\n          && isDepartureReallyDeleted(imp, stop)\n          && !!(imp.amended_arrival_time || imp.base_arrival_time || stop?.arrival_time)\n          && index >= 0\n          && index < lastIndex\n          && hasDeletedArrivalAfterCurrent\n          && !hasServedArrivalAfterCurrent\n        );'''

s2, count = pattern.subn(replacement, s)
if count < 1:
    raise SystemExit('Bloc isArrivalKeptDepartureDeletedTerminal introuvable')

p.write_text(s2, encoding='utf-8')
print(f'Patched {count} exceptional-terminal block(s)')
