"""Load a released joblib artifact once per process, without caching a failed load.

Two threads that unpickle sklearn estimators at the same time can trip Python's
import-deadlock detection ("deadlock detected by _ModuleLock('sklearn...')"). The
first request burst after a cold start does exactly that: the dashboard fires
several API calls at once and the yield and price models each load on their own
thread. That error is transient, so a failed load is retried once at once and then
again after RETRY_AFTER_S, instead of serving without the model until the process
restarts. A missing file is a real answer (no artifact shipped) and is cached.
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable, Generic, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

RETRY_AFTER_S = 30.0
ATTEMPTS = 2

# One lock for every artifact: loading them one at a time removes the import race
# between them (the yield and price models both import sklearn's ensemble modules).
_LOAD_LOCK = threading.Lock()


class LazyArtifact(Generic[T]):
    def __init__(self, name: str, build: Callable[[object], T]):
        self.name = name
        self.build = build
        self._value: T | None = None
        self._loaded = False
        self._failed_at: float | None = None

    def get(self, path: Path) -> T | None:
        if self._loaded:
            return self._value
        with _LOAD_LOCK:
            if self._loaded:
                return self._value
            if self._failed_at is not None and time.monotonic() - self._failed_at < RETRY_AFTER_S:
                return None
            if not path.exists():
                self._value, self._loaded = None, True
                return None
            for attempt in range(1, ATTEMPTS + 1):
                try:
                    import joblib

                    self._value = self.build(joblib.load(path))
                    self._loaded, self._failed_at = True, None
                    return self._value
                except Exception as exc:  # a broken artifact must not take the API down
                    logger.warning("%s not loaded (attempt %d/%d): %s", self.name, attempt, ATTEMPTS, exc)
            self._value, self._failed_at = None, time.monotonic()
            return None

    def reset(self) -> None:
        with _LOAD_LOCK:
            self._value, self._loaded, self._failed_at = None, False, None
