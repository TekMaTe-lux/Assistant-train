from pathlib import Path

path = Path('assets/lb-mobile-v4.css')
text = path.read_text(encoding='utf-8')
original = text

old = '''  body.lb-v3 #home .traffic-pill {
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
'''

new = '''  body.lb-v3 #home .traffic-pill {
    width: 96px !important;
    min-width: 96px !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 32px !important;
    margin: 0 !important;
    padding: 4px 9px 4px 7px !important;
    flex: 0 0 auto;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    justify-self: start !important;
    gap: 6px !important;
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
    line-height: 11px !important;
    letter-spacing: 0.03em !important;
    text-transform: uppercase !important;
    text-align: left !important;
    text-overflow: clip !important;
    white-space: normal !important;
    overflow-wrap: normal !important;
  }
'''

count = text.count(old)
if count != 1:
    raise SystemExit(f'traffic pill block: expected 1 match, found {count}')
text = text.replace(old, new, 1)

old_short = '''  body.lb-v3 #home .home-quick-presets__btn,
  body.lb-v3 #home .traffic-pill {
    min-height: 23px !important;
  }
'''
new_short = '''  body.lb-v3 #home .home-quick-presets__btn {
    min-height: 23px !important;
  }

  body.lb-v3 #home .traffic-pill {
    min-height: 30px !important;
  }
'''
count = text.count(old_short)
if count != 1:
    raise SystemExit(f'short-phone traffic override: expected 1 match, found {count}')
text = text.replace(old_short, new_short, 1)

if text == original:
    raise SystemExit('No CSS change produced')
if text.count('{') != text.count('}'):
    raise SystemExit('CSS brace count is unbalanced')

path.write_text(text, encoding='utf-8')
