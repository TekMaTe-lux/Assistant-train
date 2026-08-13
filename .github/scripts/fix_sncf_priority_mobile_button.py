from pathlib import Path

# ---- index.html ----
p = Path('index.html')
s = p.read_text(encoding='utf-8')

# SNCF impacted-stop rendering must win over GTFS-RT for cells that already
# carry explicit SNCF amended times / partial-service terminal semantics.
old = '''      const baseTimeRaw = cell.dataset.baseTime || null;
      const canOverrideStaleSncfSuppression = gtfsSaysRunning && Number.isFinite(retardMinutes) && baseTimeRaw;
'''
new = '''      const storedSncfHtml = cell.__gtfsOriginalContent || '';
      const hasExplicitSncfRealtime =
        cell.dataset.terminalArrival === '1' ||
        cell.dataset.terminalStart === '1' ||
        !!cell.querySelector('.delay-stack') ||
        (typeof storedSncfHtml === 'string' && storedSncfHtml.includes('delay-stack'));

      if (hasExplicitSncfRealtime) {
        // Le rendu SNCF contient déjà l'heure théorique + l'heure amendée.
        // Ne pas laisser GTFS-RT recolorer/remplacer ces données explicites.
        if (cell.__gtfsOriginalContent != null) resetGtfsRetards(cell);
        continue;
      }

      const baseTimeRaw = cell.dataset.baseTime || null;
      const canOverrideStaleSncfSuppression = gtfsSaysRunning && Number.isFinite(retardMinutes) && baseTimeRaw;
'''
if old not in s:
    raise SystemExit('Ancre applyRetardsFromGTFS introuvable')
s = s.replace(old, new, 1)

# Cache-bust mobile assets so Safari/PWA cannot keep the previous patch.
if './assets/lb-mobile-v4.css?v=10' not in s:
    raise SystemExit('CSS mobile v10 introuvable')
s = s.replace('./assets/lb-mobile-v4.css?v=10', './assets/lb-mobile-v4.css?v=11', 1)
if './assets/lb-mobile-v4.js?v=5' not in s:
    raise SystemExit('JS mobile v5 introuvable')
s = s.replace('./assets/lb-mobile-v4.js?v=5', './assets/lb-mobile-v4.js?v=6', 1)
p.write_text(s, encoding='utf-8')

# ---- assets/lb-mobile-v4.js ----
p = Path('assets/lb-mobile-v4.js')
s = p.read_text(encoding='utf-8')
old = '''  function syncGenerateButton() {
    const button = document.getElementById("loadTrains");
    if (!button) return;
    const mobile = isMobileLayout();
    const label = mobile ? "Générer" : "Générer le tableau";
    if ((button.textContent || "").trim() !== label) button.textContent = label;
    button.setAttribute("aria-label", label);
    button.classList.toggle("lb-generate-mobile", mobile);
  }
'''
new = '''  function syncGenerateButton() {
    const button = document.getElementById("loadTrains");
    if (!button) return;
    const label = "Générer le tableau";
    if ((button.textContent || "").trim() !== label) button.textContent = label;
    button.setAttribute("aria-label", label);
    button.classList.toggle("lb-generate-mobile", isMobileLayout());
  }
'''
if old not in s:
    raise SystemExit('Bloc syncGenerateButton introuvable')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# ---- assets/lb-mobile-v4.css ----
p = Path('assets/lb-mobile-v4.css')
s = p.read_text(encoding='utf-8')
old = '''/* LB mobile: action finale compacte, jaune et libellé court */
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
new = '''/* LB mobile: bouton Générer le tableau réellement centré dans la modale */
@media (max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 900px) {
  body.lb-v3 #selectionModal #selectionFooter,
  body.lb-v3 #selectionFooter.chips-footer.centered {
    width: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
  }

  body.lb-v3 #selectionModal #selectionFooter .lb-sticky-actions,
  body.lb-v3 #selectionFooter .lb-sticky-actions {
    position: static !important;
    width: 100% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    margin: 0 auto !important;
    padding: 0 !important;
    background: transparent !important;
    border: 0 !important;
  }

  body.lb-v3 #selectionModal #loadTrains,
  body.lb-v3 #selectionFooter #loadTrains {
    flex: 0 0 auto !important;
    width: 180px !important;
    max-width: 100% !important;
    min-height: 44px !important;
    margin: 0 auto !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    text-align: center !important;
    line-height: 1.1 !important;
  }
}
'''
if old not in s:
    raise SystemExit('Ancien patch mobile #loadTrains introuvable')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

print('Patch SNCF priority + mobile button applied')
