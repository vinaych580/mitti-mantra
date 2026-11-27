"""A failed artifact load is retried, not cached for the life of the process."""
from __future__ import annotations

import joblib

from ml import _artifact


def test_a_transient_load_failure_is_retried(tmp_path, monkeypatch):
    path = tmp_path / "a.joblib"
    joblib.dump({"v": 1}, path)
    real = joblib.load
    calls = {"n": 0}

    def flaky(p):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("deadlock detected by _ModuleLock('sklearn.ensemble._forest')")
        return real(p)

    monkeypatch.setattr(joblib, "load", flaky)
    art = _artifact.LazyArtifact("t", lambda a: a["v"])
    assert art.get(path) == 1
    assert calls["n"] == 2


def test_after_repeated_failures_it_backs_off_then_tries_again(tmp_path, monkeypatch):
    path = tmp_path / "a.joblib"
    joblib.dump({"v": 2}, path)
    real = joblib.load
    broken = {"on": True}
    monkeypatch.setattr(joblib, "load", lambda p: (_ for _ in ()).throw(OSError("bad")) if broken["on"] else real(p))
    clock = {"t": 1000.0}
    monkeypatch.setattr(_artifact.time, "monotonic", lambda: clock["t"])
    art = _artifact.LazyArtifact("t", lambda a: a["v"])
    assert art.get(path) is None
    broken["on"] = False
    assert art.get(path) is None  # still inside the back-off window
    clock["t"] += _artifact.RETRY_AFTER_S + 1
    assert art.get(path) == 2


def test_a_missing_artifact_is_a_cached_none(tmp_path):
    art = _artifact.LazyArtifact("t", lambda a: a)
    assert art.get(tmp_path / "missing.joblib") is None
    assert art._loaded
