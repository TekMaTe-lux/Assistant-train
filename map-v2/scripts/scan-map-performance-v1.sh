#!/usr/bin/env bash
set -u

ROOT="${LB_MAP_ROOT:-/opt/labetaillere-map-v2-src}"
PUBLIC="$ROOT/map-v2/public"
CORE="$PUBLIC/carte-core-preview.html"
WRAPPER="$PUBLIC/carte-preview.html"
MOBILE="$PUBLIC/carte-mobile-readonly.html"
V1="$PUBLIC/assets/lb-community-traveler-v1.js"
V2="$PUBLIC/assets/lb-community-traveler-compact-v2.js"
HOST="vps.labetaillere.fr"
BASE="https://$HOST"
TMP="$(mktemp -d /tmp/lb-map-scan-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

section(){ printf '\n===== %s =====\n' "$1"; }

bytes(){
  if [[ -f "$1" ]]; then
    stat -c '%s' "$1" 2>/dev/null || wc -c < "$1"
  else
    echo "ABSENT"
  fi
}

count_fixed(){
  local pat="$1" file="$2"
  if [[ -f "$file" ]]; then
    grep -oF "$pat" "$file" 2>/dev/null | wc -l | tr -d ' '
  else
    echo 0
  fi
}

curl_probe(){
  local label="$1" url="$2" mode="${3:-public}"
  local out="$TMP/body-$(echo "$label" | tr -cs 'A-Za-z0-9' '_')"
  local args=(curl -sS --compressed --max-time 25 -o "$out" -w 'code=%{http_code} dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download} speed=%{speed_download}B/s')
  if [[ "$mode" == "local" ]]; then
    args+=(--resolve "$HOST:443:127.0.0.1")
  fi
  args+=("$url")
  printf '%-34s ' "$label"
  "${args[@]}" 2>"$TMP/curl.err"
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    printf ' curl_rc=%s err=%s' "$rc" "$(tr '\n' ' ' < "$TMP/curl.err" | head -c 180)"
  fi
  printf '\n'
}

header_probe(){
  local label="$1" url="$2"
  echo "--- $label"
  curl -sS --compressed --max-time 20 -D - -o /dev/null "$url" 2>/dev/null \
    | grep -iE '^(HTTP/|content-length:|content-encoding:|content-type:|cache-control:|expires:|etag:|last-modified:|server:|age:|vary:)' \
    | tr -d '\r' || true
}

section "IDENTITE / ETAT MACHINE"
date -Is 2>/dev/null || date
printf 'Host: '; hostname
printf 'Kernel: '; uname -srmo
printf 'Uptime/load: '; uptime
printf 'CPU: '; nproc 2>/dev/null || true
free -h 2>/dev/null || true
df -h / "$ROOT" 2>/dev/null || true
printf 'Service map-v2: '; systemctl is-active labetaillere-map-v2.service 2>/dev/null || true
systemctl show labetaillere-map-v2.service -p MainPID -p MemoryCurrent -p TasksCurrent -p ExecMainStartTimestamp --no-pager 2>/dev/null || true

echo
ps -eo pid,comm,%cpu,%mem,rss,etime,args --sort=-%cpu 2>/dev/null | head -18 || true

section "TAILLE DES FICHIERS CRITIQUES"
for f in "$WRAPPER" "$CORE" "$MOBILE" "$V1" "$V2" \
         "$PUBLIC/data/carte_static_lite_today.json" \
         "$PUBLIC/v4-preview/data/snapshot.json"; do
  if [[ -f "$f" ]]; then
    printf '%12s bytes  %s\n' "$(bytes "$f")" "$f"
  else
    printf '%12s        %s\n' "ABSENT" "$f"
  fi
done

echo
printf '%s\n' 'Top 20 fichiers les plus lourds sous map-v2/public:'
find "$PUBLIC" -type f -printf '%s %p\n' 2>/dev/null | sort -nr | head -20 || true

section "CHRONO HTTP PUBLIC (3 PASSAGES)"
URLS=(
  "wrapper|$BASE/map-v2/carte-preview.html"
  "core|$BASE/map-v2/carte-core-preview.html"
  "mobile|$BASE/map-v2/carte-mobile-readonly.html"
  "community-v1|$BASE/map-v2/assets/lb-community-traveler-v1.js"
  "community-v2|$BASE/map-v2/assets/lb-community-traveler-compact-v2.js"
  "snapshot|$BASE/map-v2/v4-preview/data/snapshot.json"
  "lite-today|$BASE/map-v2/data/carte_static_lite_today.json"
  "api-trains-sillon|$BASE/api/map-v2/trains?bbox=5.70,48.45,6.35,49.65"
  "api-trains-nancy|$BASE/api/map-v2/trains?bbox=6.10,48.62,6.25,48.75"
  "api-infra-sillon|$BASE/api/map-v2/infrastructure?bbox=5.70,48.45,6.35,49.65"
)
for pass in 1 2 3; do
  echo "--- passage $pass"
  for item in "${URLS[@]}"; do
    label="${item%%|*}"; url="${item#*|}"
    curl_probe "$label" "$url" public
  done
  sleep 1
done

section "CHRONO NGINX LOCAL (ISOLE INTERNET/DNS)"
for item in "${URLS[@]}"; do
  label="${item%%|*}"; url="${item#*|}"
  curl_probe "local-$label" "$url" local
done

section "HEADERS / COMPRESSION / CACHE"
header_probe "core" "$BASE/map-v2/carte-core-preview.html"
header_probe "mobile" "$BASE/map-v2/carte-mobile-readonly.html"
header_probe "snapshot" "$BASE/map-v2/v4-preview/data/snapshot.json"
header_probe "api trains" "$BASE/api/map-v2/trains?bbox=5.70,48.45,6.35,49.65"

section "CHARGE JAVASCRIPT DANS LE CORE"
if [[ -f "$CORE" ]]; then
  printf 'script tags                    : %s\n' "$(grep -oi '<script\b' "$CORE" | wc -l | tr -d ' ')"
  printf 'fetch(                         : %s\n' "$(count_fixed 'fetch(' "$CORE")"
  printf 'setInterval(                   : %s\n' "$(count_fixed 'setInterval(' "$CORE")"
  printf 'setTimeout(                    : %s\n' "$(count_fixed 'setTimeout(' "$CORE")"
  printf 'requestAnimationFrame(         : %s\n' "$(count_fixed 'requestAnimationFrame(' "$CORE")"
  printf 'MutationObserver               : %s\n' "$(count_fixed 'MutationObserver' "$CORE")"
  printf 'getBoundingClientRect(         : %s\n' "$(count_fixed 'getBoundingClientRect(' "$CORE")"
  printf 'querySelectorAll(              : %s\n' "$(count_fixed 'querySelectorAll(' "$CORE")"
  printf 'L.geoJSON                      : %s\n' "$(count_fixed 'L.geoJSON' "$CORE")"
  printf 'JSON.parse(                    : %s\n' "$(count_fixed 'JSON.parse(' "$CORE")"
  printf 'LB_SERVICE_DAY_ROLLOVER_V2     : %s\n' "$(count_fixed 'LB_SERVICE_DAY_ROLLOVER_V2' "$CORE")"
  printf 'visual-stability lourd         : %s\n' "$(count_fixed 'lb-map-visual-stability-v1' "$CORE")"
fi

for f in "$V1" "$V2"; do
  [[ -f "$f" ]] || continue
  echo "--- $(basename "$f")"
  printf 'fetch=%s interval=%s mutation=%s RAF=%s qSA=%s rect=%s\n' \
    "$(count_fixed 'fetch(' "$f")" \
    "$(count_fixed 'setInterval(' "$f")" \
    "$(count_fixed 'MutationObserver' "$f")" \
    "$(count_fixed 'requestAnimationFrame(' "$f")" \
    "$(count_fixed 'querySelectorAll(' "$f")" \
    "$(count_fixed 'getBoundingClientRect(' "$f")"
done

section "APPELS DATA / API DECLARES DANS LE CORE"
if [[ -f "$CORE" ]]; then
  grep -nE 'fetch\(|/api/map-v2|snapshot\.json|carte_static|\.geojson|\.json' "$CORE" 2>/dev/null | head -160 || true
fi

section "DEPENDANCES EXTERNES"
python3 - "$CORE" "$WRAPPER" "$MOBILE" "$V1" "$V2" <<'PY'
from pathlib import Path
from urllib.parse import urlparse
import re, sys
hosts={}
for name in sys.argv[1:]:
    p=Path(name)
    if not p.exists(): continue
    text=p.read_text(encoding='utf-8',errors='ignore')
    for url in re.findall(r'https?://[^\s"\'<>`]+', text):
        host=urlparse(url).hostname or '?'
        hosts.setdefault(host,set()).add(str(p))
for host in sorted(hosts):
    print(f'{host:38} {len(hosts[host])} fichier(s)')
PY

echo
printf 'Références GitHub dans le runtime map: '
grep -RoiE 'github\.com|githubusercontent\.com' "$CORE" "$WRAPPER" "$MOBILE" "$V1" "$V2" 2>/dev/null | wc -l | tr -d ' '
echo

section "NGINX: GZIP/CACHE/PROXY"
if command -v nginx >/dev/null 2>&1; then
  nginx -T 2>/dev/null | grep -nE 'gzip|brotli|sendfile|tcp_nopush|open_file_cache|proxy_cache|proxy_buffer|expires|location .*map-v2|location .*api/map-v2|proxy_pass' | head -180 || true
else
  echo 'nginx non disponible dans PATH'
fi

section "PORTS / SERVICE"
ss -ltnp 2>/dev/null | head -60 || true
systemctl cat labetaillere-map-v2.service --no-pager 2>/dev/null | sed -n '1,160p' || true

section "JOURNAL SERVICE RECENT"
journalctl -u labetaillere-map-v2.service --since '-15 minutes' -n 100 --no-pager 2>/dev/null | tail -100 || true

section "DIAGNOSTIC AUTOMATIQUE SIMPLE"
core_bytes=0
[[ -f "$CORE" ]] && core_bytes="$(bytes "$CORE")"
if [[ "$core_bytes" =~ ^[0-9]+$ ]]; then
  if (( core_bytes > 2000000 )); then
    echo "ALERTE: core HTML > 2 MB ($core_bytes bytes): téléchargement + parsing JS potentiellement coûteux."
  elif (( core_bytes > 800000 )); then
    echo "A SURVEILLER: core HTML > 800 KB ($core_bytes bytes)."
  else
    echo "Core HTML taille raisonnable: $core_bytes bytes."
  fi
fi

github_refs=$(grep -RoiE 'github\.com|githubusercontent\.com' "$CORE" "$WRAPPER" "$MOBILE" "$V1" "$V2" 2>/dev/null | wc -l | tr -d ' ')
if [[ "${github_refs:-0}" == "0" ]]; then
  echo "GitHub: aucune dépendance runtime détectée dans les fichiers de carte testés."
else
  echo "GitHub: $github_refs référence(s) runtime détectée(s), à examiner ci-dessus."
fi

echo "SCAN_TERMINE — aucune modification n'a été effectuée."
