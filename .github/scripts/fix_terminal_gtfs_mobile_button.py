from pathlib import Path

# ---------------- index.html ----------------
p = Path('index.html')
s = p.read_text(encoding='utf-8')

# 1) Nouveau terminus : data-base-time doit rester l'heure THEORIQUE,
# et si SNCF donne déjà un horaire amendé on affiche théorique barré + nouvel horaire.
old_arrival = '''        if (isArrivalKeptDepartureDeletedTerminal) {
          const terminalArrivalRaw = imp.amended_arrival_time || imp.base_arrival_time || stop?.arrival_time;
          const terminalArrivalClock = ft(terminalArrivalRaw);
          const terminalBaseAttr = terminalArrivalRaw ? ` data-base-time="${terminalArrivalRaw}" data-terminal-arrival="1"` : ' data-terminal-arrival="1"';
          const terminalClassAttr = cellClasses.length
            ? ` class="${cellClasses.join(' ')} terminal-arrival-cell"`
            : ' class="terminal-arrival-cell"';
          html += `<td${terminalClassAttr}${terminalBaseAttr}><span class="new-start terminal-arrival-time" style="color:#39a8ff !important;font-weight:900 !important;text-decoration:none !important;animation:none !important;opacity:1 !important;text-shadow:0 0 8px rgba(57,168,255,.72),0 0 14px rgba(57,168,255,.34) !important;background:transparent !important;border:0 !important;box-shadow:none !important;padding:0 !important;">${terminalArrivalClock}</span><span class="partial-service-label partial-service-label--terminus">TERMINUS EXCEPTIONNEL</span></td>`;
          continue;
        }
'''
new_arrival = '''        if (isArrivalKeptDepartureDeletedTerminal) {
          const terminalScheduledRaw = imp.base_arrival_time || stop?.arrival_time || imp.amended_arrival_time;
          const terminalArrivalRaw = imp.amended_arrival_time || terminalScheduledRaw;
          const terminalArrivalClock = ft(terminalArrivalRaw);
          const terminalHasDelay = !!terminalScheduledRaw && !!terminalArrivalRaw && dl(terminalScheduledRaw, terminalArrivalRaw) > 0;
          const terminalScheduledHtml = terminalHasDelay
            ? `<span class="terminal-partial-base">${ft(terminalScheduledRaw)}</span>`
            : '';
          const terminalBaseAttr = terminalScheduledRaw ? ` data-base-time="${terminalScheduledRaw}" data-terminal-arrival="1"` : ' data-terminal-arrival="1"';
          const terminalClassAttr = cellClasses.length
            ? ` class="${cellClasses.join(' ')} terminal-arrival-cell"`
            : ' class="terminal-arrival-cell"';
          html += `<td${terminalClassAttr}${terminalBaseAttr}><span class="terminal-partial-stack">${terminalScheduledHtml}<span class="new-start terminal-arrival-time terminal-partial-new" style="color:#39a8ff !important;font-weight:900 !important;text-decoration:none !important;animation:none !important;opacity:1 !important;text-shadow:0 0 8px rgba(57,168,255,.72),0 0 14px rgba(57,168,255,.34) !important;background:transparent !important;border:0 !important;box-shadow:none !important;padding:0 !important;">${terminalArrivalClock}</span></span><span class="partial-service-label partial-service-label--terminus">TERMINUS EXCEPTIONNEL</span></td>`;
          continue;
        }
'''
if old_arrival not in s:
    raise SystemExit('Bloc terminus arrivée introuvable')
s = s.replace(old_arrival, new_arrival, 1)

old_start = '''        if (isDepartureKeptArrivalDeletedNewStart) {
          const terminalDepartureRaw = imp.amended_departure_time || imp.base_departure_time || stop?.departure_time;
          const terminalDepartureClock = ft(terminalDepartureRaw);
          const terminalBaseAttr = terminalDepartureRaw ? ` data-base-time="${terminalDepartureRaw}" data-terminal-start="1"` : ' data-terminal-start="1"';
          const terminalClassAttr = cellClasses.length
            ? ` class="${cellClasses.join(' ')} terminal-start-cell"`
            : ' class="terminal-start-cell"';
          html += `<td${terminalClassAttr}${terminalBaseAttr}><span class="new-start terminal-start-time" style="color:#39a8ff !important;font-weight:900 !important;text-decoration:none !important;animation:none !important;opacity:1 !important;text-shadow:0 0 8px rgba(57,168,255,.72),0 0 14px rgba(57,168,255,.34) !important;background:transparent !important;border:0 !important;box-shadow:none !important;padding:0 !important;">${terminalDepartureClock}</span><span class="partial-service-label partial-service-label--start">DÉPART EXCEPTIONNEL</span></td>`;
          continue;
        }
'''
new_start = '''        if (isDepartureKeptArrivalDeletedNewStart) {
          const terminalScheduledRaw = imp.base_departure_time || stop?.departure_time || imp.amended_departure_time;
          const terminalDepartureRaw = imp.amended_departure_time || terminalScheduledRaw;
          const terminalDepartureClock = ft(terminalDepartureRaw);
          const terminalHasDelay = !!terminalScheduledRaw && !!terminalDepartureRaw && dl(terminalScheduledRaw, terminalDepartureRaw) > 0;
          const terminalScheduledHtml = terminalHasDelay
            ? `<span class="terminal-partial-base">${ft(terminalScheduledRaw)}</span>`
            : '';
          const terminalBaseAttr = terminalScheduledRaw ? ` data-base-time="${terminalScheduledRaw}" data-terminal-start="1"` : ' data-terminal-start="1"';
          const terminalClassAttr = cellClasses.length
            ? ` class="${cellClasses.join(' ')} terminal-start-cell"`
            : ' class="terminal-start-cell"';
          html += `<td${terminalClassAttr}${terminalBaseAttr}><span class="terminal-partial-stack">${terminalScheduledHtml}<span class="new-start terminal-start-time terminal-partial-new" style="color:#39a8ff !important;font-weight:900 !important;text-decoration:none !important;animation:none !important;opacity:1 !important;text-shadow:0 0 8px rgba(57,168,255,.72),0 0 14px rgba(57,168,255,.34) !important;background:transparent !important;border:0 !important;box-shadow:none !important;padding:0 !important;">${terminalDepartureClock}</span></span><span class="partial-service-label partial-service-label--start">DÉPART EXCEPTIONNEL</span></td>`;
          continue;
        }
'''
if old_start not in s:
    raise SystemExit('Bloc départ exceptionnel introuvable')
s = s.replace(old_start, new_start, 1)

# 2) GTFS-RT remplaçait tout le contenu de la cellule et supprimait le libellé terminus.
# On marque le cas terminal, on applique les bonnes classes, puis on remet le libellé après le wrapper.
old_display = '''        const displayValue = delayedClock || `+${roundedDelay} min`;

        let wrapper = cell.querySelector('.gtfs-retard');
'''
new_display = '''        const displayValue = delayedClock || `+${roundedDelay} min`;
        const isTerminalPartial = cell.dataset.terminalArrival === '1' || cell.dataset.terminalStart === '1';

        let wrapper = cell.querySelector('.gtfs-retard');
'''
if old_display not in s:
    raise SystemExit('Ancre GTFS displayValue introuvable')
s = s.replace(old_display, new_display, 1)

old_classes = '''        const baseSpan = document.createElement('span');
        baseSpan.className = 'gtfs-retard-base';
        baseSpan.textContent = baseTimeRaw ? ft(baseTimeRaw) : (cell.textContent || '').trim();

        const newSpan = document.createElement('span');
        newSpan.className = 'gtfs-retard-new';
        newSpan.textContent = displayValue;
'''
new_classes = '''        const baseSpan = document.createElement('span');
        baseSpan.className = isTerminalPartial ? 'gtfs-retard-base terminal-partial-base' : 'gtfs-retard-base';
        baseSpan.textContent = baseTimeRaw ? ft(baseTimeRaw) : (cell.textContent || '').trim();

        const newSpan = document.createElement('span');
        newSpan.className = isTerminalPartial ? 'gtfs-retard-new terminal-partial-new' : 'gtfs-retard-new';
        newSpan.textContent = displayValue;
'''
if old_classes not in s:
    raise SystemExit('Classes GTFS introuvables')
s = s.replace(old_classes, new_classes, 1)

old_append = '''        while (cell.firstChild) cell.removeChild(cell.firstChild);
        cell.appendChild(wrapper);
        cell.dataset.gtfsDelayMinutes = String(retardMinutes);
'''
new_append = '''        while (cell.firstChild) cell.removeChild(cell.firstChild);
        cell.appendChild(wrapper);
        if (isTerminalPartial) {
          const terminalLabel = document.createElement('span');
          const isArrivalTerminal = cell.dataset.terminalArrival === '1';
          terminalLabel.className = isArrivalTerminal
            ? 'partial-service-label partial-service-label--terminus'
            : 'partial-service-label partial-service-label--start';
          terminalLabel.textContent = isArrivalTerminal ? 'TERMINUS EXCEPTIONNEL' : 'DÉPART EXCEPTIONNEL';
          cell.appendChild(terminalLabel);
        }
        cell.dataset.gtfsDelayMinutes = String(retardMinutes);
'''
if old_append not in s:
    raise SystemExit('Append GTFS introuvable')
s = s.replace(old_append, new_append, 1)

# 3) Style spécifique : heure prévue blanche barrée, nouvel horaire bleu, empilement propre.
style_anchor = '''#trainInfo .partial-service-label--terminus { color: #ffb21a; }
#trainInfo .partial-service-label--start { color: #55eaff; }
'''
style_new = '''#trainInfo .partial-service-label--terminus { color: #ffb21a; }
#trainInfo .partial-service-label--start { color: #55eaff; }
#trainInfo .terminal-partial-stack,
#trainInfo .terminal-arrival-cell .gtfs-retard,
#trainInfo .terminal-start-cell .gtfs-retard {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
}
#trainInfo .terminal-partial-base {
  color: #ffffff !important;
  font-weight: 700 !important;
  opacity: .92 !important;
  text-decoration-line: line-through !important;
  text-decoration-color: rgba(255,255,255,.92) !important;
  text-decoration-thickness: 1.4px !important;
  text-shadow: none !important;
}
#trainInfo .terminal-partial-new {
  color: #39a8ff !important;
  font-weight: 900 !important;
  text-decoration: none !important;
  opacity: 1 !important;
  text-shadow: 0 0 8px rgba(57,168,255,.72), 0 0 14px rgba(57,168,255,.34) !important;
}
'''
if style_anchor not in s:
    raise SystemExit('Style partial-service introuvable')
s = s.replace(style_anchor, style_new, 1)

# 4) Cache-bust mobile pour que Safari charge réellement les corrections.
if './assets/lb-mobile-v4.css?v=9' not in s:
    raise SystemExit('Référence CSS mobile v9 introuvable')
s = s.replace('./assets/lb-mobile-v4.css?v=9', './assets/lb-mobile-v4.css?v=10', 1)
if './assets/lb-mobile-v4.js?v=4' not in s:
    raise SystemExit('Référence JS mobile v4 introuvable')
s = s.replace('./assets/lb-mobile-v4.js?v=4', './assets/lb-mobile-v4.js?v=5', 1)

p.write_text(s, encoding='utf-8')

# ---------------- assets/lb-mobile-v4.js ----------------
p = Path('assets/lb-mobile-v4.js')
s = p.read_text(encoding='utf-8')

anchor = '''  function isMobileLayout() {
    return mobileQuery.matches;
  }

'''
insert = '''  function isMobileLayout() {
    return mobileQuery.matches;
  }

  function syncGenerateButton() {
    const button = document.getElementById("loadTrains");
    if (!button) return;
    const mobile = isMobileLayout();
    const label = mobile ? "Générer" : "Générer le tableau";
    if ((button.textContent || "").trim() !== label) button.textContent = label;
    button.setAttribute("aria-label", label);
    button.classList.toggle("lb-generate-mobile", mobile);
  }

'''
if anchor not in s:
    raise SystemExit('Ancre isMobileLayout introuvable')
s = s.replace(anchor, insert, 1)

old_init = '''    watchTrainTable();
    watchSecondaryNavigation();
    syncViewport();

'''
new_init = '''    watchTrainTable();
    watchSecondaryNavigation();
    syncGenerateButton();
    syncViewport();

'''
if old_init not in s:
    raise SystemExit('Ancre init mobile introuvable')
s = s.replace(old_init, new_init, 1)

old_change = '''    mobileQuery.addEventListener?.("change", () => {
      removeCompactMoreMenu();
      syncViewport();
    });
'''
new_change = '''    mobileQuery.addEventListener?.("change", () => {
      removeCompactMoreMenu();
      syncGenerateButton();
      syncViewport();
    });
'''
if old_change not in s:
    raise SystemExit('Ancre media change introuvable')
s = s.replace(old_change, new_change, 1)

p.write_text(s, encoding='utf-8')

# ---------------- assets/lb-mobile-v4.css ----------------
p = Path('assets/lb-mobile-v4.css')
s = p.read_text(encoding='utf-8')
old_css = '''/* LB mobile: centrage bouton Générer le tableau */
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
new_css = '''/* LB mobile: action finale compacte, jaune et libellé court */
@media (max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px) {
  body.lb-v3 #search #loadTrains,
  body.lb-v3 #search #loadTrains.lb-generate-mobile {
    min-width: 142px !important;
    min-height: 44px !important;
    padding: 9px 18px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    text-align: center !important;
    font-family: "Rajdhani", system-ui, sans-serif !important;
    font-size: 0.9rem !important;
    font-weight: 900 !important;
    line-height: 1 !important;
    color: #241800 !important;
    border: 1px solid rgba(255, 224, 92, .96) !important;
    border-radius: 12px !important;
    background: linear-gradient(135deg, #ffe45c 0%, #ffc21a 54%, #f5a900 100%) !important;
    box-shadow: 0 0 0 1px rgba(255, 197, 26, .18), 0 5px 16px rgba(255, 181, 0, .24) !important;
    text-shadow: none !important;
  }
}
'''
if old_css not in s:
    raise SystemExit('Ancien patch #loadTrains introuvable')
s = s.replace(old_css, new_css, 1)
p.write_text(s, encoding='utf-8')

print('Patch terminal GTFS + bouton mobile appliqué')
