"""Shared paths and helpers for the data pipeline.

Nothing here generates values. Every row a pipeline writes carries the
provenance columns in PROVENANCE_COLUMNS so the app can say where it came from.
"""
from __future__ import annotations

import csv
import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"
STAGED = DATA / "staged"
CURATED = DATA / "curated"
REFERENCE = Path(__file__).resolve().parent / "reference"
DATASET = ROOT / "dataset"
MANIFEST = Path(__file__).resolve().parent / "manifest.json"

HA_PER_ACRE = 0.404686  # hectares in one acre

PROVENANCE_COLUMNS = ["source", "source_version", "fetched_at", "licence", "is_synthetic"]

log = logging.getLogger("pipelines")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_dirs() -> None:
    for d in (RAW, STAGED, CURATED):
        d.mkdir(parents=True, exist_ok=True)


def read_reference(name: str) -> List[Dict[str, str]]:
    """Rows of a committed reference CSV (crop aliases, pilot regions...)."""
    with (REFERENCE / name).open(encoding="utf-8", newline="") as f:
        lines = [ln for ln in f if not ln.lstrip().startswith("#")]  # comments may precede the header
    return list(csv.DictReader(lines))


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_fetch_meta(raw_dir: Path, **meta: Any) -> None:
    """Record when and from where a raw download was taken."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    meta.setdefault("fetched_at", utc_now())
    (raw_dir / "_fetch.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def read_fetch_meta(raw_dir: Path) -> Dict[str, Any]:
    p = raw_dir / "_fetch.json"
    if not p.exists():
        raise FileNotFoundError(f"{raw_dir} has no _fetch.json; run the download step first")
    return json.loads(p.read_text(encoding="utf-8"))


def http_get_json(url: str, params: Dict[str, Any] | None = None, *, tries: int = 6,
                  timeout: float = 180.0) -> Any:
    import requests

    last: Exception | None = None
    for attempt in range(tries):
        try:
            r = requests.get(url, params=params, timeout=timeout,
                             headers={"User-Agent": "agrisim-data-pipeline/1.0"})
            if r.status_code == 429 or r.status_code >= 500:
                raise RuntimeError(f"HTTP {r.status_code}")
            if r.status_code >= 400:  # a request error will not fix itself on retry
                raise PermissionError(f"HTTP {r.status_code} from {url}: {r.text[:300]}")
            r.raise_for_status()
            return r.json()
        except PermissionError:
            raise
        except Exception as exc:  # network flakiness: back off and retry
            last = exc
            time.sleep(2 ** attempt * 2)
    raise RuntimeError(f"GET {url} failed after {tries} tries: {last}")


PORTAL_SQL_URL = "https://ckandev.indiadataportal.com/api/3/action/datastore_search_sql"
PORTAL_ROWS_MAX = 32000  # the portal's rows_max per SQL page


def portal_sql_all(sql: str) -> List[Dict[str, Any]]:
    """Every row of an India Data Portal SQL query, paging past the row cap.
    `sql` must have a stable ORDER BY and no LIMIT/OFFSET. The portal's SQL
    allow-list rejects some functions (nullif); use CASE instead."""
    rows: List[Dict[str, Any]] = []
    offset = 0
    while True:
        data = http_get_json(PORTAL_SQL_URL,
                             {"sql": f"{sql}\nLIMIT {PORTAL_ROWS_MAX} OFFSET {offset}"})
        if not data.get("success"):
            raise RuntimeError(f"portal SQL failed: {data.get('error')}")
        page = data["result"]["records"]
        rows.extend(page)
        if len(page) < PORTAL_ROWS_MAX:
            return rows
        offset += PORTAL_ROWS_MAX


def agri_year_start(year: str) -> int:
    """'2022-23' / '2022-2023' -> 2022, the app's label for kharif 2022 and rabi 2022-23."""
    return int(str(year).strip()[:4])


def write_csv(path: Path, rows: Iterable[Dict[str, Any]], fieldnames: List[str]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for row in rows:
            w.writerow(row)
            n += 1
    return n
