#!/usr/bin/env bash
set -euo pipefail

BASE_COMMIT="3434013f18f0a3800cdd95e0692364cb4bc2e83a"
BASE_URL="https://raw.githubusercontent.com/TekMaTe-lux/Assistant-train/${BASE_COMMIT}/vps/map-v2/install-tgv-pagny-north-v1.sh"
TMP="$(mktemp -d /tmp/lb-tgv-pagny-v2.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

BASE="$TMP/base-v1.sh"
PATCHED="$TMP/install-v2.sh"

curl -fsSL "$BASE_URL" -o "$BASE"
cp "$BASE" "$PATCHED"

python3 - "$PATCHED" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
text = p.read_text(encoding="utf-8")

# Le contrôle V1 utilisait la distance au POINT TERMINAL du raccord 005340.
# Ce point est voisin de la LGV et un parcours correct par 005341 peut donc
# passer à quelques dizaines de mètres sans emprunter 005340 : faux positif.
# V2 valide le code de ligne réellement parcouru par Dijkstra avant simplification.
old = '''        nodes=graph.route_between_coords(ac,zc,profile)\n        if not nodes: return None\n        seg=b.simplify_collinear([graph.coords[n] for n in nodes])'''
new = '''        nodes=graph.route_between_coords(ac,zc,profile)\n        if not nodes: return None\n        if profile == 'tgv_pagny_north':\n            used_lines=set()\n            for u,v in zip(nodes,nodes[1:]):\n                for neighbour,attrs in graph.edges.get(u,()):\n                    if neighbour == v:\n                        code=str(attrs.get('line') or '')\n                        if code:\n                            used_lines.add(code)\n            if '005341' not in used_lines:\n                raise SystemExit(f'routage nord invalide {a.get("name")} -> {z.get("name")}: 005341 absent ; lignes={sorted(used_lines)}')\n            if '005340' in used_lines:\n                raise SystemExit(f'routage nord invalide {a.get("name")} -> {z.get("name")}: 005340 encore emprunté ; lignes={sorted(used_lines)}')\n        seg=b.simplify_collinear([graph.coords[n] for n in nodes])'''
if text.count(old) != 1:
    raise SystemExit(f"ancre build route: {text.count(old)} occurrence(s)")
text = text.replace(old, new, 1)

old = '''    if dn>0.30: raise SystemExit(f'{pid}: ne rejoint pas correctement 005341')\n    if ds<0.60: raise SystemExit(f'{pid}: passe encore trop près du raccord sud 005340')'''
new = '''    if dn>0.30: raise SystemExit(f'{pid}: ne rejoint pas correctement 005341')\n    # ds est uniquement informatif : le point terminal de 005340 est proche\n    # de la LGV et ne permet pas de savoir si 005340 a été réellement emprunté.\n    print(f'{pid}: proximité point terminal 005340={ds:.3f} km (informatif seulement)')'''
if text.count(old) != 1:
    raise SystemExit(f"ancre validation géométrique: {text.count(old)} occurrence(s)")
text = text.replace(old, new, 1)

old = "if dn>0.30 or ds<0.60: raise SystemExit('validation raccord TGV échouée')"
new = "if dn>0.30: raise SystemExit('validation raccord TGV échouée : 005341 non rejoint')"
if text.count(old) != 1:
    raise SystemExit(f"ancre validation API: {text.count(old)} occurrence(s)")
text = text.replace(old, new, 1)

text = text.replace(
    'TGV PARIS ↔ METZ/LUX — RACCORD NORD PAGNY/VANDIERES',
    'TGV PARIS ↔ METZ/LUX — RACCORD NORD PAGNY/VANDIERES V2',
    1,
)
text = text.replace(
    'echo "=== 2/5 Recalcul ciblé des TGV concernés ==="',
    'echo "=== 2/5 Recalcul ciblé + validation TOPOLOGIQUE 005341/005340 ==="',
    1,
)
text = text.replace(
    'echo "=== 3/5 Validation géométrique ==="',
    'echo "=== 3/5 Validation géométrique complémentaire ==="',
    1,
)

p.write_text(text, encoding="utf-8")
print("Installateur V2 préparé : validation par code de ligne, pas par proximité du point 005340")
PY

chmod +x "$PATCHED"
exec "$PATCHED"
