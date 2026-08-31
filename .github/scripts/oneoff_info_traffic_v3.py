from pathlib import Path

path = Path('assets/lb-mobile-v4.css')
text = path.read_text(encoding='utf-8')
original = text


def once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    text = text.replace(old, new, 1)


once(
'''  body.lb-v3 #home .traffic-split {
    width: 100% !important;
    min-height: 0 !important;
    flex: 1 1 auto !important;
    display: grid !important;
    grid-template-rows: repeat(2, minmax(0, 1fr)) !important;
    gap: 6px !important;
  }
''',
'''  body.lb-v3 #home .traffic-split {
    width: 100% !important;
    min-height: 0 !important;
    flex: 1 1 auto !important;
    display: grid !important;
    grid-template-rows: repeat(2, minmax(0, 1fr)) !important;
    gap: 8px !important;
  }
''',
'traffic split gap')

once(
'''  body.lb-v3 #home .traffic-split-row {
    width: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 6px 5px !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 5px !important;
    position: relative !important;
    isolation: isolate !important;
    border: 1px solid var(--traffic-line, rgba(126, 247, 255, 0.45)) !important;
    border-radius: 12px !important;
    background:
      radial-gradient(circle at 50% 12%, var(--traffic-glow, rgba(0, 240, 255, 0.17)), transparent 62%),
      linear-gradient(180deg, rgba(8, 32, 48, 0.9), rgba(2, 15, 27, 0.86)) !important;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.025),
      0 0 13px var(--traffic-glow, rgba(0, 240, 255, 0.17)) !important;
    text-align: center !important;
  }
''',
'''  body.lb-v3 #home .traffic-split-row {
    width: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 9px 34px 9px 52px !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: auto auto !important;
    align-content: center !important;
    align-items: center !important;
    justify-items: stretch !important;
    gap: 3px !important;
    position: relative !important;
    isolation: isolate !important;
    border: 1px solid rgba(75, 234, 246, 0.18) !important;
    border-left: 2px solid var(--traffic-line, rgba(75, 234, 246, 0.55)) !important;
    border-radius: 14px !important;
    background:
      linear-gradient(135deg, rgba(8, 37, 52, 0.68), rgba(2, 17, 28, 0.82)) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.025),
      0 6px 16px rgba(0, 0, 0, 0.14) !important;
    text-align: left !important;
  }
''',
'traffic row shell')

once(
'''  body.lb-v3 #home .traffic-split-row::before {
    z-index: -1 !important;
    opacity: 0.62 !important;
    background:
      radial-gradient(circle at 50% 20%, var(--traffic-glow, rgba(0, 240, 255, 0.18)), transparent 64%) !important;
  }
''',
'''  body.lb-v3 #home .traffic-split-row::before {
    content: "" !important;
    position: absolute !important;
    left: 9px !important;
    top: 50% !important;
    width: 32px !important;
    height: 38px !important;
    transform: translateY(-50%) !important;
    z-index: 1 !important;
    border: 1px solid rgba(75, 234, 246, 0.42) !important;
    border-radius: 10px !important;
    opacity: 0.9 !important;
    background:
      radial-gradient(circle at 50% 20%, #58e8f3 0 2px, transparent 2.5px),
      radial-gradient(circle at 50% 50%, #58e8f3 0 2px, transparent 2.5px),
      radial-gradient(circle at 50% 80%, #58e8f3 0 2px, transparent 2.5px),
      linear-gradient(#58e8f3, #58e8f3) center / 1px 62% no-repeat,
      rgba(3, 22, 34, 0.78) !important;
    box-shadow: inset 0 0 12px rgba(49, 231, 242, 0.06) !important;
    pointer-events: none !important;
  }
''',
'traffic route icon')

once(
'''  body.lb-v3 #home .traffic-split-row::after {
    left: 10px !important;
    right: 10px !important;
    bottom: 4px !important;
    z-index: 0 !important;
    background:
      linear-gradient(90deg, transparent, var(--traffic-line, rgba(126, 247, 255, 0.45)), transparent) !important;
    opacity: 0.72 !important;
  }
''',
'''  body.lb-v3 #home .traffic-split-row::after {
    display: none !important;
  }
''',
'remove traffic glow line')

once(
'''  body.lb-v3 #home .traffic-split-line {
    width: 100% !important;
    min-width: 0 !important;
    min-height: var(--lb-home-text-line) !important;
    padding: 0 !important;
    overflow: hidden !important;
    position: relative !important;
    z-index: 1 !important;
    font-family: var(--lb-font-body) !important;
    font-size: var(--lb-home-subtitle-size) !important;
    font-weight: 800 !important;
    line-height: var(--lb-home-text-line) !important;
    text-align: center !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }
''',
'''  body.lb-v3 #home .traffic-split-line {
    width: 100% !important;
    min-width: 0 !important;
    min-height: var(--lb-home-text-line) !important;
    padding: 0 !important;
    overflow: hidden !important;
    position: relative !important;
    z-index: 1 !important;
    color: var(--lb-text-soft) !important;
    font-family: var(--lb-font-body) !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    line-height: var(--lb-home-text-line) !important;
    text-align: left !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }
''',
'traffic route text')

once(
'''  body.lb-v3 #home .traffic-pill {
    width: auto !important;
    min-width: min(104px, 86%) !important;
    max-width: 100% !important;
    height: var(--lb-home-control-h) !important;
    min-height: var(--lb-home-control-h) !important;
    margin: 0 !important;
    padding: 4px 7px !important;
    flex: 0 0 auto;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
    position: relative !important;
    z-index: 1 !important;
    font-family: var(--lb-font-body) !important;
    font-size: var(--lb-home-control-size) !important;
    font-weight: 800 !important;
    line-height: var(--lb-home-control-line) !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }
''',
'''  body.lb-v3 #home .traffic-pill {
    width: max-content !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 22px !important;
    min-height: 22px !important;
    margin: 0 !important;
    padding: 2px 9px 2px 7px !important;
    flex: 0 0 auto;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    justify-self: start !important;
    gap: 5px !important;
    overflow: hidden !important;
    position: relative !important;
    z-index: 1 !important;
    border: 1px solid var(--traffic-line, rgba(75, 234, 246, 0.46)) !important;
    border-radius: 999px !important;
    background: rgba(3, 24, 32, 0.72) !important;
    color: var(--traffic-line, #7cefff) !important;
    box-shadow: none !important;
    font-family: var(--lb-font-body) !important;
    font-size: 10px !important;
    font-weight: 800 !important;
    line-height: 12px !important;
    letter-spacing: 0.035em !important;
    text-transform: uppercase !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }

  body.lb-v3 #home .traffic-pill::before {
    content: "" !important;
    width: 6px !important;
    height: 6px !important;
    flex: 0 0 6px !important;
    border-radius: 50% !important;
    background: currentColor !important;
    box-shadow: 0 0 7px currentColor !important;
  }

  body.lb-v3 #home .traffic-split-row .lb-traffic-row-chevron {
    right: 9px !important;
    width: 18px !important;
    height: 28px !important;
    color: rgba(126, 232, 243, 0.72) !important;
    font-size: 24px !important;
  }
''',
'traffic status chip')

if text == original:
    raise SystemExit('No CSS change produced')
if text.count('{') != text.count('}'):
    raise SystemExit('CSS brace count is unbalanced')
if 'radial-gradient(circle at 50% 12%' in text:
    raise SystemExit('Old traffic shell still present')
if 'body.lb-v3 #home .traffic-pill::before' not in text:
    raise SystemExit('New compact status indicator missing')

path.write_text(text, encoding='utf-8')
