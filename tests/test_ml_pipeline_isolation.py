"""
tests/test_ml_pipeline_isolation.py

Regression tests for Task 5 refactoring and downstream impact on ml/audit_models.py.

1. Ensure ml/evaluate_models.py no longer writes production artifacts (original Task 5 regression test)
2. Ensure ml/audit_models.py correctly unpacks the 6-tuple from dataset_builders._build_yield_dataset()
   (regression test for the re-export mechanism impact)
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
import ml.evaluate_models as E
import ml.audit_models as A


def test_evaluate_models_does_not_write_production_artifacts(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "MODEL_DIR", tmp_path)

    pipeline = E.ModelEvaluationPipeline()
    pipeline.run_pipeline()

    written = {p.name for p in tmp_path.iterdir()}
    forbidden = {
        "recommend_model.joblib", "yield_model.joblib",
        "recommend_encoders.joblib", "yield_encoders.joblib", "label_encoders.joblib",
        "holdout_recommend.joblib", "holdout_yield.joblib",
    }
    assert not (written & forbidden), f"evaluate_models wrote production files: {written & forbidden}"
    assert "evaluation_manifest.json" in written


def test_audit_models_unpacks_yield_dataset_6tuple(tmp_path, monkeypatch):
    """
    Regression test for ml/audit_models.py's yield dataset unpacking.

    Before Task 5, ml/audit_models.py imported _build_yield_dataset from
    ml/evaluate_models, which had its own 5-tuple version. After Task 5,
    ml/evaluate_models re-exports dataset_builders' 6-tuple version.

    This test verifies that ModelAuditor.run_audit() correctly unpacks
    the 6-tuple (including the unused 'source' parameter) and completes
    without raising ValueError.

    The test is isolated using monkeypatch to avoid writing to real
    production files, following the same pattern as test_evaluate_models_does_not_write_production_artifacts.
    """
    # Isolate MODEL_DIR to temporary test directory
    monkeypatch.setattr(A, "MODEL_DIR", tmp_path)

    # Copy required fixture files from real ml/models/ to tmp_path
    BASE_DIR = Path(__file__).resolve().parents[1]
    real_model_dir = BASE_DIR / "ml" / "models"

    required_files = {
        "recommend_model.joblib",
        "yield_model.joblib",
        "recommend_encoders.joblib",
        "yield_encoders.joblib",
        "holdout_recommend.joblib",
        "holdout_yield.joblib",
    }

    for fname in required_files:
        src = real_model_dir / fname
        assert src.exists(), f"Missing fixture file: {fname} (run Task 4 training first)"
        shutil.copy(src, tmp_path / fname)

    # Run audit in isolated tmp_path - should not raise ValueError from unpacking mismatch
    auditor = A.ModelAuditor()
    auditor.run_audit()

    # Verify audit output was created in tmp_path with expected structure
    audit_path = tmp_path / "audit_metrics.json"
    assert audit_path.exists(), "audit_metrics.json not created in isolated tmp_path"

    with open(audit_path, "r") as f:
        audit_data = json.load(f)

    # Verify yield_prediction section exists and has expected keys
    assert "yield_prediction" in audit_data, "yield_prediction section missing from audit_metrics.json"
    yield_section = audit_data["yield_prediction"]

    expected_keys = {"r2", "mae", "rmse", "mape_pct", "permutation_importances", "robustness_drought_r2", "evaluated_on_persisted_holdout"}
    assert expected_keys.issubset(yield_section.keys()), f"yield_prediction missing keys: {expected_keys - yield_section.keys()}"

    # Verify values are sensible (r2 should be a number, permutation_importances should be a dict)
    assert isinstance(yield_section["r2"], (int, float)), "r2 should be numeric"
    assert isinstance(yield_section["permutation_importances"], dict), "permutation_importances should be dict"
    assert len(yield_section["permutation_importances"]) > 0, "permutation_importances should not be empty"
