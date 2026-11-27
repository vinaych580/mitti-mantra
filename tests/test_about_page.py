"""/about (Phase 4, spec 4.12) is served the same way on Vercel and by uvicorn.

Nothing else compares the two route lists, so this pins the new one: the
rewrite in vercel.json and the FastAPI route must point at the same file,
and the service worker must precache what the page loads.
"""
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app

ROOT = Path(__file__).resolve().parents[1]


def test_about_route_is_served_by_fastapi():
    res = TestClient(app).get("/about")
    assert res.status_code == 200
    assert "<title>About · Mitti Mantra</title>" in res.text


def test_about_rewrite_matches_fastapi_route():
    cfg = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    rewrites = {r["source"]: r["destination"] for r in cfg["rewrites"]}
    assert rewrites.get("/about") == "/frontend/about.html"


def test_about_assets_are_precached():
    sw = (ROOT / "frontend" / "sw.js").read_text(encoding="utf-8")
    for asset in ("./about.html", "./about.css", "./about.js"):
        assert f"'{asset}'" in sw, asset
