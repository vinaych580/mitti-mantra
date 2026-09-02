"""
tests/test_commitment_log.py
Unit tests for utils/commitment_log.py -- the regional-saturation commit
log written to by /api/commit-crop and read by ml/predict.py's saturation
scoring (see docs/superpowers/specs/2026-09-02-regional-saturation-aware-recommendations-design.md).
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def isolated_commitments_file(tmp_path, monkeypatch):
    from utils import commitment_log
    monkeypatch.setattr(commitment_log, "_COMMITMENTS_PATH", tmp_path / "commitments.csv")
    yield


def test_read_all_returns_empty_list_when_file_missing():
    from utils.commitment_log import read_all
    assert read_all() == []


def test_upsert_creates_a_row():
    from utils.commitment_log import read_all, upsert
    upsert(
        region_id="telangana_medak", crop_id="cotton", season="kharif",
        year=2026, area_acres=4.5, device_id="dev_a",
    )
    rows = read_all()
    assert len(rows) == 1
    assert rows[0]["region_id"] == "telangana_medak"
    assert rows[0]["crop_id"] == "cotton"
    assert rows[0]["season"] == "kharif"
    assert rows[0]["year"] == "2026"
    assert rows[0]["area_acres"] == "4.5"
    assert rows[0]["device_id"] == "dev_a"
    assert rows[0]["commitment_id"].startswith("c_")
    assert rows[0]["timestamp"]


def test_upsert_overwrites_prior_commitment_from_same_device():
    from utils.commitment_log import read_all, upsert
    upsert(region_id="telangana_medak", crop_id="cotton", season="kharif", year=2026, area_acres=4.5, device_id="dev_a")
    upsert(region_id="telangana_medak", crop_id="soybean", season="kharif", year=2026, area_acres=3.0, device_id="dev_a")
    rows = read_all()
    assert len(rows) == 1, "second commit from the same device/region/season/year must replace the first, not add a row"
    assert rows[0]["crop_id"] == "soybean"
    assert rows[0]["area_acres"] == "3.0"


def test_upsert_keeps_separate_rows_for_different_devices():
    from utils.commitment_log import read_all, upsert
    upsert(region_id="telangana_medak", crop_id="cotton", season="kharif", year=2026, area_acres=4.5, device_id="dev_a")
    upsert(region_id="telangana_medak", crop_id="cotton", season="kharif", year=2026, area_acres=2.0, device_id="dev_b")
    rows = read_all()
    assert len(rows) == 2


def test_upsert_keeps_separate_rows_for_different_seasons():
    from utils.commitment_log import read_all, upsert
    upsert(region_id="telangana_medak", crop_id="cotton", season="kharif", year=2026, area_acres=4.5, device_id="dev_a")
    upsert(region_id="telangana_medak", crop_id="wheat", season="rabi", year=2026, area_acres=4.5, device_id="dev_a")
    rows = read_all()
    assert len(rows) == 2
