"""scripts/ci/prod_check.py runs the same ranking cases as the Phase 0 guards."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("prod_check", ROOT / "scripts" / "ci" / "prod_check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_same_defect_pairs_as_the_phase0_guards():
    from tests.test_phase0_guards import DEFECT_PAIRS
    assert _load().DEFECT_PAIRS == DEFECT_PAIRS


def test_ranking_check_flags_a_loss_beside_a_profit(monkeypatch):
    import json
    pc = _load()
    monkeypatch.setattr(pc, "request", lambda path, body=None: (200, json.dumps(
        [{"expected_profit": 100}, {"expected_profit": -5}]).encode()))
    assert "loss beside a profit" in pc.check_ranking("x", "kharif")
    monkeypatch.setattr(pc, "request", lambda path, body=None: (200, json.dumps(
        [{"expected_profit": -5, "all_options_lose": True}]).encode()))
    assert pc.check_ranking("x", "zaid") is None
    monkeypatch.setattr(pc, "request", lambda path, body=None: (404, b"nope"))
    assert "404" in pc.check_static("/Data/tractors.js")
