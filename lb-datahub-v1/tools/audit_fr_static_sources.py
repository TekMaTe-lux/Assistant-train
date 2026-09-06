#!/usr/bin/env python3
"""Audit en lecture seule des sources statiques SNCF Open Data.

Ce script NE MODIFIE PAS la production La Bétaillère et NE télécharge PAS les gros
fichiers de données. Il interroge uniquement les métadonnées/API du portail SNCF,
prélève au plus un enregistrement par dataset, inventorie les pièces jointes/formats
et produit :
  - report.json : résultat machine lisible ;
  - report.md   : synthèse lisible ;
  - join-matrix.json : clés communes détectées entre datasets.

Usage :
  python3 audit_fr_static_sources.py \
      --config ../config/fr-static-sources.json \
      --out /tmp/lb-fr-static-audit

Aucune dépendance Python externe : bibliothèque standard uniquement.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

USER_AGENT = "LB-Rail-Engine-Static-Audit/1.0 (+https://www.labetaillere.fr/)"
TIMEOUT = 25

# Clés particulièrement intéressantes pour le rapprochement des référentiels RFN.
KNOWN_JOIN_KEYS = {
    "code_ligne",
    "rg_troncon",
    "code_uic",
    "uic",
    "pk",
    "pkd",
    "pkf",
    "idgaia",
    "idreseau",
    "id_gare",
    "idgare",
    "trigramme",
    "geo_shape",
    "geo_point_2d",
}


def normalize_field(name: str) -> str:
    return (
        str(name or "")
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
        .replace("__", "_")
    )


def http_json(url: str, retries: int = 3) -> tuple[Any, dict[str, str], int]:
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        started = time.perf_counter()
        try:
            with urlopen(req, timeout=TIMEOUT) as response:
                raw = response.read()
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                headers = {k.lower(): v for k, v in response.headers.items()}
                return json.loads(raw.decode("utf-8")), headers, elapsed_ms
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(attempt)
    raise RuntimeError(f"GET JSON impossible après {retries} tentative(s): {url}: {last_exc}")


def safe_get(obj: Any, *path: str, default: Any = None) -> Any:
    cur = obj
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


def collect_field_names(meta: Any, sample: Any) -> list[str]:
    names: set[str] = set()

    # Explore API v2.1 peut exposer les champs à différents niveaux selon la version.
    candidates = []
    if isinstance(meta, dict):
        candidates.extend([
            meta.get("fields"),
            safe_get(meta, "dataset", "fields"),
            safe_get(meta, "metas", "default", "fields"),
        ])
    for fields in candidates:
        if isinstance(fields, list):
            for field in fields:
                if isinstance(field, dict):
                    name = field.get("name") or field.get("id") or field.get("field_name")
                    if name:
                        names.add(normalize_field(name))

    if isinstance(sample, dict):
        results = sample.get("results")
        if isinstance(results, list) and results and isinstance(results[0], dict):
            names.update(normalize_field(k) for k in results[0].keys())

    return sorted(x for x in names if x)


def extract_title(meta: Any, dataset_id: str) -> str:
    options = [
        safe_get(meta, "metas", "default", "title"),
        safe_get(meta, "dataset", "metas", "default", "title"),
        meta.get("title") if isinstance(meta, dict) else None,
    ]
    return next((str(x) for x in options if x), dataset_id)


def extract_modified(meta: Any) -> str | None:
    paths = [
        ("metas", "default", "modified"),
        ("metas", "default", "data_processed"),
        ("dataset", "metas", "default", "modified"),
        ("dataset", "metas", "default", "data_processed"),
    ]
    for path in paths:
        value = safe_get(meta, *path)
        if value:
            return str(value)
    return None


def extract_attachments(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    raw = payload.get("attachments") or payload.get("results") or []
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        filename = item.get("title") or item.get("name") or item.get("filename") or item.get("id")
        url = item.get("url") or item.get("href")
        size = item.get("file_size") or item.get("filesize") or item.get("size")
        mimetype = item.get("mimetype") or item.get("mime_type") or item.get("content_type")
        out.append({
            "name": filename,
            "size": size,
            "mimetype": mimetype,
            "url": url,
        })
    return out


def extract_export_formats(payload: Any) -> list[str]:
    formats: set[str] = set()
    if isinstance(payload, dict):
        raw = payload.get("links") or payload.get("exports") or payload.get("results") or []
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    for key in ("rel", "type", "format", "name"):
                        value = item.get(key)
                        if isinstance(value, str) and value:
                            low = value.lower()
                            for fmt in ("csv", "json", "jsonl", "geojson", "shp", "parquet", "kml", "gpx"):
                                if fmt in low:
                                    formats.add(fmt)
    return sorted(formats)


def audit_source(api_base: str, source: dict[str, Any]) -> dict[str, Any]:
    dataset_id = source["id"]
    root = f"{api_base.rstrip('/')}/{dataset_id}"
    result: dict[str, Any] = {
        "id": dataset_id,
        "role": source.get("role"),
        "priority": source.get("priority"),
        "usage": source.get("usage"),
        "expected_join_keys": [normalize_field(x) for x in source.get("expected_join_keys", [])],
        "notes": source.get("notes"),
        "status": "ok",
        "errors": [],
    }

    meta = sample = attachments = exports = None
    latencies: dict[str, int] = {}

    endpoints = {
        "metadata": root,
        "sample": root + "/records?" + urlencode({"limit": 1}),
        "attachments": root + "/attachments",
        "exports": root + "/exports",
    }
    for name, url in endpoints.items():
        try:
            payload, headers, elapsed_ms = http_json(url)
            latencies[name] = elapsed_ms
            if name == "metadata":
                meta = payload
            elif name == "sample":
                sample = payload
            elif name == "attachments":
                attachments = payload
            elif name == "exports":
                exports = payload
        except Exception as exc:
            # Un endpoint optionnel (attachments/exports) peut être absent ; on conserve l'audit.
            result["errors"].append(f"{name}: {exc}")
            if name in {"metadata", "sample"}:
                result["status"] = "degraded"

    fields = collect_field_names(meta, sample)
    detected_join_keys = sorted(set(fields) & KNOWN_JOIN_KEYS)
    expected = set(result["expected_join_keys"])

    total_count = sample.get("total_count") if isinstance(sample, dict) else None
    result.update({
        "title": extract_title(meta, dataset_id),
        "modified": extract_modified(meta),
        "record_count": total_count,
        "field_count": len(fields),
        "fields": fields,
        "detected_join_keys": detected_join_keys,
        "expected_keys_present": sorted(expected & set(fields)),
        "expected_keys_missing": sorted(expected - set(fields)),
        "attachments": extract_attachments(attachments),
        "export_formats": extract_export_formats(exports),
        "api_latency_ms": latencies,
        "api_urls": endpoints,
    })
    return result


def build_join_matrix(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    matrix = []
    for i, left in enumerate(sources):
        left_fields = set(left.get("fields") or [])
        for right in sources[i + 1 :]:
            right_fields = set(right.get("fields") or [])
            common_all = sorted(left_fields & right_fields)
            common_join = sorted((left_fields & right_fields) & KNOWN_JOIN_KEYS)
            matrix.append({
                "left": left["id"],
                "right": right["id"],
                "common_join_keys": common_join,
                "common_field_count": len(common_all),
                "recommended": bool(common_join),
            })
    return matrix


def human_size(value: Any) -> str:
    try:
        size = float(value)
    except (TypeError, ValueError):
        return "?"
    units = ["o", "Ko", "Mo", "Go"]
    idx = 0
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024
        idx += 1
    return f"{size:.1f} {units[idx]}"


def make_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Audit FR_STATIC_ENGINE_V1",
        "",
        f"Généré : `{report['generated_at']}`",
        "",
        "> Audit en lecture seule. Aucun fichier de production La Bétaillère n'est modifié.",
        "",
        "## Sources",
        "",
        "| Dataset | Rôle | Enregistrements | Champs | Clés détectées | Attachements | État |",
        "|---|---|---:|---:|---|---:|---|",
    ]
    for src in report["sources"]:
        keys = ", ".join(src.get("detected_join_keys") or []) or "—"
        lines.append(
            f"| `{src['id']}` | `{src.get('role') or ''}` | "
            f"{src.get('record_count') if src.get('record_count') is not None else '?'} | "
            f"{src.get('field_count', 0)} | {keys} | {len(src.get('attachments') or [])} | {src.get('status')} |"
        )

    lines.extend(["", "## Clés attendues absentes", ""])
    missing_any = False
    for src in report["sources"]:
        missing = src.get("expected_keys_missing") or []
        if missing:
            missing_any = True
            lines.append(f"- `{src['id']}` : {', '.join(missing)}")
    if not missing_any:
        lines.append("Toutes les clés attendues observables dans les échantillons/métadonnées ont été retrouvées.")

    lines.extend(["", "## Pièces jointes / tailles déclarées", ""])
    found_attachment = False
    for src in report["sources"]:
        for att in src.get("attachments") or []:
            found_attachment = True
            lines.append(
                f"- `{src['id']}` — {att.get('name') or '?'} — {human_size(att.get('size'))} — "
                f"{att.get('mimetype') or '?'}"
            )
    if not found_attachment:
        lines.append("Aucune taille de pièce jointe exposée par les endpoints inspectés.")

    lines.extend(["", "## Jointures intéressantes détectées", ""])
    useful = [x for x in report["join_matrix"] if x.get("common_join_keys")]
    useful.sort(key=lambda x: (-len(x["common_join_keys"]), x["left"], x["right"]))
    for item in useful:
        lines.append(
            f"- `{item['left']}` ↔ `{item['right']}` : **{', '.join(item['common_join_keys'])}**"
        )
    if not useful:
        lines.append("Aucune clé de jointure connue détectée automatiquement.")

    lines.extend([
        "",
        "## Règles d'architecture proposées",
        "",
        "1. `formes-des-lignes-du-rfn` = fond national léger / zoom France.",
        "2. `fichier-de-formes-des-voies-du-reseau-ferre-national` = géométrie fine, chargée seulement lorsque nécessaire.",
        "3. `liste-des-gares` + `gares-de-voyageurs` = référentiel gare, jointure prioritaire par UIC.",
        "4. `liste-des-quais` = enrichissement gare ; ne remplace jamais les station-overrides locaux.",
        "5. `lignes-par-type` + `regime-dexploitation-des-lignes` = topologie et contrôle de routage.",
        "6. `vitesse-maximale-nominale-sur-ligne` = garde-fou de plausibilité, jamais vitesse réelle affichée.",
        "7. Infrastructure, horaires GTFS et calendrier J/J+1 restent trois couches indépendantes.",
        "8. Aucun gros GeoJSON national ne doit être sur le chemin critique d'ouverture de la carte.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit read-only des sources statiques SNCF France")
    parser.add_argument("--config", required=True, help="Chemin vers fr-static-sources.json")
    parser.add_argument("--out", default="/tmp/lb-fr-static-audit", help="Répertoire de sortie")
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    out_dir = Path(args.out).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    api_base = config["api_base"]
    sources_cfg = config["sources"]

    out_dir.mkdir(parents=True, exist_ok=True)

    audited = []
    print(f"Audit SNCF statique FR — {len(sources_cfg)} source(s)")
    for idx, source in enumerate(sources_cfg, 1):
        print(f"[{idx}/{len(sources_cfg)}] {source['id']} ...", flush=True)
        audited.append(audit_source(api_base, source))

    matrix = build_join_matrix(audited)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    report = {
        "schema_version": 1,
        "generated_at": now,
        "config_sha256": hashlib.sha256(config_path.read_bytes()).hexdigest(),
        "api_base": api_base,
        "source_count": len(audited),
        "sources": audited,
        "join_matrix": matrix,
    }

    report_json = out_dir / "report.json"
    report_md = out_dir / "report.md"
    matrix_json = out_dir / "join-matrix.json"
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    matrix_json.write_text(json.dumps(matrix, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report_md.write_text(make_markdown(report), encoding="utf-8")

    degraded = [x for x in audited if x.get("status") != "ok"]
    print()
    print(f"Rapport JSON : {report_json}")
    print(f"Rapport MD   : {report_md}")
    print(f"Matrice      : {matrix_json}")
    print(f"Sources OK   : {len(audited) - len(degraded)}/{len(audited)}")
    if degraded:
        print("ATTENTION : certaines sources sont dégradées ; voir report.json")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
