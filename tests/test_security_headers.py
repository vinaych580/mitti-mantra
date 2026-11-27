"""Phase 3.4: security headers, CSP reports, admin-only internals."""
from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import security
from backend.main import app

ROOT = Path(__file__).resolve().parents[1]
client = TestClient(app)


def test_api_responses_carry_the_strict_policy():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.headers["content-security-policy"] == security.API_CSP
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "camera=(self)" in r.headers["permissions-policy"]
    assert "content-security-policy-report-only" not in r.headers


def test_pages_get_the_report_only_policy_not_an_enforced_one():
    r = client.get("/openapi.json")
    assert "content-security-policy" not in r.headers
    assert r.headers["content-security-policy-report-only"] == security.PAGE_CSP
    assert "frame-ancestors 'none'" in security.PAGE_CSP
    assert security.CSP_REPORT_PATH in security.PAGE_CSP


def test_vercel_static_headers_match_the_module():
    cfg = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    rules = [h for h in cfg["headers"] if h["source"] == "/((?!api/).*)"]
    assert len(rules) == 1
    assert {h["key"]: h["value"] for h in rules[0]["headers"]} == security.static_headers()


def test_every_external_script_host_in_the_pages_is_allowed():
    import re
    allowed = re.search(r"script-src ([^;]+)", security.PAGE_CSP).group(1).split()
    for page in (ROOT / "frontend").glob("*.html"):
        for src in re.findall(r'<script[^>]+src="(https://[^/"]+)', page.read_text(encoding="utf-8")):
            assert src in allowed, f"{page.name}: {src} not in script-src"


def test_csp_report_is_logged_without_query_strings(caplog):
    report = {"csp-report": {"document-uri": "https://x.test/dashboard?phone=99999",
                             "violated-directive": "script-src-elem",
                             "effective-directive": "script-src-elem",
                             "blocked-uri": "inline", "line-number": 12}}
    with caplog.at_level(logging.WARNING, logger="csp"):
        r = client.post("/api/v1/csp-report", content=json.dumps(report),
                        headers={"content-type": "application/csp-report"})
    assert r.status_code == 204
    line = " ".join(m.getMessage() for m in caplog.records)
    assert "script-src-elem" in line and "https://x.test/dashboard" in line
    assert "99999" not in line


@pytest.mark.parametrize("body", [b"not json", b"[1, 2]", b"{}", b"x" * 9000])
def test_csp_report_never_fails(body):
    assert client.post("/api/v1/csp-report", content=body).status_code == 204


def test_cache_stats_needs_the_admin_key(monkeypatch):
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    assert client.get("/api/_cache/stats").status_code == 503
    monkeypatch.setenv("ADMIN_API_KEY", "k")
    assert client.get("/api/_cache/stats").status_code == 401
    assert client.get("/api/_cache/stats", headers={"x-admin-key": "nope"}).status_code == 401
    assert client.get("/api/_cache/stats", headers={"x-admin-key": "k"}).status_code == 200
