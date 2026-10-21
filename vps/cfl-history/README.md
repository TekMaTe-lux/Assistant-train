# CFL/HAFAS stop history — isolated collector

Created 2026-10-21. This is independent of SNCF GTFS-RT statistics and does not call HAFAS: it ingests the existing rolling memory once per 120 seconds.

## Data
- Source (read-only): /var/lib/labetaillere-hafas/cfl-stop-state-v2.json
- Database (private): /var/lib/labetaillere-cfl-history/observations.sqlite3
- Report (private): /var/lib/labetaillere-cfl-history/summary.json
- Aggregate-only public report: https://vps.labetaillere.fr/gtfs/cfl-history/summary.json
- Public file written atomically to /var/www/gtfs/cfl-history/summary.json
- Service: labetaillere-cfl-history.service (oneshot)
- Timer: labetaillere-cfl-history.timer (120s)
- No modifications to /opt/labetaillere-stats-api or /var/www/stats/gtfsrt_history.jsonl.gz.

## Meaning of the data
Every stop is a last-observed HAFAS *prediction*, not a certified actual passage time. 6-minute rates are stop-level indicative metrics, NOT CFL official punctuality. Collection only begins on 2026-10-21 (memory at first import may cover some hours beforehand), and no earlier history was backfilled. A 30-day report is incomplete until 30 days have elapsed. The archive remains durable even after the source's 8-hour live retention expires.

Journey IDs are SHA-256 hashed with service_date before storage. Database writes are idempotent, and event records are added only on a changed delay, cancellation or platform.

## Quick checks
    systemctl list-timers --all | grep labetaillere-cfl-history
    journalctl -u labetaillere-cfl-history.service -n 30 --no-pager
    python3 -B /opt/labetaillere-cfl-history/recorder.py --self-test
    curl -fsS https://vps.labetaillere.fr/gtfs/cfl-history/summary.json
    systemctl is-active labetaillere-stats

## Stop only the new collector — no impact on SNCF
    sudo systemctl disable --now labetaillere-cfl-history.timer

Do not delete the database when disabling the timer. The existing SNCF API, statistics collector, historical GTFS-RT files, and HAFAS live pollers continue unchanged. The CFL-only frontend addition is in assets/lux-train-sheet.js (separate from SNCF train statistics).
