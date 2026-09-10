#!/usr/bin/env bash
set -euo pipefail

SERVER="${LB_AUTH_SERVER:-/opt/labetaillere-auth/server.js}"

printf '%s\n' '============================================================'
printf '%s\n' ' AUDIT COMMUNAUTE — DELETE / AUTH / OWNERSHIP V2'
printf '%s\n' ' LECTURE SEULE — AUCUNE MODIFICATION / AUCUN APPEL DELETE'
printf '%s\n' '============================================================'
printf '\n'

if [[ ! -f "$SERVER" ]]; then
  echo "ERREUR: serveur introuvable: $SERVER" >&2
  exit 2
fi

printf '%s\n' '=== 1. FICHIER ==='
sha256sum "$SERVER"
stat -c 'taille=%s octets  mtime=%y  owner=%U:%G  mode=%a' "$SERVER"
printf '\n'

python3 - "$SERVER" <<'PY'
from pathlib import Path
import re, sys

p = Path(sys.argv[1])
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()

patterns = [
    ('SESSION / AUTH HELPERS', re.compile(r'\b(requireAuth|getSession|sessionUser|currentUser|authUser|readSession|resolveSession|optionalAuth|requireUser)\b', re.I)),
    ('GET COMMENTS', re.compile(r'app\.get\s*\(\s*["\']/api/comments["\']')),
    ('POST COMMENT', re.compile(r'app\.post\s*\(\s*["\']/api/comments["\']')),
    ('POST VOTE', re.compile(r'app\.post\s*\(\s*["\']/api/comments/:id/vote["\']')),
    ('DELETE COMMENT', re.compile(r'app\.delete\s*\(\s*["\']/api/comments/:id["\']')),
    ('AUTH IDENTITY ENDPOINTS', re.compile(r'app\.get\s*\(\s*["\']/api/(?:auth|account|profile|me)[^"\']*["\']', re.I)),
]

seen_ranges = []

def print_block(title, idx, before=14, after=54):
    lo = max(0, idx-before)
    hi = min(len(lines), idx+after+1)
    # Evite de répéter exactement le même gros bloc.
    key = (lo, hi)
    if key in seen_ranges:
        return
    seen_ranges.append(key)
    print(f'--- {title} — autour de L{idx+1} (L{lo+1}-L{hi})')
    for n in range(lo, hi):
        text = lines[n]
        # Par prudence, masque uniquement les littéraux manifestement sensibles.
        text = re.sub(r'(?i)(password|secret|token)\s*[:=]\s*["\'][^"\']+["\']', r'\1="***MASQUE***"', text)
        print(f'{n+1:5d}: {text}')
    print()

for title, rx in patterns:
    matches = [i for i, line in enumerate(lines) if rx.search(line)]
    print(f'=== {title} ===')
    if not matches:
        print('AUCUNE OCCURRENCE')
        print()
        continue
    # Helpers peuvent matcher plusieurs fois : maximum 3 blocs utiles.
    limit = 3 if title == 'SESSION / AUTH HELPERS' else 6
    for idx in matches[:limit]:
        print_block(title, idx)

print('=== 2. CHAMPS COMMENTS / VOTES ===')
for i, line in enumerate(lines):
    if re.search(r'CREATE TABLE IF NOT EXISTS (comments|comment_votes)', line, re.I):
        lo=i
        hi=min(len(lines), i+48)
        print(f'--- autour de L{i+1}')
        for n in range(lo, hi):
            print(f'{n+1:5d}: {lines[n]}')
            if n>i and lines[n].strip().startswith(');'):
                break
        print()

print('=== 3. INDICES OWNERSHIP DANS LES ROUTES ===')
needles = ('user_id', 'author_user_pk', 'account_id', 'req.user', 'session', 'DELETE FROM comments', 'comment_votes', 'my_vote')
for i, line in enumerate(lines, 1):
    if any(x.lower() in line.lower() for x in needles):
        if 250 <= i <= len(lines):
            print(f'{i:5d}: {line}')
PY

printf '\n%s\n' '============================================================'
printf '%s\n' ' FIN AUDIT V2 — AUCUNE MODIFICATION EFFECTUEE'
printf '%s\n' '============================================================'
