"""System routes (Phase 3): CSP violation reports."""
from __future__ import annotations

import json
import logging
from urllib.parse import urlsplit

from fastapi import APIRouter, Request, Response

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
