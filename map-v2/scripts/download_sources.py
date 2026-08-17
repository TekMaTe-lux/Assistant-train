#!/usr/bin/env python3
"""Télécharge les sources publiques nécessaires à la carte V2."""

from __future__ import annotations

import argparse
import pathlib
import shutil
import tempfile
import urllib.request


SOURCES = {
    "sncf-gtfs.zip": "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip",
    "lignes-par-statut.geojson": (
        "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/"
        "lignes-par-statut/exports/geojson?lang=fr&timezone=Europe%2FParis"
    ),
    "lignes-lgv.geojson": (
        "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/"
        "lignes-lgv-et-par-ecartement/exports/geojson?lang=fr&timezone=Europe%2FParis"
    ),
    "vitesses.geojson": (
        "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/"
        "vitesse-maximale-nominale-sur-ligne/exports/geojson?lang=fr&timezone=Europe%2FParis"
    ),
}


def download(url: str, destination: pathlib.Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "LaBetaillere-MapV2/1.0"})
    with tempfile.NamedTemporaryFile(delete=False, dir=destination.parent) as tmp:
        temp_path = pathlib.Path(tmp.name)
        with urllib.request.urlopen(request, timeout=180) as response:
            shutil.copyfileobj(response, tmp)
    if temp_path.stat().st_size < 100:
        temp_path.unlink(missing_ok=True)
        raise RuntimeError(f"Téléchargement anormalement petit pour {url}")
    temp_path.replace(destination)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/sources")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    for filename, url in SOURCES.items():
        destination = output / filename
        if destination.exists() and not args.force:
            print(f"[conservé] {destination}")
            continue
        print(f"[téléchargement] {filename}")
        download(url, destination)
        print(f"[ok] {destination} ({destination.stat().st_size:,} octets)")


if __name__ == "__main__":
    main()
