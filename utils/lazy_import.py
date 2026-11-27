"""Import the data_ingestion fetchers lazily, one thread at a time.

``data_ingestion/__init__`` imports ``data_ingestion.fetchers``, whose ``__init__``
imports every fetcher. When two request threads import fetcher submodules at the
same moment on a cold process (say ``fetchers.google_earth_engine`` for
/api/satellite and ``fetchers.mandi`` for the provenance panel), each holds one
module lock and waits for the other's, and Python raises ``_DeadlockError`` in one
of them: a 500 on the first request burst after a cold start. Reproduced 30 times
in 30 with three threads (2026-11-27).

Importing them eagerly at startup would add ~185 ms (mostly ``requests``) to every
cold start, so request code imports them through ``fetcher()`` instead, which
serialises those imports. Same idea as ml/_artifact.py for the model loaders.
"""
from __future__ import annotations

import importlib
import threading
from types import ModuleType

# Re-entrant: an import running under the lock may itself call fetcher().
_LOCK = threading.RLock()


def fetcher(name: str) -> ModuleType:
    """``fetcher("mandi")`` -> the ``data_ingestion.fetchers.mandi`` module."""
    with _LOCK:
        return importlib.import_module(f"data_ingestion.fetchers.{name}")
