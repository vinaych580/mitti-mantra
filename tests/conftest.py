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

This autouse fixture redirects utils.db.DB_PATH to a fresh temp SQLite file
for every test in the suite, so no test observes real commitment/sensor
data written by manual runs or other test modules -- commitment_log.py and
sensor_log.py share this one database (see utils/db.py). It's the safety
net for the whole suite; a module's own local fixture pointed at the same
attribute is redundant with this one but harmless to keep.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _isolated_db_global(tmp_path, monkeypatch):
    from utils import db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "agrisim.db")
    yield
