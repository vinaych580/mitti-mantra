"""
tests/conftest.py

Session-wide test isolation fixtures.

Whole-branch review finding: only tests/test_commitment_log.py had its own
local `isolated_commitments_file` fixture, scoped to that one test module.
Every other test that transitively calls ml.predict.recommend_crops() (e.g.
tests/test_ml_batch_predict.py's golden-fixture tests) was reading the real,
uncontrolled dataset/dynamic/commitments.csv on disk -- so local manual
verification commitments sitting in that file could silently change
golden-fixture results depending on which region/crop/season they happen to
match.

This autouse fixture redirects utils.commitment_log._COMMITMENTS_PATH to a
fresh temp path for every test in the suite, so no test observes real
commitment data written by manual runs or other test modules. It's the
safety net for the whole suite; test_commitment_log.py's own local fixture
is redundant with this one but harmless to keep (whichever applies last
still points at an isolated tmp_path).
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _isolated_commitments_file_global(tmp_path, monkeypatch):
    from utils import commitment_log
    monkeypatch.setattr(commitment_log, "_COMMITMENTS_PATH", tmp_path / "commitments.csv")
    yield


@pytest.fixture(autouse=True)
def _isolated_sensor_readings_file_global(tmp_path, monkeypatch):
    from utils import sensor_log
    monkeypatch.setattr(sensor_log, "_SENSOR_READINGS_PATH", tmp_path / "sensor_readings.csv")
    yield
