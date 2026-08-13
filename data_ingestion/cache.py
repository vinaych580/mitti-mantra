"""
Lightweight file + in-memory cache for data-ingestion fetchers.

Usage:
    from data_ingestion.cache import cached

    @cached(ttl_seconds=3600, key="mandi_prices")
    def fetch_mandi_prices(...):
        ...

The cache is process-local (dict) plus a JSON snapshot on disk so
subsequent runs can re-use it while offline.
"""

from __future__ import annotations

import json
import os
import time
import hashlib
import collections
import threading
from functools import wraps
from typing import Any, Callable, Optional

_DEFAULT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    ".cache",
)

MAX_CACHE_SIZE = 1000
_memory: collections.OrderedDict[str, tuple[float, Any]] = collections.OrderedDict()
_memory_lock = threading.Lock()


def _cache_dir() -> str:
    d = os.environ.get("AGRISIM_CACHE_DIR", _DEFAULT_DIR)
    if os.environ.get("VERCEL"):
        d = "/tmp/.cache"
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        d = "/tmp"
    return d


def _hash_args(args: tuple, kwargs: dict) -> str:
    blob = json.dumps(
        {"args": [repr(a) for a in args], "kwargs": {k: repr(v) for k, v in sorted(kwargs.items())}},
        default=str,
    ).encode("utf-8")
    return hashlib.sha1(blob).hexdigest()[:16]


def _read_disk(path: str) -> Optional[tuple[float, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return float(payload["ts"]), payload["value"]
    except Exception:
        return None


def _write_disk(path: str, value: Any) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"ts": time.time(), "value": value}, f, default=str)
    except Exception:
        pass


def cached(
    ttl_seconds: int = 3600,
    key: Optional[str] = None,
    serializable: bool = True,
) -> Callable:
    """
    Decorator that caches a function's return value by (key, args, kwargs).

    :param ttl_seconds: expiry; 0 or negative = never expire.
    :param key:         logical bucket name; default = function __name__.
    :param serializable: if True, persist to JSON on disk too.
    """
    def wrap(fn: Callable) -> Callable:
        bucket = key or fn.__name__

        @wraps(fn)
        def inner(*args: Any, **kwargs: Any) -> Any:
            tag = f"{bucket}__{_hash_args(args, kwargs)}"
            now = time.time()

            # Memory first
            with _memory_lock:
                entry = _memory.get(tag)
                if entry is not None:
                    ts, value = entry
                    if ttl_seconds <= 0 or (now - ts) < ttl_seconds:
                        _memory.move_to_end(tag)
                        return value
                    else:
                        _memory.pop(tag, None)

            # Disk next
            if serializable:
                disk_path = os.path.join(_cache_dir(), tag + ".json")
                disk = _read_disk(disk_path)
                if disk is not None:
                    ts, value = disk
                    if ttl_seconds <= 0 or (now - ts) < ttl_seconds:
                        with _memory_lock:
                            _memory[tag] = (ts, value)
                            if len(_memory) > MAX_CACHE_SIZE:
                                _memory.popitem(last=False)
                        return value

            # Miss — compute
            value = fn(*args, **kwargs)
            with _memory_lock:
                _memory[tag] = (now, value)
                if len(_memory) > MAX_CACHE_SIZE:
                    _memory.popitem(last=False)
            if serializable:
                _write_disk(os.path.join(_cache_dir(), tag + ".json"), value)
            return value

        def clear_bucket() -> None:
            with _memory_lock:
                for k in list(_memory.keys()):
                    if k == bucket or k.startswith(f"{bucket}__"):
                        _memory.pop(k, None)
            if serializable:
                d = _cache_dir()
                try:
                    for name in os.listdir(d):
                        if name.startswith(bucket + "__") and name.endswith(".json"):
                            try:
                                os.remove(os.path.join(d, name))
                            except OSError:
                                pass
                except OSError:
                    pass
        inner.cache_clear = clear_bucket  # type: ignore[attr-defined]
        return inner

    return wrap


def clear_all() -> None:
    """Drop every in-memory and on-disk cache entry."""
    with _memory_lock:
        _memory.clear()
    d = _cache_dir()
    try:
        for name in os.listdir(d):
            if name.endswith(".json"):
                try:
                    os.remove(os.path.join(d, name))
                except OSError:
                    pass
    except OSError:
        pass

