"""Cold-start concurrent imports of the data_ingestion fetchers (utils/lazy_import.py)."""
from __future__ import annotations

import re
import subprocess
import sys
import textwrap
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]

# Three threads import fetcher submodules at the same moment in a fresh process.
# With plain imports this raised _DeadlockError in 30 runs of 30.
RACE = textwrap.dedent("""
    import sys, threading
    sys.path.insert(0, sys.argv[1])
    from utils.lazy_import import fetcher
    errors, barrier = [], threading.Barrier(3)
    def run(name):
        barrier.wait()
        try:
            fetcher(name)
        except BaseException as e:
            errors.append(f"{type(e).__name__}: {e}")
    threads = [threading.Thread(target=run, args=(n,)) for n in ("google_earth_engine", "mandi", "imd")]
    [t.start() for t in threads]; [t.join() for t in threads]
    print("ERR " + " | ".join(errors) if errors else "OK")
""")


def test_concurrent_cold_imports_do_not_deadlock():
    for _ in range(5):
        out = subprocess.run([sys.executable, "-c", RACE, str(ROOT)], capture_output=True, text=True,
                             timeout=60)
        assert out.stdout.strip() == "OK", out.stdout + out.stderr


def test_request_code_imports_fetchers_only_through_the_helper():
    pattern = re.compile(r"^\s*(from data_ingestion\b|import data_ingestion\b)", re.M)
    for folder in ("backend", "engine", "ml", "utils"):
        for path in (ROOT / folder).rglob("*.py"):
            if path.name == "lazy_import.py":
                continue
            assert not pattern.search(path.read_text(encoding="utf-8")), \
                f"{path.relative_to(ROOT)} imports data_ingestion directly; use utils.lazy_import.fetcher"


def test_satellite_answers_unavailable_when_the_fetcher_import_fails(monkeypatch):
    from backend.main import app
    import utils.lazy_import as lazy

    def boom(name):
        raise RuntimeError("deadlock detected by _ModuleLock")
    monkeypatch.setattr(lazy, "fetcher", boom)
    r = TestClient(app).get("/api/satellite", params={"lat": 23.2, "lon": 77.4})
    assert r.status_code == 200
    assert r.json()["available"] is False
