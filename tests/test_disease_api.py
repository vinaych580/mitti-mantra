"""
tests/test_disease_api.py
API tests for the Crop Disease Detection flagship feature.
Tests:
  - Model status sanitization (no local dev path leaks)
  - Backend fallback endpoint schema and responses
  - Static model route resolution
"""
from __future__ import annotations

import base64
import json
from pathlib import Path
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

def test_ml_status_sanitized():
    """Verify that model_dir in /api/ml/status does not leak local system path."""
    response = client.get("/api/ml/status")
    assert response.status_code == 200
    data = response.json()

    # Check that model_dir is relative
    model_dir = data.get("model_dir", "")
    assert model_dir == "ml/models"
    assert "Users" not in model_dir
    assert "C:\\" not in model_dir
    assert ":" not in model_dir

    # A trained disease classifier (ml/models/disease_model.joblib) is optional:
    # present when dataset/plantvillage/ has enough labeled images per class
    # (see ml/training/disease_model.py), absent otherwise. Either way, the
    # heuristic screening path is always available as the fallback.
    assert isinstance(data["disease_model_loaded"], bool)
    assert data["disease_screening_available"] is True

def test_disease_predict_fallback_tomato(monkeypatch):
    """Test the HSV/texture heuristic fallback for Tomato (ML path bypassed).

    Forces predict_disease_ml() to return None so this exercises the
    hand-tuned decision tree directly, regardless of whether a trained
    disease_model.joblib happens to be present on disk.
    """
    monkeypatch.setattr("backend.main.predict_disease_ml", lambda *a, **k: None)
    # A valid tiny 1x1 green pixel PNG base64
    img_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    payload = {
        "image_b64": img_b64,
        "crop_id": "tomato",
        "region_id": "up_lucknow"
    }

    response = client.post("/api/disease/predict", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "disease" in data
    assert "confidence" in data
    assert "severity" in data
    assert "treatment" in data
    assert "crop_matched" in data
    assert "region_context" in data
    assert "lesion_area_pct" in data
    assert "subsidy_eligible_schemes" in data
    assert data["analysis_type"] == "heuristic_screening"
    assert data["prediction_source"] == "heuristic"
    assert "not" in data["disclaimer"].lower()

    # Since the image is pure green, it should predict healthy
    assert data["crop_matched"] == "tomato"
    assert "healthy" in data["disease"].lower()
    assert data["severity"] == "healthy"  # a healthy verdict is not graded as a lesion stage
    assert len(data["treatment"]) > 0

def test_disease_predict_fallback_maize_lesions(monkeypatch):
    """Test the HSV/texture heuristic fallback for Maize with yellow/brown pixels
    (ML path bypassed — see test_disease_predict_fallback_tomato)."""
    monkeypatch.setattr("backend.main.predict_disease_ml", lambda *a, **k: None)
    # A tiny 1x1 yellow pixel PNG base64: RGB (255, 255, 0)
    img_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4/58BAAT/Af9dfQKHAAAAAElFTkSuQmCC"

    payload = {
        "image_b64": img_b64,
        "crop_id": "maize",
        "region_id": "mp_sehore"
    }

    response = client.post("/api/disease/predict", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["crop_matched"] == "maize"
    assert data["severity"] == "severe"  # Pure yellow/brown pixel represents severe lesion
    assert "rust" in data["disease"].lower() or "blight" in data["disease"].lower()

def test_disease_predict_ml_path_schema():
    """When a trained disease_model.onnx is present, the ML path must return
    the same response schema as the heuristic, tagged accordingly. Doesn't
    assert an exact class for this degenerate 1x1 image — a real classifier's
    prediction on an out-of-distribution single-pixel input isn't a
    meaningful thing to pin down, only that the plumbing is correct."""
    import ml.predict as pred
    pred._load_ml_models()
    if pred._ml_disease_session is None:
        import pytest
        pytest.skip("No trained disease_model.onnx present in ml/models/")

    img_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    payload = {"image_b64": img_b64, "crop_id": "tomato", "region_id": "up_lucknow"}

    response = client.post("/api/disease/predict", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["prediction_source"] == "ml_model"
    assert data["analysis_type"] == "trained_classifier_screening"
    assert "PlantVillage" in data["model_provenance"]
    assert 0.0 <= data["confidence"] <= 1.0
    assert data["crop_matched"] == "tomato"

def test_disease_predict_soybean_does_not_assert_confident_health():
    """Soybean has no disease classes in DISEASE_METADATA, so the heuristic
    cannot detect a soybean disease. It must not report a confident 'healthy'
    verdict regardless of image content — confidence should sit at the floor
    and a coverage_note must disclose the gap."""
    # A tiny 1x1 dark/brown pixel PNG that would trigger a disease branch for
    # other crops — for soybean it must still come back low-confidence.
    img_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4/58BAAT/Af9dfQKHAAAAAElFTkSuQmCC"

    payload = {
        "image_b64": img_b64,
        "crop_id": "soybean",
        "region_id": "mp_sehore"
    }

    response = client.post("/api/disease/predict", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["crop_matched"] == "soybean"
    assert data["confidence"] <= 0.45
    assert "coverage_note" in data
    assert "not" in data["coverage_note"].lower()

def test_disease_predict_max_length_rejection():
    """Verify that oversized image payload (>10MB) is rejected with 422 Unprocessable Entity."""
    oversized_b64 = "a" * 10_000_001
    payload = {
        "image_b64": oversized_b64,
        "crop_id": "tomato"
    }
    response = client.post("/api/disease/predict", json=payload)
    assert response.status_code == 422

def test_disease_rate_limit_blocks_after_threshold(monkeypatch):
    """D-8: the endpoint has no auth (it's a public, farmer-facing tool), so
    it now enforces a minimal in-memory per-IP request budget instead.

    Patches the budget down to 3 and starts from a clean counter dict (via
    monkeypatch, so both are restored automatically even if an assertion
    below fails) so this test is fast and independent of both the real
    production limit and any calls other tests in this module already made
    -- TestClient always presents as the same "testclient" address, so
    without a clean slate this would be sensitive to test order.

    Also confirms the 429 actually reaches the client as a 429: the
    endpoint's own `except Exception` clause re-raises everything as a 400,
    and HTTPException is itself an Exception, so the rate-limit check has
    to run before that try block or this would silently become a 400.
    """
    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "_DISEASE_RATE_LIMIT_MAX_REQUESTS", 3)
    monkeypatch.setattr(backend_main, "_disease_rate_limit_log", {})

    img_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    payload = {"image_b64": img_b64, "crop_id": "tomato", "region_id": "up_lucknow"}

    for i in range(3):
        response = client.post("/api/disease/predict", json=payload)
        assert response.status_code == 200, f"call {i + 1}/3 should succeed, got {response.status_code}: {response.text}"

    response = client.post("/api/disease/predict", json=payload)
    assert response.status_code == 429
    assert "detail" in response.json()
    assert "many" in response.json()["detail"].lower()

def test_disease_rate_limit_is_per_ip(monkeypatch):
    """Two distinct callers must not share one budget -- checked directly
    against the counter function so this doesn't depend on TestClient's
    fixed client address."""
    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "_DISEASE_RATE_LIMIT_MAX_REQUESTS", 2)
    monkeypatch.setattr(backend_main, "_disease_rate_limit_log", {})

    assert backend_main._disease_rate_limit_check("1.2.3.4") is True
    assert backend_main._disease_rate_limit_check("1.2.3.4") is True
    assert backend_main._disease_rate_limit_check("1.2.3.4") is False

    # A different caller has its own, unaffected budget.
    assert backend_main._disease_rate_limit_check("5.6.7.8") is True
    assert backend_main._disease_rate_limit_check("5.6.7.8") is True
    assert backend_main._disease_rate_limit_check("5.6.7.8") is False



_GREEN_PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


import pytest  # noqa: E402


@pytest.mark.parametrize("crop", [None, "", "cotton", "rice"])
def test_disease_predict_rejects_unsupported_or_missing_crop(crop):
    """Review 2026-09-23: with no crop (the UI's "Auto-detect" option) or a
    crop the model doesn't cover, screening fell through to tomato diseases --
    a cotton or rice leaf came back with a tomato diagnosis. It must refuse
    and name the crops it can actually screen."""
    r = client.post("/api/disease/predict", json={"image_b64": _GREEN_PX, "crop_id": crop})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "maize" in detail and "tomato" in detail
