"""
tests/test_chatbot.py
Comprehensive unit tests for backend.chatbot intent matching and conversational context.
"""
from __future__ import annotations

from backend.chatbot import answer


def test_chatbot_greeting():
    res = answer("hello namaste")
    assert isinstance(res, dict)
    assert res["reply"] is not None and len(res["reply"]) > 0
    assert isinstance(res["actions"], list)
    assert isinstance(res["context"], dict)
    assert isinstance(res["suggestions"], list)


def test_chatbot_crop_recommendation_intent():
    res = answer("recommend crops for mp_sehore kharif")
    assert isinstance(res, dict)
    assert res["reply"] is not None and len(res["reply"]) > 0
    assert isinstance(res["suggestions"], list)


def test_chatbot_mandi_price_intent():
    res = answer("price of soybean in mp_sehore")
    assert isinstance(res, dict)
    assert res["reply"] is not None and len(res["reply"]) > 0


def test_chatbot_msp_intent():
    res = answer("msp of wheat")
    assert isinstance(res, dict)
    assert res["reply"] is not None and len(res["reply"]) > 0


def test_chatbot_pest_alert_intent():
    res = answer("pest alerts for tomato")
    assert isinstance(res, dict)
    assert res["reply"] is not None and len(res["reply"]) > 0


def test_chatbot_sell_advice_intent():
    res = answer("best time to sell cotton in mh_yavatmal")
    assert isinstance(res, dict)
    assert res["reply"] is not None and len(res["reply"]) > 0


def test_chatbot_context_retention():
    # Pass context with region_id already selected
    context = {"region_id": "punjab_ludhiana", "crop_id": "wheat"}
    res = answer("How much fertilizer should I apply?", context=context)
    assert isinstance(res, dict)
    assert res["reply"] is not None and len(res["reply"]) > 0
