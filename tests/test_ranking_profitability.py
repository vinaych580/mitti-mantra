"""A farmer asking what to sow must never see a money-losing crop ranked
above one that makes money (review 2026-09-23: jute at -Rs 2,540 ranked
above groundnut at +Rs 52,973 for Medak kharif)."""
import ml.predict as P


def test_rank_puts_every_profitable_crop_first():
    recs = [
        {"crop_id": "a", "expected_profit": -10, "smart_score": 90},
        {"crop_id": "b", "expected_profit": 500, "smart_score": 40},
        {"crop_id": "c", "expected_profit": 0, "smart_score": 80},
        {"crop_id": "d", "expected_profit": 100, "smart_score": 60},
    ]
    assert [r["crop_id"] for r in P.rank_recommendations(recs)] == ["d", "b", "a", "c"]


def test_live_ranking_has_no_loss_above_profit():
    recs = P.recommend_crops("telangana_medak", "kharif", 20000, 3, top_k=50)
    seen_loss = False
    for r in recs:
        if r["expected_profit"] <= 0:
            seen_loss = True
        else:
            assert not seen_loss, f"{r['crop_id']} is profitable but ranked below a loss"
