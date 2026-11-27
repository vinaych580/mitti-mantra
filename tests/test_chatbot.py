"""
tests/test_chatbot.py
Comprehensive unit tests for backend.chatbot intent matching and conversational context.
"""
from __future__ import annotations

import csv
from pathlib import Path

import pytest

from backend.chatbot import answer
from engine.chatbot_i18n import (
    STATE_SYNONYMS,
    T,
    _DEVANAGARI,
    _KANNADA,
    _TELUGU,
    detect_lang,
)


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


# ---------------------------------------------------------------------------
# C-23: STATE_SYNONYMS missing states per language (Telugu/Kannada gaps,
# Kannada also missing Telangana -- the flagship demo region used in every
# language's own suggestion chips).
# ---------------------------------------------------------------------------
def _dataset_state_prefixes() -> set:
    """The real, canonical set of state prefixes this app has data for,
    derived from dataset/soil.csv's region_id column (e.g. "telangana" from
    "telangana_medak") rather than a generic/guessed India states list."""
    path = Path(__file__).resolve().parent.parent / "dataset" / "soil.csv"
    with open(path, encoding="utf-8") as f:
        region_ids = {row["region_id"] for row in csv.DictReader(f)}
    return {rid.split("_", 1)[0] for rid in region_ids}


def test_state_synonyms_cover_every_dataset_state_in_all_languages_c23():
    """Every state prefix that actually backs a region in dataset/soil.csv
    must be reachable via a native-script STATE_SYNONYMS entry in Hindi,
    Telugu AND Kannada. Before the fix, Telugu was missing 7 states and
    Kannada was missing those same 7 plus Telangana."""
    needed = _dataset_state_prefixes()
    assert "telangana" in needed  # sanity: the flagship demo region is real

    covered = {"hi": set(), "te": set(), "kn": set()}
    for native, prefix in STATE_SYNONYMS.items():
        if _DEVANAGARI.search(native):
            covered["hi"].add(prefix)
        elif _TELUGU.search(native):
            covered["te"].add(prefix)
        elif _KANNADA.search(native):
            covered["kn"].add(prefix)

    for lang, cov in covered.items():
        missing = sorted(needed - cov)
        assert not missing, f"STATE_SYNONYMS[{lang}] is missing states: {missing}"


def test_chatbot_kn_recommend_chip_resolves_telangana_medak_c23():
    """Exact reproduction from the audit: a Kannada crop-recommendation
    query with no region led the bot to suggest its own "Telangana Medak"
    chip; clicking/resending that exact chip text used to loop back to the
    identical unresolved "which region?" reply forever because Kannada's
    STATE_SYNONYMS had no entry for Telangana. Confirms the chip now
    actually resolves to region_id=telangana_medak instead of looping."""
    first = answer(T("kn", "sug_recommend_region"))
    assert first["context"].get("region_id") is None
    medak_chip = T("kn", "sug_recommend_medak_kharif")
    assert medak_chip in first["suggestions"]

    second = answer(medak_chip)
    assert second["context"].get("region_id") == "telangana_medak"
    # The defining symptom of the loop: clicking the chip produced the exact
    # same unresolved reply again, with the same chip offered again.
    assert second["reply"] != first["reply"]
    assert medak_chip not in second["suggestions"]


# ---------------------------------------------------------------------------
# C-21: _HINGLISH_WORDS containing ordinary English/Indian-English loanwords
# forces a fully English message into the Hindi reply path. Same bug class
# as C-4 (which removed "mandi"/"kisan" for the identical reason).
# ---------------------------------------------------------------------------
def test_detect_lang_does_not_misfire_on_ordinary_english_words_c21():
    """Each sentence below is unambiguously English (or Indian-English), yet
    every one contains a word that used to be in _HINGLISH_WORDS purely
    because it doubles as a common Hindi function/greeting word."""
    cases = [
        "I hear a hum from the borewell motor",
        "AAP won the Delhi election by a landslide",
        "Namaste! Welcome to our morning yoga class",
        "Let's begin with five rounds of Surya Namaskar",
        "Best paani puri stalls near Marine Drive, Mumbai",
    ]
    for sentence in cases:
        assert detect_lang(sentence) == "en", f"misdetected as non-English: {sentence!r}"


def test_detect_lang_still_detects_real_hinglish_c21():
    """Removing the false-positive-prone words must not gut real Hinglish
    detection -- genuine Hindi-in-Latin-script sentences using the remaining,
    non-ambiguous trigger words should still route to 'hi'."""
    assert detect_lang("kya kal barish hogi") == "hi"
    assert detect_lang("mera khet mein sinchai kab karni hai") == "hi"
    assert detect_lang("gehun ka bhav kitna hai") == "hi"


def test_chatbot_namaste_alone_gets_english_greeting_in_english_session_c21():
    """A bare 'Namaste' is also a valid English greeting (it's literally in
    chatbot.py's own English GREETINGS tuple, and the bot's own English
    greeting reply starts with the word "Namaste!"). It must not force the
    whole reply into a Hindi wall of text."""
    res = answer("Namaste")
    assert res["context"]["lang"] == "en"
    assert res["reply"].startswith("Namaste! I'm **Mitti Mantra's assistant**")


# ---------------------------------------------------------------------------
# C-22: today's MSP-vs-market comparison handler was dead code -- an earlier
# unconditional "plain MSP" branch intercepted the message first.
# ---------------------------------------------------------------------------
def test_chatbot_mspvsmarket_slash_prompts_for_crop_not_raw_dump_c22():
    """/mspvsmarket (no crop named) used to fall through to the plain-MSP
    branch and dump raw MSP JSON for every crop on file. It should instead
    ask which crop, exactly like the other crop-gated slash commands do."""
    res = answer("/mspvsmarket")
    assert "```json" not in res["reply"]
    assert "crop" in res["reply"].lower()


def test_chatbot_msp_against_market_reaches_comparison_handler_c22():
    """'msp against market' / 'compared to' phrasing is only understood by
    the new comparison handler (the old duplicate only recognized vs/versus/
    compared). It used to be intercepted by the plain-MSP branch and return
    a bare single-crop MSP lookup instead of an actual comparison."""
    res = answer("msp against market for rice in mp_sehore")
    assert res["reply"].startswith("### MSP vs Market")


def test_chatbot_msp_vs_market_for_rice_reaches_comparison_handler_c22():
    """The exact phrasing named in the audit reproduction."""
    res = answer("msp vs market for rice")
    assert "```json" not in res["reply"]
    assert "region" in res["reply"].lower()


# ---------------------------------------------------------------------------
# C-14: the English "suggest(ion)" trigger requires a nearby crop/grow/
# plant/sow word (already fixed); the Hindi सुझाव equivalent never got the
# same restriction, so it hijacked unrelated questions like pest queries.
# ---------------------------------------------------------------------------
def test_chatbot_hindi_suggestion_for_pest_routes_to_pest_not_recommend_c14():
    """'चावल में कीट के लिए सुझाव' (suggestion for pest in rice) used to
    wrongly match the bare सुझाव trigger and route to the crop-recommendation
    "which region?" clarification instead of pest info."""
    res = answer("चावल में कीट के लिए सुझाव")
    assert res["reply"] != T("hi", "recommend_need_region")
    assert "कीट" in res["reply"]


def test_chatbot_hindi_suggestion_for_crop_still_routes_to_recommend_c14():
    """The gate must not break the legitimate case: a सुझाव query that IS
    actually about which crop to grow should still reach the recommend
    intent (and, with no region given, land on the same "which region?"
    prompt that intent always gives -- proving it reached recommend, not
    the generic fallback or some other intent)."""
    res = answer("मेरी फसल के लिए सुझाव दीजिए")
    assert res["reply"] == T("hi", "recommend_need_region")


@pytest.mark.parametrize("text", [
    "3 acres 20000 budget", "20000 budget 3 acres", "budget 20000 for 3 acres",
    "15000 budget and 3 acres", "3 acres and 15000 budget",
])
def test_acres_bind_to_the_number_before_them(text):
    from backend.chatbot import _find_tagged_numbers
    tags = _find_tagged_numbers(text)
    assert tags["area"] == 3.0
    assert tags["budget"] in (15000.0, 20000.0)


def test_unstated_budget_is_the_regions_typical_cost():
    """N-7: the chat used a flat Rs 15,000/acre, below rice and cotton's cost."""
    import ml.predict as P
    from backend.chatbot import answer
    reply = answer("what should I grow in medak this kharif", {})["reply"]
    typical = round(P.typical_budget_per_acre("telangana_medak", "kharif"))
    assert f"₹{typical:,}/acre" in reply
