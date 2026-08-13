"""
Aggregate usage counters.

The dashboard ships fourteen tools and, until now, nothing recorded which of
them anyone actually opens. That makes prioritisation guesswork.

Design constraints, in order of importance:

  1. No personal data. This module accepts *counts of event names* and nothing
     else — no user ids, no session ids, no IP addresses, no free text, no
     timestamps finer than the day. There is deliberately no way to associate
     two submissions with the same person.
  2. Off by default. Collection requires ENABLE_USAGE_COLLECTION=true on the
     server *and* an explicit opt-in in the browser.
  3. Local-first. The frontend keeps its own counters regardless; this store
     only ever sees what a user chose to share.

Storage is a per-day JSON file of name -> count under the cache directory,
which resolves to /tmp on Vercel where the filesystem is otherwise read-only.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import date
from pathlib import Path
from typing import Dict

_LOCK = threading.Lock()

# Event names are the only strings that reach disk, so they are constrained to
# a strict shape rather than sanitised — anything else is dropped outright.
_EVENT_RE = re.compile(r"^[a-z][a-z0-9_]{0,48}$")

MAX_EVENTS_PER_SUBMISSION = 60
MAX_COUNT_PER_EVENT = 10_000


def collection_enabled() -> bool:
    return os.getenv("ENABLE_USAGE_COLLECTION", "false").lower() == "true"


def _store_dir() -> Path:
    base = os.environ.get("AGRISIM_CACHE_DIR")
    if os.environ.get("VERCEL"):
        base = "/tmp/.cache"
    if not base:
        base = str(Path(__file__).resolve().parents[1] / ".cache")
    directory = Path(base) / "usage"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _day_file(day: str) -> Path:
    return _store_dir() / f"usage-{day}.json"


def sanitize(counts: Dict[str, object]) -> Dict[str, int]:
    """Drop anything that is not a well-formed event name with a sane count."""
    clean: Dict[str, int] = {}
    for name, value in list(counts.items())[:MAX_EVENTS_PER_SUBMISSION]:
        if not isinstance(name, str) or not _EVENT_RE.match(name):
            continue
        try:
            count = int(value)
        except (TypeError, ValueError):
            continue
        if count <= 0:
            continue
        clean[name] = min(count, MAX_COUNT_PER_EVENT)
    return clean


def record(counts: Dict[str, object]) -> Dict[str, object]:
    """Merge a batch of event counts into today's aggregate file."""
    clean = sanitize(counts)
    if not clean:
        return {"accepted": 0, "day": None}

    day = date.today().isoformat()
    path = _day_file(day)

    with _LOCK:
        existing: Dict[str, int] = {}
        if path.exists():
            try:
                with path.open("r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict):
                    existing = {k: int(v) for k, v in loaded.items() if isinstance(v, (int, float))}
            except (OSError, ValueError):
                existing = {}

        for name, count in clean.items():
            existing[name] = existing.get(name, 0) + count

        try:
            with path.open("w", encoding="utf-8") as f:
                json.dump(existing, f, sort_keys=True)
        except OSError:
            return {"accepted": 0, "day": day, "error": "storage unavailable"}

    return {"accepted": len(clean), "day": day}


def summary(days: int = 30) -> Dict[str, object]:
    """Totals across the most recent `days` files, newest first."""
    directory = _store_dir()
    try:
        files = sorted(directory.glob("usage-*.json"), reverse=True)[: max(1, days)]
    except OSError:
        files = []

    totals: Dict[str, int] = {}
    per_day: Dict[str, Dict[str, int]] = {}

    for path in files:
        try:
            with path.open("r", encoding="utf-8") as f:
                loaded = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(loaded, dict):
            continue
        day = path.stem.replace("usage-", "")
        day_counts = {k: int(v) for k, v in loaded.items() if isinstance(v, (int, float))}
        per_day[day] = day_counts
        for name, count in day_counts.items():
            totals[name] = totals.get(name, 0) + count

    ranked = sorted(totals.items(), key=lambda kv: -kv[1])
    return {
        "days_covered": len(per_day),
        "totals": dict(ranked),
        "top_events": [{"event": name, "count": count} for name, count in ranked[:20]],
        "per_day": per_day,
    }
