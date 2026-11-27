"""Phase 3.6 without vendors: health, version, structured request logs."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend import observability
from backend.main import app
from utils import store

client = TestClient(app)


def _log_lines(out: str) -> list[dict]:
    return [json.loads(line) for line in out.splitlines() if line.startswith('{"ts"')]


def test_version_reports_commit_data_and_models(monkeypatch):
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "abc123def4567890")
    r = client.get("/api/v1/system/version")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["commit"] == "abc123def4567890"
    assert len(body["data"]["sha256"]) == 64
    assert body["data"]["serving_store"]["sha256"]
    for name in ("yield", "price"):
        metrics = json.loads((observability.MODEL_DIR / name / "metrics.json").read_text(encoding="utf-8"))
        assert body["models"][name]["version"] == metrics["version"]


def test_data_hash_ignores_line_endings(tmp_path, monkeypatch):
    lf = tmp_path / "lf.json"
    crlf = tmp_path / "crlf.json"
    lf.write_bytes(b'{\n  "built_at": "x"\n}\n')
    crlf.write_bytes(b'{\r\n  "built_at": "x"\r\n}\r\n')
    hashes = []
    for p in (lf, crlf):
        monkeypatch.setattr(observability, "DATA_MANIFEST", p)
        observability.data_manifest.cache_clear()
        hashes.append(observability.data_manifest()["sha256"])
    observability.data_manifest.cache_clear()
    assert hashes[0] == hashes[1]


@pytest.mark.skipif(not store.available(), reason="dataset/serving.sqlite not built")
def test_health_ok_when_store_and_models_load():
    r = client.get("/api/v1/system/health")
    body = r.json()
    assert r.status_code == 200, body
    assert body["status"] == "ok"
    assert set(body["checks"]) == {"serving_store", "yield_model", "price_model"}
    assert all(c["ok"] for c in body["checks"].values())


def test_health_503_when_a_model_does_not_load(monkeypatch):
    from ml import price_model

    monkeypatch.setattr(price_model, "load", lambda: None)
    r = client.get("/api/v1/system/health")
    assert r.status_code == 503
    assert r.json()["status"] == "degraded"
    assert r.json()["checks"]["price_model"] == {"ok": False, "ms": pytest.approx(0, abs=50), "detail": "not loaded"}


def test_health_reports_a_check_that_raises(monkeypatch):
    from ml import yield_anomaly

    def boom():
        raise RuntimeError("deadlock detected")
    monkeypatch.setattr(yield_anomaly, "load", boom)
    r = client.get("/api/v1/system/health")
    assert r.status_code == 503
    assert "RuntimeError: deadlock detected" in r.json()["checks"]["yield_model"]["detail"]


def test_request_log_is_one_json_line_without_query_or_body(capsys):
    r = client.post("/api/v1/csp-report?phone=9999999999", content=b'{"secret": "body"}')
    assert r.status_code == 204
    lines = _log_lines(capsys.readouterr().out)
    assert len(lines) == 1
    entry = lines[0]
    assert entry["route"] == "/api/v1/csp-report"
    assert entry["matched"] is True
    assert entry["status"] == 204
    assert entry["method"] == "POST"
    assert entry["duration_ms"] >= 0
    assert entry["request_id"] == r.headers["x-request-id"]
    text = json.dumps(entry)
    assert "9999999999" not in text and "secret" not in text


def test_request_log_uses_the_route_template():
    import io
    import sys

    buf, old = io.StringIO(), sys.stdout
    sys.stdout = buf
    try:
        client.get("/api/v1/districts/no-such-district")
        client.get("/api/health")
        client.get("/api/definitely-not-a-route?x=1")
    finally:
        sys.stdout = old
    routes = [(e["route"], e["matched"], e["status"]) for e in _log_lines(buf.getvalue())]
    assert routes[0][0] == "/api/v1/districts/{district_id}"
    assert routes[1] == ("/api/health", True, 200)
    assert routes[2] == ("/api/definitely-not-a-route", False, 404)


def test_request_id_is_echoed_only_when_safe():
    r = client.get("/api/health", headers={"x-request-id": "abc-123"})
    assert r.headers["x-request-id"] == "abc-123"
    r = client.get("/api/health", headers={"x-request-id": "bad id\nwith newline"})
    assert r.headers["x-request-id"] != "bad id\nwith newline"
    assert len(r.headers["x-request-id"]) == 32


def test_route_prefix_reconstruction():
    class R:
        def __init__(self, path):
            self.path = path
    f = observability._route_of
    assert f({"route": R("/v1/districts/{district_id}"), "path": "/api/v1/districts/36-513"}) == \
        "/api/v1/districts/{district_id}"
    assert f({"route": R("/api/health"), "path": "/api/health"}) == "/api/health"
    assert f({"route": R("/"), "path": "/"}) == "/"
    assert f({"path": "/x"}) is None


def test_vercel_function_globs_fit_vercels_schema():
    """Vercel rejects the whole deployment (before building) when a function's
    includeFiles/excludeFiles glob is longer than 256 characters."""
    cfg = json.loads((observability.ROOT / "vercel.json").read_text(encoding="utf-8"))
    for name, fn in cfg["functions"].items():
        for key in ("includeFiles", "excludeFiles"):
            assert len(fn.get(key, "")) <= 256, f"{name}.{key} is {len(fn[key])} characters"


def test_the_data_manifest_ships_with_the_function():
    # Not in includeFiles (no room): .vercelignore un-ignores it and the preview
    # bundle carries it (checked on the phase3-observability preview, 2026-11-27).
    ignore = (observability.ROOT / ".vercelignore").read_text(encoding="utf-8").splitlines()
    assert "!pipelines/manifest.json" in ignore
