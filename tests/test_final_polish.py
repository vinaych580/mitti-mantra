"""Regression tests for the pre-presentation polish pass (2026-11-27)."""
from backend.chatbot import _fmt_inr, answer
from engine.intelligence_layer import explain_crop_recommendation

CTX = {"region_id": "mp_sehore", "season": "kharif"}


def ask(q):
    return answer(q, dict(CTX))


def test_inr_uses_indian_grouping():
    assert _fmt_inr(153496) == "₹1,53,496"
    assert _fmt_inr(950) == "₹950"
    assert _fmt_inr(-8361) == "-₹8,361"


def test_alkaline_soil_is_never_told_to_lime():
    acid = explain_crop_recommendation("groundnut", "Groundnut", {"ph": 5.0}, {}, 23500, {})[0]
    alkaline = explain_crop_recommendation("groundnut", "Groundnut", {"ph": 7.9}, {}, 23500, {})[0]
    assert "lime raises it" in acid
    assert "Do not lime" in alkaline and "gypsum" in alkaline
    assert "--" not in acid + alkaline


def test_leaf_symptoms_route_to_screening():
    r = ask("my tomato leaves have brown spots what to do")
    assert "Leaf symptom screening" in r["reply"]
    assert any("leaf screening" in a["label"].lower() for a in r["actions"])


def test_fertilizer_dose():
    r = ask("how much urea for rice?")
    assert "Urea" in r["reply"] and "per acre" in r["reply"]


def test_plain_emi_from_lakh_rate_and_tenure():
    r = ask("loan of 2 lakh at 7% for 12 months")
    assert "₹2,00,000" in r["reply"] and "₹17,305" in r["reply"]


def test_old_loan_phrasing_still_works():
    assert "Loan feasibility" in ask("loan for cost 80000 profit 120000")["reply"]


def test_two_crop_comparison():
    r = ask("compare rice and maize in Medak")
    assert "Rice (Paddy)" in r["reply"] and "Maize" in r["reply"] and "profit" in r["reply"]


def test_weather_is_not_a_price_forecast():
    assert "Typical season rainfall" in ask("weather in pune")["reply"]


def test_site_pages_and_identity():
    assert ask("book a tractor")["actions"][0]["href"] == "/book-a-tractor.html"
    assert "assistant" in ask("who are you")["reply"]
    assert "didn't catch" not in ask("how accurate are your models?")["reply"]
    assert "didn't catch" not in ask("carbon credits")["reply"]


def test_sell_advice_names_the_month():
    assert "Month " not in ask("when should I sell my wheat?")["reply"]


def test_telugu_water_question_reaches_irrigation():
    assert ask("వరి పంటకు ఎంత నీరు కావాలి")["actions"][0]["label"].startswith("Open irrigation")
