from pathlib import Path

path = Path("assets/lb-design-system-v3.css")
text = path.read_text(encoding="utf-8")

block = '''body.lb-v3.page-home:not(.monde-betaillere) #home .home-dashboard > .home-punct-card #homePunctCardTitle {
  margin: 0 0 10px !important;
  min-height: 1.2em !important;
  font-size: clamp(1.05rem, 1.35vw, 1.28rem) !important;
  line-height: 1.2 !important;
}

'''

count = text.count(block)
if count != 1:
    raise SystemExit(f"Expected exactly one punctuality title override, found {count}")

text = text.replace(block, "", 1)

if "#homePunctCardTitle" in text:
    raise SystemExit("A specific #homePunctCardTitle override still remains")
if text.count("{") != text.count("}"):
    raise SystemExit("CSS brace count is unbalanced")

path.write_text(text, encoding="utf-8")
