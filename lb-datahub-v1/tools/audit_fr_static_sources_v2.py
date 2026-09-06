#!/usr/bin/env python3
"""Audit V2 en lecture seule des sources statiques SNCF du futur LB Rail Engine.

Objectifs :
- ne jamais toucher à la production La Bétaillère ;
- utiliser Explore API 2.1 en priorité ;
- basculer vers l'API Opendatasoft legacy pour compteur/échantillon si nécessaire ;
- lire récursivement les schémas pour éviter les faux négatifs ;
- ne pas considérer geo_shape/geo_point comme des clés de jointure métier.

Sorties : report.json, report.md, join-matrix.json.
Aucune dépendance Python externe.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

USER_AGENT = "LB-Rail-Engine-Static-Audit/2.0 (+https://www.labetaillere.fr/)"
TIMEOUT = 25

JOIN_KEYS = {
    "code_ligne", "rg_troncon", "code_uic", "uic", "pk", "pkd", "pkf",
    "idgaia", "idreseau", "id_gare", "idgare", "trigramme"
}
GEOMETRY_FIELDS = {"geo_shape", "geo_point_2d", "x_wgs84", "y_wgs84", "x_l93", "y_l93"}


def norm(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_").replace("__", "_")


def http_json(url: str, retries: int = 3) -> tuple[Any, int]:
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        started = time.perf_counter()
        req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urlopen(req, timeout=TIMEOUT) as r:
                payload = json.loads(r.read().decode("utf-8"))
                return payload, int((time.perf_counter() - started) * 1000)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            if attempt < retries:
                time.sleep(attempt)
    raise RuntimeError(f"GET impossible: {url}: {last}")


def safe_get(obj: Any, *path: str, default: Any = None) -> Any:
    cur = obj
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


def recursively_collect_schema_fields(obj: Any) -> set[str]:
    """Collecte prudente des noms de champs depuis fields/properties de schémas ODS."""
    out: set[str] = set()

    def walk(node: Any, parent_key: str = "") -> None:
        if isinstance(node, dict):
            # Schéma JSON : properties = noms de champs.
            props = node.get("properties")
            if isinstance(props, dict):
                for key in props:
                    n = norm(key)
                    if n and n not in {"records", "fields", "geometry", "geolocation"}:
                        out.add(n)
            # Schéma Explore : fields = [{name/id/...}].
            fields = node.get("fields")
            if isinstance(fields, list):
                for f in fields:
                    if isinstance(f, dict):
                        name = f.get("name") or f.get("id") or f.get("field_name")
                        if name:
                            out.add(norm(name))
            for key, value in node.items():
                walk(value, key)
        elif isinstance(node, list):
            for item in node:
                walk(item, parent_key)

    walk(obj)
    return {x for x in out if x}


def extract_v21_sample_fields(payload: Any) -> tuple[set[str], dict[str, Any] | None]:
    if not isinstance(payload, dict):
        return set(), None
    results = payload.get("results")
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        return set(), None
    rec = results[0]
    return {norm(k) for k in rec}, rec


def extract_legacy_sample_fields(payload: Any) -> tuple[set[str], dict[str, Any] | None]:
    if not isinstance(payload, dict):
        return set(), None
    records = payload.get("records")
    if not isinstance(records, list) or not records or not isinstance(records[0], dict):
        return set(), None
    fields = records[0].get("fields")
    if not isinstance(fields, dict):
        return set(), None
    return {norm(k) for k in fields}, fields


def extract_title(meta: Any, dataset_id: str) -> str:
    candidates = [
        safe_get(meta, "metas", "default", "title"),
        safe_get(meta, "dataset", "metas", "default", "title"),
        meta.get("title") if isinstance(meta, dict) else None,
    ]
    return next((str(x) for x in candidates if x), dataset_id)


def extract_modified(meta: Any) -> str | None:
    for path in [
        ("metas", "default", "data_processed"),
        ("metas", "default", "modified"),
        ("dataset", "metas", "default", "data_processed"),
        ("dataset", "metas", "default", "modified"),
    ]:
        value = safe_get(meta, *path)
        if value:
            return str(value)
    return None


def audit_source(v21_base: str, legacy_base: str, source: dict[str, Any]) -> dict[str, Any]:
    dataset_id = source["id"]
    root = f"{v21_base.rstrip('/')}/{dataset_id}"
    legacy = legacy_base.rstrip("/") + "/?" + urlencode({"dataset": dataset_id, "rows": 1})

    result: dict[str, Any] = {
        "id": dataset_id,
        "role": source.get("role"),
        "priority": source.get("priority"),
        "usage": source.get("usage"),
        "notes": source.get("notes"),
        "expected_join_keys": [norm(x) for x in source.get("expected_join_keys", [])],
        "status": "unavailable",
        "warnings": [],
        "errors": [],
        "api_latency_ms": {},
    }

    meta = v21_count = v21_sample = legacy_sample = None

    # 1) Metadata v2.1
    try:
        meta, ms = http_json(root)
        result["api_latency_ms"]["metadata_v21"] = ms
    except Exception as exc:
        result["errors"].append(f"metadata_v21: {exc}")

    # 2) Compteur v2.1 sans charger de géométrie.
    try:
        v21_count, ms = http_json(root + "/records?" + urlencode({"limit": 0}))
        result["api_latency_ms"]["count_v21"] = ms
    except Exception as exc:
        result["warnings"].append(f"count_v21: {exc}")

    # 3) Petit échantillon v2.1.
    try:
        v21_sample, ms = http_json(root + "/records?" + urlencode({"limit": 1}))
        result["api_latency_ms"]["sample_v21"] = ms
    except Exception as exc:
        result["warnings"].append(f"sample_v21: {exc}")

    # 4) Fallback legacy seulement si le compteur ou l'échantillon v2.1 est incomplet.
    need_legacy = not isinstance(v21_count, dict) or v21_count.get("total_count") is None
    need_legacy = need_legacy or not (isinstance(v21_sample, dict) and isinstance(v21_sample.get("results"), list))
    if need_legacy:
        try:
            legacy_sample, ms = http_json(legacy)
            result["api_latency_ms"]["sample_legacy"] = ms
        except Exception as exc:
            result["warnings"].append(f"sample_legacy: {exc}")

    schema_fields = recursively_collect_schema_fields(meta)
    v21_fields, v21_record = extract_v21_sample_fields(v21_sample)
    legacy_fields, legacy_record = extract_legacy_sample_fields(legacy_sample)
    fields = sorted(schema_fields | v21_fields | legacy_fields)

    count = None
    count_source = None
    if isinstance(v21_count, dict) and v21_count.get("total_count") is not None:
        count = v21_count.get("total_count")
        count_source = "v21"
    elif isinstance(v21_sample, dict) and v21_sample.get("total_count") is not None:
        count = v21_sample.get("total_count")
        count_source = "v21_sample"
    elif isinstance(legacy_sample, dict) and legacy_sample.get("nhits") is not None:
        count = legacy_sample.get("nhits")
        count_source = "legacy"

    # État : on ne dégrade plus un dataset pour un endpoint optionnel absent.
    records_accessible = bool(v21_record or legacy_record or count is not None)
    metadata_accessible = isinstance(meta, dict)
    if metadata_accessible and records_accessible and fields:
        status = "ok"
    elif (metadata_accessible or records_accessible) and fields:
        status = "partial"
    else:
        status = "unavailable"

    expected = set(result["expected_join_keys"])
    field_set = set(fields)
    result.update({
        "status": status,
        "title": extract_title(meta, dataset_id),
        "modified": extract_modified(meta),
        "record_count": count,
        "record_count_source": count_source,
        "field_count": len(fields),
        "fields": fields,
        "join_keys": sorted(field_set & JOIN_KEYS),
        "geometry_fields": sorted(field_set & GEOMETRY_FIELDS),
        "expected_keys_present": sorted(expected & field_set),
        "expected_keys_missing": sorted(expected - field_set),
        "sample_source": "v21" if v21_record else ("legacy" if legacy_record else None),
        "sample_values": {
            k: (v21_record or legacy_record or {}).get(k)
            for k in sorted((field_set & JOIN_KEYS))
            if k in (v21_record or legacy_record or {})
        },
        "api_urls": {"metadata_v21": root, "records_v21": root + "/records", "legacy": legacy},
    })
    return result


def build_join_matrix(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, left in enumerate(sources):
        lf = set(left.get("fields") or [])
        for right in sources[i + 1:]:
            rf = set(right.get("fields") or [])
            joins = sorted((lf & rf) & JOIN_KEYS)
            out.append({
                "left": left["id"],
                "right": right["id"],
                "common_join_keys": joins,
                "recommended": bool(joins),
            })
    return out


def make_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Audit FR_STATIC_ENGINE_V1 — V2", "",
        f"Généré : `{report['generated_at']}`", "",
        "> Lecture seule : aucune modification de production.", "",
        "## Sources", "",
        "| Dataset | Rôle | Enregistrements | Source compteur | Champs | Clés métier | Géométrie | État |",
        "|---|---|---:|---|---:|---|---|---|",
    ]
    for src in report["sources"]:
        joins = ", ".join(src.get("join_keys") or []) or "—"
        geo = ", ".join(src.get("geometry_fields") or []) or "—"
        count = src.get("record_count") if src.get("record_count") is not None else "?"
        lines.append(
            f"| `{src['id']}` | `{src.get('role') or ''}` | {count} | "
            f"{src.get('record_count_source') or '—'} | {src.get('field_count', 0)} | {joins} | {geo} | **{src.get('status')}** |"
        )

    lines += ["", "## Clés attendues absentes", ""]
    missing = False
    for src in report["sources"]:
        vals = src.get("expected_keys_missing") or []
        if vals:
            missing = True
            lines.append(f"- `{src['id']}` : {', '.join(vals)}")
    if not missing:
        lines.append("Aucune clé attendue absente.")

    lines += ["", "## Jointures métier possibles", ""]
    useful = [x for x in report["join_matrix"] if x["common_join_keys"]]
    useful.sort(key=lambda x: (-len(x["common_join_keys"]), x["left"], x["right"]))
    for item in useful:
        lines.append(f"- `{item['left']}` ↔ `{item['right']}` : **{', '.join(item['common_join_keys'])}**")
    if not useful:
        lines.append("Aucune jointure métier détectée.")

    lines += ["", "## Endpoints réellement dégradés", ""]
    had = False
    for src in report["sources"]:
        warns = src.get("warnings") or []
        errs = src.get("errors") or []
        if warns or errs:
            had = True
            lines.append(f"### `{src['id']}`")
            for msg in errs:
                lines.append(f"- ERREUR : `{msg}`")
            for msg in warns:
                lines.append(f"- fallback : `{msg}`")
            lines.append("")
    if not had:
        lines.append("Aucun endpoint dégradé.")

    lines += [
        "", "## Décision d'architecture", "",
        "1. `formes-des-lignes-du-rfn` = couche nationale légère.",
        "2. `fichier-de-formes-des-voies-du-reseau-ferre-national` = couche fine régionale/locale.",
        "3. `code_ligne` + `rg_troncon` = pivot topologique principal ; `idgaia` sert d'identifiant complémentaire.",
        "4. Les géométries ne sont jamais traitées comme des clés de jointure.",
        "5. Les gares s'adossent à `code_uic`/`idgaia`/`pk`, puis au GTFS via un mapping canonique.",
        "6. Les quais restent un enrichissement ; les station-overrides actuels restent prioritaires pour les voies fines de gare.",
        "7. GTFS, infrastructure et index J/J+1 restent trois couches séparées.",
        "8. Aucun fichier national lourd ne sera nécessaire au premier affichage de la carte.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    config_path = Path(args.config).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    v21 = cfg["api_base"]
    legacy = "https://ressources.data.sncf.com/api/records/1.0/search"

    audited = []
    print(f"Audit V2 SNCF statique FR — {len(cfg['sources'])} source(s)")
    for idx, source in enumerate(cfg["sources"], 1):
        print(f"[{idx}/{len(cfg['sources'])}] {source['id']} ...", flush=True)
        audited.append(audit_source(v21, legacy, source))

    matrix = build_join_matrix(audited)
    report = {
        "schema_version": 2,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "config_sha256": hashlib.sha256(config_path.read_bytes()).hexdigest(),
        "sources": audited,
        "join_matrix": matrix,
    }
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "join-matrix.json").write_text(json.dumps(matrix, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "report.md").write_text(make_markdown(report), encoding="utf-8")

    ok = sum(1 for x in audited if x["status"] == "ok")
    partial = sum(1 for x in audited if x["status"] == "partial")
    unavailable = sum(1 for x in audited if x["status"] == "unavailable")
    print(f"OK={ok} PARTIAL={partial} UNAVAILABLE={unavailable}")
    print(out / "report.md")
    return 2 if unavailable else 0


if __name__ == "__main__":
    raise SystemExit(main())
