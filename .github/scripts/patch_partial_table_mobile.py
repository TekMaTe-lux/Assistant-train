from pathlib import Path

index_path = Path("index.html")
text = index_path.read_text(encoding="utf-8")

# En-têtes du tableau : rendre le terminus/départ exceptionnel explicite.
anchor = "        const isPartialEnd = newEndId && newEndId !== originalEndId;\n"
addition = """        const isPartialEnd = newEndId && newEndId !== originalEndId;
        const partialStartName = isPartial
          ? (result.train.stop_times.find((s) => s.stop_point?.id === newStartId)?.stop_point?.name || '')
          : '';
        const partialEndName = isPartialEnd
          ? (result.train.stop_times.find((s) => s.stop_point?.id === newEndId)?.stop_point?.name || '')
          : '';
        const tableMaxDelay = Object.values(impacted).reduce((maxDelay, st) => {
          const amended = st?.amended_departure_time || st?.amended_arrival_time;
          const baseTime = st?.base_departure_time || st?.base_arrival_time;
          const computed = amended && baseTime ? Number(dl(baseTime, amended)) : 0;
          const explicit = Number(st?.delay_minutes);
          return Math.max(
            maxDelay,
            Number.isFinite(computed) && computed > 0 ? computed : 0,
            Number.isFinite(explicit) && explicit > 0 ? explicit : 0
          );
        }, 0);
"""
anchor_count = text.count(anchor)
if anchor_count < 1:
    raise SystemExit("Ancre isPartialEnd introuvable")
text = text.replace(anchor, addition)

old_title = "        } else if (isPartial || isPartialEnd) {\n          icon = '⚠️'; title = 'Suppression partielle';\n"
new_title = """        } else if (isPartial || isPartialEnd) {
          icon = '⚠️';
          const partialParts = ['Suppression partielle'];
          if (isPartial && partialStartName) partialParts.push(`Départ exceptionnel ${partialStartName}`);
          if (isPartialEnd && partialEndName) partialParts.push(`Terminus exceptionnel ${partialEndName}`);
          if (tableMaxDelay > 0) partialParts.push(`+${Math.round(tableMaxDelay)} min`);
          title = partialParts.join(' · ');
"""
title_count = text.count(old_title)
if title_count < 1:
    raise SystemExit("Bloc titre suppression partielle introuvable")
text = text.replace(old_title, new_title)

# Ajouter un libellé réellement visible dans la cellule du nouveau terminus / départ.
arrival_needle = "${terminalArrivalClock}</span></td>`;"
arrival_replacement = "${terminalArrivalClock}</span><span class=\"partial-service-label partial-service-label--terminus\">TERMINUS EXCEPTIONNEL</span></td>`;"
arrival_count = text.count(arrival_needle)
if arrival_count < 1:
    raise SystemExit("Rendu terminalArrivalClock introuvable")
text = text.replace(arrival_needle, arrival_replacement)

departure_needle = "${terminalDepartureClock}</span></td>`;"
departure_replacement = "${terminalDepartureClock}</span><span class=\"partial-service-label partial-service-label--start\">DÉPART EXCEPTIONNEL</span></td>`;"
departure_count = text.count(departure_needle)
if departure_count < 1:
    raise SystemExit("Rendu terminalDepartureClock introuvable")
text = text.replace(departure_needle, departure_replacement)

# Style très ciblé : ne touche qu'aux cellules terminus/départ exceptionnel.
style_id = "lb-partial-service-table-v1"
if style_id not in text:
    style = r'''
<style id="lb-partial-service-table-v1">
#trainInfo td.terminal-arrival-cell,
#trainInfo td.terminal-start-cell { vertical-align: middle; }
#trainInfo .partial-service-label {
  display: block;
  width: max-content;
  max-width: 92px;
  margin: 3px auto 0;
  font-family: "Rajdhani", system-ui, sans-serif;
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: .025em;
  text-align: center;
  white-space: normal;
  text-transform: uppercase;
}
#trainInfo .partial-service-label--terminus { color: #ffb21a; }
#trainInfo .partial-service-label--start { color: #55eaff; }
@media (max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px) {
  #trainInfo .partial-service-label {
    max-width: 74px;
    margin-top: 2px;
    font-size: 7.5px;
    line-height: .95;
  }
}
</style>
'''
    pos = text.find("</head>")
    if pos < 0:
        raise SystemExit("</head> introuvable")
    text = text[:pos] + style + "\n" + text[pos:]

index_path.write_text(text, encoding="utf-8")

# Mobile : le bouton Générer le tableau doit avoir son texte centré.
css_path = Path("assets/lb-mobile-v4.css")
css = css_path.read_text(encoding="utf-8")
marker = "/* LB mobile: centrage bouton Générer le tableau */"
if marker not in css:
    css += r'''

/* LB mobile: centrage bouton Générer le tableau */
@media (max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px) {
  body.lb-v3 #search #loadTrains {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    text-align: center !important;
    line-height: 1.1 !important;
  }
}
'''
css_path.write_text(css, encoding="utf-8")

print(f"isPartialEnd patches: {anchor_count}")
print(f"partial title patches: {title_count}")
print(f"terminus cell patches: {arrival_count}")
print(f"departure cell patches: {departure_count}")
