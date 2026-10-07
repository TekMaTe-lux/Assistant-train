#!/usr/bin/env python3
"""Build the public minified index.html from the editable source.

Edit _source/index.html, never the generated root index.html directly.
This build uses only Python's standard library so it works locally and in CI.
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "_source" / "index.html"
OUTPUT = ROOT / "index.html"

COMMENT_RE = re.compile(r"<!--(?!\[if\b)[\s\S]*?-->", re.IGNORECASE)


def minify_html(source: str) -> str:
    # Remove normal HTML comments but preserve old-style conditional comments.
    source = COMMENT_RE.sub("", source)
    source = source.replace("\r\n", "\n").replace("\r", "\n")

    # The source intentionally contains no PRE/TEXTAREA blocks. Keeping this
    # check prevents a future edit from accidentally changing whitespace that
    # is semantically meaningful.
    for tag in ("pre", "textarea"):
        if re.search(rf"<{tag}\b", source, re.IGNORECASE):
            raise SystemExit(f"Refusing to minify: <{tag}> found in source")

    return " ".join(line.strip() for line in source.split("\n") if line.strip()) + "\n"


def validate(source: str, built: str) -> None:
    checks = {
        "script tags": source.lower().count("<script"),
        "svg tags": source.lower().count("<svg"),
        "iframe tags": source.lower().count("<iframe"),
    }
    for label, expected in checks.items():
        actual = built.lower().count("<" + label.split()[0])
        if actual != expected:
            raise SystemExit(
                f"Build validation failed for {label}: {actual} != {expected}"
            )

    for marker in (
        "<!DOCTYPE html>",
        "La Bétaillère",
        "</html>",
    ):
        if marker not in built:
            raise SystemExit(f"Build validation failed: missing {marker!r}")


def main() -> None:
    source = SOURCE.read_text(encoding="utf-8")
    built = minify_html(source)
    validate(source, built)

    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        delete=False,
        dir=ROOT,
        prefix=".index.",
        suffix=".tmp",
    ) as tmp:
        tmp.write(built)
        temp_path = Path(tmp.name)

    temp_path.replace(OUTPUT)

    source_lines = len(source.splitlines())
    built_lines = len(built.splitlines())
    reduction = 100 * (1 - len(built.encode("utf-8")) / len(source.encode("utf-8")))
    print(
        f"Built {OUTPUT.name}: {source_lines} -> {built_lines} lines, "
        f"{len(source.encode('utf-8'))} -> {len(built.encode('utf-8'))} bytes "
        f"({reduction:.1f}% smaller)"
    )


if __name__ == "__main__":
    main()
