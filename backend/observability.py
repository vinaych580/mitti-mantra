"""Observability without a vendor (Phase 3.6, docs/superpowers/specs/2026-11-11-phase3-architecture-design.md).

- ``RequestLog``: one JSON line per request on stdout (Vercel keeps function stdout as
  its runtime log). Fields: request id, method, route template, status, duration,
  commit, data manifest hash. Never request or response bodies, never query strings,
  never headers other than the request id.
- ``version_info()``: what this deployment is running -- commit, data manifest and
  model versions -- for ``GET /api/v1/system/version``.

Error tracking (the spec's Sentry item) needs a vendor account and is the owner's call.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
import time
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parents[1]
DATA_MANIFEST = ROOT / "pipelines" / "manifest.json"
MODEL_DIR = ROOT / "ml" / "models"
#: The per-model fields /version reports from ml/models/<name>/metrics.json.
MODEL_FIELDS = ("version", "serves", "code_commit", "data_manifest_sha256", "behaviour_passed")

# A request id the caller sent is echoed back only if it looks like one.
_SAFE_ID = re.compile(r"^[A-Za-z0-9:._-]{1,128}$")


def commit() -> Optional[str]:
    return os.getenv("VERCEL_GIT_COMMIT_SHA") or os.getenv("GIT_COMMIT_SHA") or None


@lru_cache(maxsize=1)
def data_manifest() -> Dict[str, Any]:
    """sha256 of pipelines/manifest.json (line endings normalised, so a Windows
    checkout hashes the same as the deploy) plus the serving store it names."""
    try:
        text = DATA_MANIFEST.read_text(encoding="utf-8").replace("\r\n", "\n")
        doc = json.loads(text)
    except (OSError, ValueError):
        return {"sha256": None}
    serving = doc.get("serving") or {}
    return {
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "built_at": doc.get("built_at"),
        "serving_store": {k: serving.get(k) for k in ("sha256", "bytes", "built_at")} if serving else None,
    }


@lru_cache(maxsize=1)
def model_versions() -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for path in sorted(MODEL_DIR.glob("*/metrics.json")):
        try:
            m = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            out[path.parent.name] = {"version": None, "error": "metrics.json unreadable"}
            continue
        out[path.parent.name] = {k: m.get(k) for k in MODEL_FIELDS if k in m}
    return out


def version_info() -> Dict[str, Any]:
    return {
        "commit": commit(),
        "environment": os.getenv("VERCEL_ENV") or "local",
        "data": data_manifest(),
        "models": model_versions(),
    }


@lru_cache(maxsize=1)
def _log_context() -> Dict[str, Any]:
    c = commit()
    d = data_manifest().get("sha256")
    models = ",".join(f"{k}@{v.get('version')}" for k, v in model_versions().items())
    return {"commit": c[:12] if c else None, "data": d[:12] if d else None, "models": models or None}


class _StdoutJSON(logging.Handler):
    """Writes the record's message as-is: it is already a JSON object. Looks up
    sys.stdout at emit time so test capture works."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            sys.stdout.write(record.getMessage() + "\n")
            sys.stdout.flush()
        except Exception:  # logging must never fail a request
            pass


request_logger = logging.getLogger("mm.request")
if not request_logger.handlers:
    request_logger.addHandler(_StdoutJSON())
    request_logger.setLevel(logging.INFO)
    request_logger.propagate = False


def _route_of(scope: Dict[str, Any]) -> Optional[str]:
    """The matched route template with its router prefix ("/api/v1/districts/{district_id}").

    FastAPI puts the matched route in the scope, but (0.13x) a route from an included
    router keeps its un-prefixed path, so the prefix is read back off the request path:
    every template segment matches exactly one path segment."""
    template = getattr(scope.get("route"), "path", None)
    if not template:
        return None
    path = scope.get("path") or ""
    segs, tsegs = path.strip("/").split("/"), template.strip("/").split("/")
    if ":path}" in template or len(tsegs) > len(segs):
        return template
    tail = segs[len(segs) - len(tsegs):]
    if any(t != s for t, s in zip(tsegs, tail) if not t.startswith("{")):
        return template
    prefix = segs[:len(segs) - len(tsegs)]
    return ("/" + "/".join(prefix) if prefix else "") + template


class RequestLog:
    """Pure ASGI middleware (no BaseHTTPMiddleware: it does not buffer or wrap the
    response body). Adds ``X-Request-ID`` to the response."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        start = time.perf_counter()
        headers = dict(scope.get("headers") or [])
        incoming = (headers.get(b"x-request-id") or headers.get(b"x-vercel-id") or b"").decode("latin-1")
        request_id = incoming if _SAFE_ID.match(incoming) else uuid.uuid4().hex
        status = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                message.setdefault("headers", [])
                message["headers"] = list(message["headers"]) + [(b"x-request-id", request_id.encode("latin-1"))]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            route = _route_of(scope)
            entry = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "msg": "request",
                "request_id": request_id,
                "method": scope.get("method"),
                # The route template ("/api/v1/districts/{district_id}") when one matched;
                # otherwise the path, without its query string, cut to 120 characters.
                "route": route or (scope.get("path") or "")[:120],
                "matched": route is not None,
                "status": status["code"],
                "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                **_log_context(),
            }
            request_logger.info(json.dumps(entry, separators=(",", ":")))
