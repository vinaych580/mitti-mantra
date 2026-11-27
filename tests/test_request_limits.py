"""Phase 3.4: request body size limits and bounded request models."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend import security
from backend.main import app

client = TestClient(app)


def test_default_limit_refuses_a_large_body_with_413_and_security_headers():
    body = json.dumps({"message": "x" * (security.DEFAULT_MAX_BODY + 10)})
    r = client.post("/api/chat", content=body, headers={"content-type": "application/json"})
    assert r.status_code == 413
    assert "too large" in r.json()["detail"]
    assert r.headers["x-content-type-options"] == "nosniff"


def test_upload_routes_keep_their_larger_limits():
    assert security.max_body_for("/api/disease/predict") > 10_000_000
    assert security.max_body_for("/api/sensors/upload") > 2_000_000
    assert security.max_body_for("/api/recommend") == security.DEFAULT_MAX_BODY


def test_a_body_under_the_limit_reaches_the_route():
    r = client.post("/api/loan-calculator", json={"total_cost": 50000, "expected_profit": 20000})
    assert r.status_code == 200


def test_chunked_body_over_the_limit_is_refused():
    def chunks():
        for _ in range(5):
            yield b"x" * (security.DEFAULT_MAX_BODY // 4)
    r = client.post("/api/chat", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_chunked_body_under_the_limit_is_replayed_intact():
    payload = json.dumps({"total_cost": 50000, "expected_profit": 20000}).encode()

    def chunks():
        yield payload[:10]
        yield payload[10:]
    r = client.post("/api/loan-calculator", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 200, r.text


def test_bad_content_length_is_refused():
    r = client.post("/api/chat", content=b"{}", headers={"content-type": "application/json",
                                                         "content-length": "lots"})
    assert r.status_code in (400, 413)


def test_get_requests_are_untouched():
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize("path,body", [
    ("/api/soil-projection", {"current_soil": {}, "rotation": [{"crop_id": "rice"}], "years": 10**9}),
    ("/api/soil-projection", {"current_soil": {}, "rotation": [{"crop_id": "rice"}] * 21}),
    ("/api/chat", {"message": "x" * 2_001}),
    ("/api/recommend", {"region_id": "x" * 101, "season": "kharif", "budget_per_acre": 20000, "area_acres": 2}),
    ("/api/batch-simulate", {"crop_ids": ["rice"] * 101, "area_acres": 2, "region_id": "mp_sehore",
                             "budget_per_acre": 20000, "soil": {}, "weather": {}}),
    ("/api/batch-simulate", {"crop_ids": ["rice"], "area_acres": 2, "region_id": "mp_sehore",
                             "budget_per_acre": 20000, "soil": {f"k{i}": i for i in range(101)},
                             "weather": {}}),
])
def test_oversized_fields_are_422(path, body):
    r = client.post(path, json=body)
    assert r.status_code == 422, r.text


def test_soil_projection_still_works_in_range():
    r = client.post("/api/soil-projection", json={
        "current_soil": {"n_kg_per_acre": 40, "p_kg_per_acre": 20, "k_kg_per_acre": 20},
        "rotation": [{"crop_id": "rice", "season": "kharif"}, {"crop_id": "wheat", "season": "rabi"}],
        "years": 5})
    assert r.status_code == 200, r.text
