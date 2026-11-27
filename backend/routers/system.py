"""System routes (Phase 3): CSP violation reports, health and version (3.6)."""
from __future__ import annotations

import json
import logging
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from backend import observability

router = APIRouter()
logger = logging.getLogger("csp")

MAX_REPORT_BYTES = 8 * 1024


def _strip(url: object) -> str:
    """Scheme, host and path only: a query string can carry personal data."""
    if not isinstance(url, str) or not url:
        return ""
    if "://" not in url:
        return url[:60]  # "inline", "eval", "data", ...
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}{p.path}"[:200]


@router.post("/v1/csp-report", status_code=204)
async def csp_report(request: Request) -> Response:
    """Browsers POST Content-Security-Policy violations here (report-only for now; see
    backend/security.py). One log line per report, no request body kept. Always 204:
    a browser never retries, and a bad report is not the browser's problem."""
    body = await request.body()
    if len(body) > MAX_REPORT_BYTES:
        return Response(status_code=204)
    try:
        payload = json.loads(body or b"{}")
    except ValueError:
        return Response(status_code=204)
    reports = payload if isinstance(payload, list) else [payload]
    for item in reports[:10]:
        if not isinstance(item, dict):
            continue
        # report-uri sends {"csp-report": {...}} with kebab-case keys; the Reporting
        # API sends {"type": "csp-violation", "body": {...}} with camelCase keys.
        r = item.get("csp-report") or item.get("body") or {}
        if not isinstance(r, dict):
            continue
        logger.warning("csp-violation %s", json.dumps({
            "directive": str(r.get("effective-directive") or r.get("effectiveDirective")
                             or r.get("violated-directive") or "")[:60],
            "blocked": _strip(r.get("blocked-uri") or r.get("blockedURL")),
            "page": _strip(r.get("document-uri") or r.get("documentURL")),
            "source": _strip(r.get("source-file") or r.get("sourceFile")),
            "line": r.get("line-number") or r.get("lineNumber"),
        }))
    return Response(status_code=204)


# ---- 3.6: health and version ----------------------------------------------------

_NO_STORE = {"Cache-Control": "no-store"}


def _check(fn) -> dict:
    start = time.perf_counter()
    try:
        ok, detail = fn()
    except Exception as exc:  # a health check reports failures, it never raises
        ok, detail = False, f"{type(exc).__name__}: {str(exc)[:200]}"
    out = {"ok": bool(ok), "ms": round((time.perf_counter() - start) * 1000, 1)}
    if detail:
        out["detail"] = detail
    return out


def _serving_store():
    from utils import store

    if not store.available():
        return False, "dataset/serving.sqlite missing"
    n = store.query("SELECT COUNT(*) AS n FROM districts")[0]["n"]
    if not n:
        return False, "districts table is empty"
    want = (observability.data_manifest().get("serving_store") or {}).get("bytes")
    size = store.SERVING_DB.stat().st_size
    if want and size != want:
        return False, f"{size} bytes, manifest says {want}"
    return True, f"{n} districts"


def _model(module_name: str):
    def check():
        import importlib

        model = importlib.import_module(f"ml.{module_name}").load()
        return (model is not None), (None if model is not None else "not loaded")
    return check


@router.get("/v1/system/health")
def system_health() -> JSONResponse:
    """Is this deployment able to serve? The serving store opens and matches its
    manifest, and each released model loads (the first call after a cold start pays
    the load). 200 when every check passes, 503 otherwise. No database yet (3.1)."""
    checks = {
        "serving_store": _check(_serving_store),
        "yield_model": _check(_model("yield_anomaly")),
        "price_model": _check(_model("price_model")),
    }
    ok = all(c["ok"] for c in checks.values())
    body = {"status": "ok" if ok else "degraded", "checks": checks,
            "database": "not configured (Phase 3.1)", "commit": observability.commit()}
    return JSONResponse(body, status_code=200 if ok else 503, headers=_NO_STORE)


@router.get("/v1/system/version")
def system_version() -> JSONResponse:
    """Commit, data manifest hash and model versions this deployment runs."""
    return JSONResponse(observability.version_info(), headers=_NO_STORE)
