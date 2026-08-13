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
    
    # Check that disease model status is included
    assert "disease_model_loaded" in data
    assert data["disease_model_loaded"] is True

def test_disease_predict_fallback_tomato():
    """Test backend fallback prediction for Tomato."""
    # Create a small 3x3 mock green leaf image encoded in base64
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
    
    # Since the image is pure green, it should predict healthy
    assert data["crop_matched"] == "tomato"
    assert "healthy" in data["disease"].lower()
    assert data["severity"] == "early"
    assert len(data["treatment"]) > 0

def test_disease_predict_fallback_maize_lesions():
    """Test backend fallback prediction for Maize with yellow/brown pixels."""
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

def test_static_model_serving():
    """Verify that model.json and group1-shard1of1.bin are served under /models/disease/."""
    # model.json
    res_json = client.get("/models/disease/model.json")
    assert res_json.status_code == 200
    data = res_json.json()
    assert data["format"] == "layers-model"
    assert "modelTopology" in data
    assert "weightsManifest" in data
    
    # binary weights shard
    res_bin = client.get("/models/disease/group1-shard1of1.bin")
    assert res_bin.status_code == 200
    assert len(res_bin.content) == 386 * 4  # 386 float32 values = 1544 bytes

def test_disease_predict_max_length_rejection():
    """Verify that oversized image payload (>10MB) is rejected with 422 Unprocessable Entity."""
    oversized_b64 = "a" * 10_000_001
    payload = {
        "image_b64": oversized_b64,
        "crop_id": "tomato"
    }
    response = client.post("/api/disease/predict", json=payload)
    assert response.status_code == 422

