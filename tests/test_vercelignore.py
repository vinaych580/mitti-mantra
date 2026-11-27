""".vercelignore must never drop a file the site serves.

An unanchored ``data/`` (meant for the root pipeline folder) also matched
``frontend/Data/`` on Vercel, which compares case-insensitively: the tractor,
consultant and marketplace data files answered 404 on production from the Phase 1
merge until this test's fix. This applies .vercelignore's gitignore-style rules,
case-insensitively, to every tracked file under frontend/.
"""
from __future__ import annotations

import fnmatch
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _rules():
    for raw in (ROOT / ".vercelignore").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negate = line.startswith("!")
        pattern = line[1:] if negate else line
        dir_only = pattern.endswith("/")
        pattern = pattern.rstrip("/")
        anchored = pattern.startswith("/") or "/" in pattern
        yield negate, pattern.lstrip("/").lower(), dir_only, anchored


def _matches(path: str, pattern: str, dir_only: bool, anchored: bool) -> bool:
    parts = path.lower().split("/")
    # A directory pattern only matches a component that has something below it.
    candidates = range(len(parts) - 1) if dir_only else range(len(parts))
    if anchored:
        depth = pattern.count("/") + 1
        return any(fnmatch.fnmatchcase("/".join(parts[:i + 1]), pattern)
                   for i in candidates if i + 1 >= depth)
    return any(fnmatch.fnmatchcase(parts[i], pattern) for i in candidates)


def ignored(path: str) -> bool:
    out = False
    for negate, pattern, dir_only, anchored in _rules():
        if _matches(path, pattern, dir_only, anchored):
            out = not negate
    return out


def test_no_served_frontend_file_is_ignored():
    files = subprocess.run(["git", "ls-files", "frontend"], cwd=ROOT, capture_output=True, text=True,
                           check=True).stdout.split()
    assert files, "git ls-files found nothing under frontend/"
    dropped = [f for f in files if ignored(f) and not f.startswith("frontend/models/disease/")]
    assert not dropped, f".vercelignore drops served files: {dropped[:10]}"


def test_the_matcher_catches_the_old_rule():
    assert _matches("frontend/Data/tractors.js", "data", dir_only=True, anchored=False)
    assert not _matches("frontend/Data/tractors.js", "data", dir_only=True, anchored=True)
    assert ignored("data/raw/x.csv")
    assert not ignored("pipelines/manifest.json")
    assert ignored("pipelines/run.py")
