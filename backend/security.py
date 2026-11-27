"""Security headers (Phase 3.4, docs/superpowers/specs/2026-11-11-phase3-architecture-design.md).

One source for both places that set them: the API middleware below, and the
static-file headers in vercel.json (tests/test_security_headers.py checks the two
agree). On Vercel the frontend is served as static files, never by FastAPI; locally
`uvicorn backend.main:app` serves both, and gets the same headers.

The page Content-Security-Policy ships as **report-only**. The pages still carry
inline `style=` attributes everywhere, two inline scripts and a few inline event
handlers, and Leaflet, Chart.js and the 3D globe load from CDNs; an enforced policy
could break a page in ways no test here covers. Violations are reported to
/api/v1/csp-report and logged, so the policy can be tightened and then enforced once
the reports are clean. Everything else is enforced from day one: none of it changes
what a page can do.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

CSP_REPORT_PATH = "/api/v1/csp-report"

# Hosts inventoried from frontend/*.html and *.js (2026-11-27).
PAGE_CSP = "; ".join([
    "default-src 'self'",
    # site-ui.js adds speculation rules (prefetch on hover) as an inline script.
    "script-src 'self' 'inline-speculation-rules' https://unpkg.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com data:",
    # Map tiles (OpenStreetMap, ArcGIS), Unsplash photos, canvas and camera blobs.
    "img-src 'self' data: blob: https:",
    # The service worker re-fetches fonts, photos and map tiles to cache them, and a
    # worker's fetch counts as connect-src, so those hosts are listed here too.
    "connect-src 'self' https://nominatim.openstreetmap.org https://rest.isric.org "
    "https://raw.githubusercontent.com https://unpkg.com https://cdn.jsdelivr.net "
    "https://fonts.googleapis.com https://fonts.gstatic.com https://images.unsplash.com "
    "https://*.tile.openstreetmap.org https://server.arcgisonline.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    f"report-uri {CSP_REPORT_PATH}",
])

# JSON never needs to load anything or be framed.
API_CSP = "default-src 'none'; frame-ancestors 'none'"

# Camera (leaf scan), microphone (voice), location (find my farm) stay with the
# site itself; features no page uses are switched off.
PERMISSIONS_POLICY = ", ".join([
    "camera=(self)", "microphone=(self)", "geolocation=(self)",
    "payment=()", "usb=()", "serial=()", "bluetooth=()", "hid=()", "browsing-topics=()",
])

COMMON_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": PERMISSIONS_POLICY,
}

# Swagger UI loads its script and styles from a CDN; it keeps the page policy.
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


def headers_for(path: str) -> dict[str, str]:
    """Headers for a response to `path`."""
    out = dict(COMMON_HEADERS)
    if path.startswith("/api/"):
        out["Content-Security-Policy"] = API_CSP
    else:
        out["Content-Security-Policy-Report-Only"] = PAGE_CSP
    return out


def static_headers() -> dict[str, str]:
    """What vercel.json must set on every static (non-API) response."""
    return headers_for("/")


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        for name, value in headers_for("/" if path.startswith(DOCS_PATHS) else path).items():
            response.headers.setdefault(name, value)
        return response


# ---- Request body size (3.4) ------------------------------------------------------
# Vercel already refuses bodies over 4.5 MB, but a function still reads, parses and
# validates whatever fits under that. Every JSON route here takes a few kilobytes,
# so the default is small; the two upload routes keep the room their models allow.
DEFAULT_MAX_BODY = 256 * 1024
MAX_BODY_BY_PATH = {
    "/api/disease/predict": 11 * 1024 * 1024,  # image_b64 up to 10,000,000 characters
    "/api/sensors/upload": 5 * 1024 * 1024,    # CSV content up to 2,000,000 characters
}
_BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def max_body_for(path: str) -> int:
    return MAX_BODY_BY_PATH.get(path.rstrip("/") or "/", DEFAULT_MAX_BODY)


class BodySizeLimit:
    """Pure ASGI middleware: 413 for a body over the route's limit. Checks
    Content-Length first; a body without one (chunked) is read up to the limit and
    then replayed to the app, so nothing larger is ever held in memory."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return
        limit = max_body_for(scope.get("path") or "/")
        headers = dict(scope.get("headers") or [])
        length = headers.get(b"content-length")
        if length is not None:
            try:
                too_big = int(length) > limit
            except ValueError:
                too_big = True
            if too_big:
                await _too_large(send, limit)
                return
            await self.app(scope, receive, send)
            return

        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > limit:
                await _too_large(send, limit)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body, replayed = b"".join(chunks), False

        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


async def _too_large(send, limit: int) -> None:
    import json

    payload = json.dumps({"detail": f"Request body too large (limit {limit:,} bytes)"}).encode()
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(payload)).encode())]})
    await send({"type": "http.response.body", "body": payload})
