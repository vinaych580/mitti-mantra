"""
tests/test_ml_pipeline_isolation.py

Regression test for the bug where ml/evaluate_models.py (a dev-only
benchmarking script) silently overwrote the same production model files
ml/train_models.py writes, using a different, easier synthetic dataset --
see docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md.

After this fix, running evaluate_models.py's pipeline must never change
what /api/ml/train would later load.
"""
from __future__ import annotations

import ml.evaluate_models as E


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
