"""
Language support for the Mitti Mantra chatbot.

chatbot.py used to match English regex only — a farmer typing in Hindi,
Telugu or Kannada (or Hinglish/Tinglish/Kanglish, i.e. those languages typed
in Latin script) got the English fallback message no matter what they asked.
The dashboard's own UI has spoken Hindi/Telugu/Kannada since i18n.js was
rewritten around a static catalog (see frontend/i18n-data.js); the chatbot was
the one place still deaf to anything but English.

This module supplies everything chatbot.py needs to fix that:

  detect_lang(text)          — guess en/hi/te/kn from script + Hinglish cues
  find_crop_id(text)         — native-script + Hinglish crop name -> crop_id
  find_season(text)          — native-script + Hinglish season name -> season
  normalize_region_text(text)— swap native state names for their English
                                token so the existing region_id matcher works
  GREETING_WORDS[lang]       — greeting words per language
  INTENT_PATTERNS[intent]    — extra native-script/Hinglish regex alternation
                                to OR into chatbot.py's existing English regex
  T(lang, key, **kwargs)     — localized reply string lookup, with a .format()
                                pass and a silent fallback to English

Numbers, crop names as returned by the CSV (crop_name), and region display
names are deliberately left untranslated here, same scoping decision as the
frontend catalog: getting the surrounding scaffold right in three languages
beats attempting per-value translation of everything the engine returns.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

# ---------------------------------------------------------------------------
# Script detection
# ---------------------------------------------------------------------------
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_TELUGU = re.compile(r"[ఀ-౿]")
_KANNADA = re.compile(r"[ಀ-೿]")

# Common romanized (Hinglish) function words — enough to catch a Hindi
# sentence typed in Latin script, which is how a large share of Indian
# WhatsApp/SMS-literate users actually type. Deliberately short and common
# words only, to keep false positives on English text low.
#
# NOTE (C-4 fix): "mandi" and "kisan" were removed from this list. Both are
# everyday English-Indian vocabulary that this platform itself uses
# constantly in English sentences ("mandi price", "PM-KISAN scheme", "Kisan
# Credit Card") — having them here misdetected ordinary English messages as
# Hindi and (combined with sticky context.lang in backend/chatbot.py) could
# lock an entire English session into Hindi replies after a single mention
# of "mandi".
#
# NOTE (C-21 fix): the same bug class recurred -- "hum" ("I hear a hum from
# the borewell motor") and "aap" ("AAP won the election", the Aam Aadmi
# Party) are ordinary English/Indian-English words, not Hindi-only. A full
# systematic re-audit (every remaining word tested against a realistic
# English sentence using it in its own English sense, per detect_lang())
# additionally found and removed:
#   - "namaste" / "namaskar" — both are recognized English loanwords used
#     constantly in English yoga/wellness writing ("Surya Namaskar"), and
#     both are *already* in chatbot.py's own English GREETINGS tuple, and
#     this module's own English greeting reply literally starts with
#     "Namaste!" -- so keeping them here was self-contradictory as well as
#     a false-positive risk.
#   - "paani" — "paani puri" (also spelled "pani puri") is a common snack
#     name in ordinary English food writing across India, the same
#     loanword-in-English-sentences pattern as "mandi"/"kisan".
# Every other word here was tested the same way and kept only because it
# has no standalone English/Indian-English meaning (e.g. "kya", "fasal",
# "chahiye", "sinchai" are not English vocabulary in any register).
_HINGLISH_WORDS = {
    "kya", "kaise", "kaisa", "kab", "kahan", "kitna", "kitne", "kitni",
    "fasal", "fasl", "kheti", "bhav", "daam", "mausam",
    "beej", "khad", "sinchai", "zameen", "jameen", "rupaye",
    "bataye", "batao", "bataiye", "chahiye", "acha", "theek",
    "dhanyavad", "shukriya", "mera", "meri",
}


def detect_lang(text: str) -> str:
    """Best-effort guess at en/hi/te/kn from a raw user message."""
    if _DEVANAGARI.search(text):
        return "hi"
    if _TELUGU.search(text):
        return "te"
    if _KANNADA.search(text):
        return "kn"
    words = set(re.findall(r"[a-zA-Z]+", text.lower()))
    if words & _HINGLISH_WORDS:
        return "hi"
    return "en"


# ---------------------------------------------------------------------------
# Greetings (native-script + Hinglish; chatbot.py's GREETINGS tuple stays
# English-only and this list is unioned with it)
# ---------------------------------------------------------------------------
GREETING_WORDS: Dict[str, List[str]] = {
    "hi": ["नमस्ते", "नमस्कार", "हाय", "हैलो", "प्रणाम"],
    "te": ["నమస్తే", "హాయ్", "హలో", "వందనాలు"],
    "kn": ["ನಮಸ್ತೆ", "ನಮಸ್ಕಾರ", "ಹಾಯ್", "ಹಲೋ"],
}

# ---------------------------------------------------------------------------
# Crop synonyms — native name / common Hinglish spelling -> crop_id.
# crop_id values must match dataset/crop_parameters.csv (see backend/chatbot.py
# _crop_by_id). Covers the crops actually present in that CSV.
# ---------------------------------------------------------------------------
CROP_SYNONYMS: Dict[str, str] = {
    # Hindi (Devanagari)
    "चावल": "rice", "धान": "rice",
    "गेहूं": "wheat", "गेहूँ": "wheat",
    "मक्का": "maize", "मक्की": "maize",
    "गन्ना": "sugarcane",
    "कपास": "cotton",
    "सोयाबीन": "soybean",
    "मूंगफली": "groundnut",
    "टमाटर": "tomato",
    "आलू": "potato",
    "प्याज": "onion", "प्याज़": "onion",
    "दाल": "pulses", "दालें": "pulses",
    "अरहर": "pulses", "तूर": "pulses",
    "चना": "chickpea",
    "सरसों": "mustard",
    "बाजरा": "bajra",
    "ज्वार": "jowar",
    # Telugu
    "వరి": "rice", "బియ్యం": "rice",
    "గోధుమ": "wheat", "గోధుమలు": "wheat",
    "మొక్కజొన్న": "maize",
    "చెరకు": "sugarcane",
    "పత్తి": "cotton",
    "సోయాబీన్": "soybean",
    "వేరుశనగ": "groundnut",
    "టమాటా": "tomato", "టమోటా": "tomato",
    "బంగాళదుంప": "potato", "ఆలుగడ్డ": "potato",
    "ఉల్లిపాయ": "onion",
    "పప్పు": "pulses", "కందిపప్పు": "pulses",
    "శనగ": "chickpea",
    "ఆవాలు": "mustard",
    "సజ్జ": "bajra",
    "జొన్న": "jowar",
    # Kannada
    "ಅಕ್ಕಿ": "rice", "ಭತ್ತ": "rice",
    "ಗೋಧಿ": "wheat",
    "ಜೋಳ": "maize",
    "ಕಬ್ಬು": "sugarcane",
    "ಹತ್ತಿ": "cotton",
    "ಸೋಯಾಬೀನ್": "soybean",
    "ಶೇಂಗಾ": "groundnut", "ಕಡಲೆಕಾಯಿ": "groundnut",
    "ಟೊಮ್ಯಾಟೊ": "tomato", "ಟೊಮೇಟೊ": "tomato",
    "ಆಲೂಗಡ್ಡೆ": "potato",
    "ಈರುಳ್ಳಿ": "onion",
    "ಬೇಳೆ": "pulses", "ತೊಗರಿ": "pulses",
    "ಕಡಲೆ": "chickpea",
    "ಸಾಸಿವೆ": "mustard",
    "ಸಜ್ಜೆ": "bajra",
    "ಜೋಳ_ಬಿಳಿ": "jowar",
    # Hinglish (romanized Hindi — the actual English crop_id already matches
    # English names, so only the distinctly Hindi spellings are listed here)
    "chawal": "rice", "dhaan": "rice",
    "gehun": "wheat", "gehu": "wheat",
    "makka": "maize", "makki": "maize",
    "ganna": "sugarcane",
    "kapas": "cotton",
    "moongfali": "groundnut", "mungfali": "groundnut",
    "tamatar": "tomato",
    "aloo": "potato",
    "pyaz": "onion", "pyaaz": "onion",
    "dal": "pulses", "daal": "pulses", "arhar": "pulses", "toor": "pulses",
    "chana": "chickpea",
    "sarson": "mustard",
    "bajra": "bajra",
    "jowar": "jowar",
}


_LATIN_ONLY = re.compile(r"^[a-z]+$")


def _contains_word(name: str, t: str) -> bool:
    """True if `name` occurs as a whole word inside `t`.

    Devanagari/Telugu/Kannada vowel signs and anusvara/virama are Unicode
    category Mn ("mark, nonspacing") — Python's `\\w` does not include Mn, so
    `\\b` silently breaks *inside* almost any real Indic word (e.g. it splits
    "गेहूं" between the base consonant and its matras). Plain substring
    containment sidesteps that; false positives are an acceptable trade-off
    for this small, domain-specific vocabulary. Latin-script (Hinglish)
    entries keep a real `\\b` word-boundary match, where it works correctly
    and matters more (e.g. "dal" as a standalone word vs. inside "dalna").
    """
    if _LATIN_ONLY.match(name):
        return bool(re.search(rf"\b{re.escape(name)}\b", t))
    return name in t


def find_crop_id(text: str) -> Optional[str]:
    """Native-script or Hinglish crop name -> crop_id, longest match first."""
    t = text.lower()
    for name, cid in sorted(CROP_SYNONYMS.items(), key=lambda kv: -len(kv[0])):
        if _contains_word(name.lower(), t):
            return cid
    return None


# ---------------------------------------------------------------------------
# Season synonyms
# ---------------------------------------------------------------------------
SEASON_SYNONYMS: Dict[str, str] = {
    "खरीफ": "kharif", "रबी": "rabi", "जायद": "zaid", "ज़ायद": "zaid",
    "ఖరీఫ్": "kharif", "రబీ": "rabi", "జాయద్": "zaid",
    "ಖರೀಫ್": "kharif", "ರಬಿ": "rabi", "ಜಾಯಿದ್": "zaid",
    "kharif": "kharif", "rabi": "rabi", "zaid": "zaid",
}


def find_season(text: str) -> Optional[str]:
    t = text.lower()
    for name, season in SEASON_SYNONYMS.items():
        if name in t:
            return season
    return None


# ---------------------------------------------------------------------------
# Region / state name synonyms — native state name -> the exact prefix used
# in dataset/soil.csv's region_id (e.g. "guj_anand", "mh_pune"; some states
# are abbreviated there, others spelled out, so the prefix isn't always the
# obvious English word). Swapped into the text before the existing region_id
# matcher runs, so "पंजाब लुधियाना" resolves the same way "punjab ludhiana"
# does, and see find_region_prefix() below for states with a single region,
# where the state name alone is enough with no district needed.
# ---------------------------------------------------------------------------
STATE_SYNONYMS: Dict[str, str] = {
    "तेलंगाना": "telangana", "पंजाब": "punjab", "गुजरात": "guj",
    "बिहार": "bihar", "राजस्थान": "rajasthan", "हरियाणा": "haryana",
    "महाराष्ट्र": "mh", "कर्नाटक": "kar", "केरल": "kerala",
    "पश्चिम बंगाल": "wb", "उत्तर प्रदेश": "up", "मध्य प्रदेश": "mp",
    "तमिलनाडु": "tn", "ओडिशा": "odisha", "झारखंड": "jharkhand",
    "असम": "assam", "गोवा": "goa", "त्रिपुरा": "tripura",
    "उत्तराखंड": "uk", "हिमाचल प्रदेश": "hp", "छत्तीसगढ़": "chhattisgarh",
    "आंध्र प्रदेश": "ap", "जम्मू कश्मीर": "jk",
    "తెలంగాణ": "telangana", "పంజాబ్": "punjab", "గుజరాత్": "guj",
    "బీహార్": "bihar", "రాజస్థాన్": "rajasthan", "హర్యానా": "haryana",
    "మహారాష్ట్ర": "mh", "కర్ణాటక": "kar", "కేరళ": "kerala",
    "పశ్చిమ బెంగాల్": "wb", "ఉత్తర ప్రదేశ్": "up", "మధ్య ప్రదేశ్": "mp",
    "తమిళనాడు": "tn", "ఒడిశా": "odisha", "జార్ఖండ్": "jharkhand",
    "ఆంధ్రప్రదేశ్": "ap",
    # C-23 fix: Telugu was missing these 7 states entirely (no region in
    # dataset/soil.csv using them was reachable from a Telugu message).
    "అస్సాం": "assam", "ఛత్తీస్‌గఢ్": "chhattisgarh", "గోవా": "goa",
    "హిమాచల్ ప్రదేశ్": "hp", "జమ్మూ కశ్మీర్": "jk", "త్రిపుర": "tripura",
    "ఉత్తరాఖండ్": "uk",
    "ಪಂಜಾಬ್": "punjab", "ಗುಜರಾತ್": "guj", "ಬಿಹಾರ": "bihar",
    "ರಾಜಸ್ಥಾನ": "rajasthan", "ಹರಿಯಾಣ": "haryana", "ಮಹಾರಾಷ್ಟ್ರ": "mh",
    "ಕರ್ನಾಟಕ": "kar", "ಕೇರಳ": "kerala", "ಪಶ್ಚಿಮ ಬಂಗಾಳ": "wb",
    "ಉತ್ತರ ಪ್ರದೇಶ": "up", "ಮಧ್ಯ ಪ್ರದೇಶ": "mp", "ತಮಿಳುನಾಡು": "tn",
    "ಒಡಿಶಾ": "odisha", "ಜಾರ್ಖಂಡ್": "jharkhand", "ಆಂಧ್ರಪ್ರದೇಶ": "ap",
    # C-23 fix: Kannada was missing these same 7 states, PLUS Telangana --
    # the flagship demo region used in every language's own suggestion
    # chips (e.g. REPLY["kn"]["sug_recommend_medak_kharif"]). A Kannada user
    # clicking the bot's own "Telangana Medak" suggestion chip previously
    # got stuck in an infinite loop of the identical unresolved reply,
    # since "ತೆಲಂಗಾಣ" never resolved to a region.
    "ತೆಲಂಗಾಣ": "telangana", "ಅಸ್ಸಾಂ": "assam",
    "ಛತ್ತೀಸ್‌ಗಢ": "chhattisgarh", "ಗೋವಾ": "goa",
    "ಹಿಮಾಚಲ ಪ್ರದೇಶ": "hp", "ಜಮ್ಮು ಕಾಶ್ಮೀರ": "jk", "ತ್ರಿಪುರ": "tripura",
    "ಉತ್ತರಾಖಂಡ": "uk",
}


def normalize_region_text(text: str) -> str:
    """Replace any native-script state name with its region_id-prefix token."""
    out = text
    for native, prefix in sorted(STATE_SYNONYMS.items(), key=lambda kv: -len(kv[0])):
        if native in out:
            out = out.replace(native, f" {prefix} ")
    return out


def find_region_by_state_prefix(normalized_text: str, region_ids: List[str]) -> Optional[str]:
    """When a state has exactly one region and the district itself wasn't
    translated (district names aren't in STATE_SYNONYMS), the state name
    alone is enough — e.g. "telangana_medak" is Telangana's only region, so
    "తెలంగాణ మెదక్‌లో ..." resolves even though "మెదక్" was never mapped to
    "medak". For multi-region states (Maharashtra, Gujarat, ...) this
    intentionally returns nothing, since the state alone can't disambiguate
    and guessing a specific district wrongly is worse than asking again.
    """
    t = f" {normalized_text.lower()} "
    by_prefix: Dict[str, List[str]] = {}
    for rid in region_ids:
        prefix = rid.split("_", 1)[0]
        by_prefix.setdefault(prefix, []).append(rid)
    for prefix, rids in by_prefix.items():
        if len(rids) == 1 and re.search(rf"\b{re.escape(prefix)}\b", t):
            return rids[0]
    return None


# ---------------------------------------------------------------------------
# Intent trigger keywords — OR'd into chatbot.py's existing English regex so
# a Hindi/Telugu/Kannada verb routes to the same intent an English one does.
# Each value is a ready-to-splice regex alternation (no surrounding \b — the
# call site wraps it), covering native script + common Hinglish.
# ---------------------------------------------------------------------------
INTENT_PATTERNS: Dict[str, str] = {
    "help": r"मदद|सहायता|क्या कर सकते|సహాయం|ఏమి చేయగలవు|ಸಹಾಯ|ಏನು ಮಾಡಬಲ್ಲೆ|madad|sahayata",
    "list_crops": r"फ़सलों की सूची|कौन सी फ़सल|పంటల జాబితా|ఏ పంటలు|ಬೆಳೆಗಳ ಪಟ್ಟಿ|ಯಾವ ಬೆಳೆ|fasal list|konsi fasal",
    "list_regions": r"क्षेत्रों की सूची|कौन से क्षेत्र|ప్రాంతాల జాబితా|ఏ ప్రాంతాలు|ಪ್ರದೇಶಗಳ ಪಟ್ಟಿ|ಯಾವ ಪ್ರದೇಶ",
    "msp_vs_market": r"एमएसपी.{0,10}(बनाम|और).{0,10}(मंडी|बाज़ार)|MSP.{0,10}(vs|మరియు).{0,10}మార్కెట్|MSP.{0,10}(vs|ಮತ್ತು).{0,10}ಮಾರುಕಟ್ಟೆ",
    "msp": r"एमएसपी|न्यूनतम समर्थन मूल्य|కనీస మద్దతు ధర|ಕನಿಷ್ಠ ಬೆಂಬಲ ಬೆಲೆ",
    # C-14 fix: a bare "सुझाव" (suggestion) used to hijack unrelated
    # questions like "चावल में कीट के लिए सुझाव" (suggestion for pest in
    # rice) into the crop-recommendation flow, before the pest/irrigation/
    # etc. intents ever got a chance to match -- the exact same bug the
    # English "suggest(ion)" trigger was already fixed for in chatbot.py
    # (requiring it to co-occur with a crop/grow/plant/sow word). "सिफारिश"
    # (recommendation) is unambiguous on its own and stays bare, same as
    # English "recommend(ation)?" is never gated either.
    "recommend": r"सिफारिश|सुझाव.*(फ़सल|फसल|उगा|रोप|बुवाई)|(फ़सल|फसल|उगा|रोप|बुवाई).*सुझाव|कौन सी फ़सल लगाऊं|क्या बोऊं|సిఫారసు|ఏ పంట వేయాలి|ಶಿಫಾರಸು|ಯಾವ ಬೆಳೆ ಬೆಳೆಯಲಿ|sifarish|kaunsi fasal|kya boyein",
    "sell_advice": r"बेचने का सही समय|कब बेचूं|అమ్మడానికి సరైన సమయం|ఎప్పుడు అమ్మాలి|ಮಾರಾಟಕ್ಕೆ ಸೂಕ್ತ ಸಮಯ|ಯಾವಾಗ ಮಾರಬೇಕು|kab bechu",
    "mandi_price": r"मंडी भाव|बाज़ार भाव|भाव क्या|మండీ ధర|మార్కెట్ ధర|ధర ఎంత|ಮಂಡಿ ಬೆಲೆ|ಮಾರುಕಟ್ಟೆ ಬೆಲೆ|ಬೆಲೆ ಎಷ್ಟು|mandi bhav|bhav kya",
    "pest": r"कीट|रोग|बीमारी|पुरుగు|వ్యాధి|ಕೀಟ|ರೋಗ",
    "irrigation": r"सिंचाई|पानी कब|నీటిపారుదల|నీరు ఎప్పుడు|ನೀರಾವರಿ|ನೀರು ಯಾವಾಗ|sinchai",
    "calendar": r"बुवाई|कटाई.{0,5}(तारीख|समय)|విత్తనం|కోత సమయం|ಬಿತ್ತನೆ|ಕೊಯ್ಲು ಸಮಯ",
    "schemes": r"योजना|सब्सिडी|బీమా|పథకం|సబ్సిడీ|ಯೋಜನೆ|ಸಬ್ಸಿಡಿ",
    "loan": r"ऋण|कर्ज|लोन|రుణం|అప్పు|ಸಾಲ",
    "about": r"बताओ|बताइए|जानकारी|గురించి చెప్పు|వివరాలు|ಬಗ್ಗೆ ಹೇಳಿ|ಮಾಹಿತಿ",
}


# ---------------------------------------------------------------------------
# Reply localization
# ---------------------------------------------------------------------------
REPLY: Dict[str, Dict[str, str]] = {
    "hi": {
        "greeting": (
            "नमस्ते! मैं **मिट्टी मंत्र का सहायक** हूं — फ़सल सिफारिशें, मंडी भाव, "
            "MSP, सिंचाई, कीट और सरकारी योजनाओं में मदद कर सकता हूं, असली भारतीय "
            "कृषि डेटा के साथ।\n\nपूछ के देखें: _\"तेलंगाना मेडक के लिए खरीफ़ में "
            "₹15000 बजट और 3 एकड़ पर फ़सल सिफारिश करें\"_ या _\"गेहूं का MSP क्या है?\"_"
        ),
        "sug_help": "आप क्या कर सकते हैं?",
        "sug_recommend_region": "मेरे क्षेत्र के लिए फ़सल सिफारिश",
        "sug_msp_wheat": "गेहूं का MSP",
        "sug_list_regions": "क्षेत्रों की सूची",
        "help_intro": "यहां बताया गया है कि **मिट्टी मंत्र** पर मैं क्या कर सकता हूं:\n",
        "help_outro": (
            "\nमुझसे सीधी भाषा में पूछें — जैसे _\"चावल के लिए कीट चेतावनी\"_ या "
            "_\"महाराष्ट्र यवतमाल में कपास बेचने का सही समय\"_।"
        ),
        "sug_recommend": "फ़सल सिफारिश",
        "sug_mandi_tomato": "टमाटर का मंडी भाव",
        "sug_pest_rice": "चावल के लिए कीट चेतावनी",
        "sug_schemes": "सरकारी योजनाएं",
        "no_crop_data": "सर्वर पर कोई फ़सल डेटा लोड नहीं है।",
        "crops_intro": "मेरे पास **{n} फ़सलों** का डेटा है:\n\n",
        "sug_about_rice": "चावल के बारे में बताएं",
        "no_region_data": "सर्वर पर कोई क्षेत्र डेटा लोड नहीं है।",
        "regions_intro": "मेरे पास **{n} क्षेत्रों** के लिए मिट्टी + मौसम डेटा है:\n\n",
        "sug_recommend_medak": "तेलंगाना मेडक के लिए सिफारिश करें",
        "sug_mandi_sehore": "एमपी सेहोर में मंडी भाव",
        "lbl_season": "मौसम",
        "lbl_base_yield": "आधार उपज",
        "lbl_water_need": "जल आवश्यकता",
        "lbl_npk": "NPK (किग्रा/एकड़)",
        "lbl_temp_band": "तापमान सीमा",
        "lbl_avg_cost": "औसत इनपुट लागत",
        "lbl_price_range": "मंडी भाव सीमा",
        "sug_msp_of": "{crop} का MSP",
        "sug_pest_of": "{crop} के लिए कीट चेतावनी",
        "sug_irrigation_of": "{crop} के लिए सिंचाई कार्यक्रम",
        "msp_not_found": "मुझे उस फ़सल का MSP डेटा नहीं मिला।",
        "sug_msp_wheat2": "गेहूं का MSP",
        "sug_msp_rice": "चावल का MSP",
        "msp_for": "**{crop} का MSP** (नवीनतम): ₹{price}/क्विंटल।",
        "sug_msp_vs_of": "{crop} के लिए MSP बनाम बाज़ार",
        "sug_sell_time_of": "{crop} बेचने का सही समय",
        "msp_data_intro": "यह रहा MSP डेटा जो मेरे पास है:\n\n```json\n{data}\n```",
        "mandi_not_found": (
            "मुझे उस संयोजन के लिए मंडी भाव नहीं मिले। कोई विशेष फ़सल और "
            "क्षेत्र बताएं।"
        ),
        "sug_mandi_onion": "एमपी सेहोर में प्याज का मंडी भाव",
        "mandi_recent": "हाल के मंडी भाव:\n",
        "sug_forecast_of": "{crop} का मूल्य पूर्वानुमान",
        "sug_sell_time_of2": "{crop} बेचने का सही समय",
        "recommend_need_region": (
            "**क्षेत्र** बताएं (जैसे _तेलंगाना मेडक_ या _एमपी सेहोर_) और "
            "मैं सर्वश्रेष्ठ फ़सलों की सिफारिश करूंगा।"
        ),
        "need_crop": "कौन सी फ़सल? जैसे `{example} rice`",
        "sug_recommend_medak_kharif": "तेलंगाना मेडक के लिए खरीफ़ में सिफारिश करें",
        "recommend_no_strong": "{region} में {season} के लिए कोई मजबूत सिफारिश नहीं है।",
        "recommend_header": "**{region}** में **{season}** के लिए शीर्ष फ़सलें (बजट {budget}/एकड़, {area} एकड़):\n",
        "recommend_line": "{i}. **{name}** — मुनाफ़ा {profit}, ROI {roi}%, जोखिम {risk}/100",
        "sug_open_dashboard": "डैशबोर्ड खोलें",
        "sug_rotation_for": "{region} के लिए फ़सल चक्र योजना",
        "sug_pest_of2": "{crop} के लिए कीट चेतावनी",
        "sell_need_region": "कौन सा क्षेत्र? जैसे _\"महाराष्ट्र यवतमाल में कपास बेचने का सही समय\"_।",
        "sell_error": "बिक्री सलाह की गणना नहीं हो सकी: {err}",
        "sell_header": "### बिक्री सलाह — {crop} @ {region}\n",
        "sell_advice_line": "**सलाह:** {advice}\n",
        "sell_best_month": "- **बेचने का सबसे अच्छा महीना:** महीना {month}",
        "sell_peak_price": "- **अपेक्षित शिखर मूल्य:** ₹{price}/किग्रा",
        "sell_current_price": "- **वर्तमान भाव:** ₹{price}/किग्रा",
        "sell_uplift": "- **आज की तुलना में वृद्धि:** {pct}%",
        "sell_trend": "- **हाल का रुझान:** {trend}",
        "pest_header": "### कीट व रोग जोखिम — {crop}\n",
        "pest_none": "_इन परिस्थितियों के लिए कोई सक्रिय कीट जोखिम संकेत नहीं है।_",
        "pest_severity": "_(गंभीरता: {sev})_",
        "pest_action": "- _कार्रवाई:_ {mgmt}",
        "sug_irrigation_of2": "{crop} के लिए सिंचाई कार्यक्रम",
        "sug_fertilizer_of": "{crop} के लिए उर्वरक",
        "irrigation_header": "### सिंचाई कार्यक्रम — {crop}",
        "irrigation_sub": "_15 जून को बुवाई · {rain} मिमी मौसमी वर्षा_\n",
        "need_crop": "कौन सी फ़सल? जैसे `/{cmd} rice`।",
        "irrigation_table_hdr": "| सप्ताह | चरण | जल आवश्यकता (मिमी) | वर्षा (मिमी) | सिंचाई (मिमी) |",
        "irrigation_none": "_कोई कार्यक्रम उपलब्ध नहीं है।_",
        "irrigation_total": "\n**कुल मौसमी सिंचाई आवश्यकता:** {mm} मिमी",
        "sug_calendar_of": "{crop} के लिए फ़सल कैलेंडर",
        "calendar_header": "### फ़सल कैलेंडर — {crop}\n",
        "calendar_season": "**मौसम: {season}**",
        "schemes_error": "योजनाओं का मिलान नहीं हो सका: {err}",
        "schemes_none": "इस प्रोफ़ाइल के लिए कोई मेल खाती सरकारी योजना नहीं मिली।",
        "schemes_header": "### {area} एकड़ खेत के लिए योग्य योजनाएं\n",
        "schemes_benefit": "- **लाभ:** {benefit}",
        "schemes_apply": "- [यहां आवेदन करें]({link})",
        "loan_need_input": (
            "**कुल लागत** और **अपेक्षित मुनाफ़ा** बताएं, जैसे "
            "_\"लागत 80000 मुनाफ़ा 120000 के लिए ऋण\"_।"
        ),
        "loan_error": "कैलकुलेटर नहीं चल सका: {err}",
        "loan_header": "### ऋण व्यवहार्यता\n",
        "lbl_loan_amount": "ऋण राशि",
        "lbl_emi": "EMI / महीना",
        "lbl_interest_rate": "ब्याज दर (%)",
        "lbl_tenure": "अवधि (महीने)",
        "lbl_total_interest": "कुल ब्याज",
        "lbl_total_repayment": "कुल चुकौती",
        "lbl_profit_after_loan": "ऋण के बाद मुनाफ़ा",
        "lbl_verdict": "निर्णय",
        "msp_vs_need_region": "MSP बनाम बाज़ार की तुलना किस क्षेत्र में करूं?",
        "msp_vs_error": "तुलना नहीं हो सकी: {err}",
        "msp_vs_header": "### MSP बनाम बाज़ार — {crop} @ {region}\n",
        "lbl_msp_year": "MSP वर्ष",
        "lbl_msp_per_kg": "MSP (₹/किग्रा)",
        "lbl_current_mandi": "वर्तमान मंडी भाव",
        "lbl_avg_mandi_6m": "औसत मंडी भाव (6 माह)",
        "lbl_gap_pct": "अंतर (%)",
        "lbl_recommendation": "सिफारिश",
        "fallback": (
            "मुझे समझ नहीं आया। मैं विशेष रूप से **मिट्टी मंत्र** के लिए बना हूं, "
            "इसलिए फ़सलों, क्षेत्रों, मंडी भावों, MSP, सिफारिशों, सिंचाई, कीटों "
            "या सरकारी योजनाओं के बारे में पूछें।\n\nसब कुछ देखने के लिए "
            "**help** टाइप करें, या `/recommend`, `/msp`, `/mandi`, `/pest`, "
            "`/sell`, `/schemes` जैसे स्लैश कमांड आज़माएं।"
        ),
        "sug_help2": "मदद",
        "sug_recommend_medak2": "तेलंगाना मेडक के लिए फ़सल सिफारिश करें",
        "sug_msp_wheat3": "गेहूं का MSP",
        "sug_pest_rice2": "चावल के लिए कीट चेतावनी",
        "generic_error": "पूरा नहीं हो सका: {err}",
    },
    "te": {
        "greeting": (
            "నమస్తే! నేను **మిట్టి మంత్ర సహాయకుడిని** — పంట సిఫారసులు, మండీ ధరలు, "
            "MSP, నీటిపారుదల, పురుగులు మరియు ప్రభుత్వ పథకాలలో సహాయం చేయగలను, "
            "నిజమైన భారత వ్యవసాయ డేటాతో.\n\nఇలా అడగండి: _\"తెలంగాణ మెదక్ కోసం "
            "ఖరీఫ్‌లో ₹15000 బడ్జెట్, 3 ఎకరాలకు పంట సిఫారసు చేయండి\"_ లేదా "
            "_\"గోధుమల MSP ఎంత?\"_"
        ),
        "sug_help": "మీరు ఏమి చేయగలరు?",
        "sug_recommend_region": "నా ప్రాంతం కోసం పంట సిఫారసు",
        "sug_msp_wheat": "గోధుమల MSP",
        "sug_list_regions": "ప్రాంతాల జాబితా",
        "help_intro": "**మిట్టి మంత్ర**లో నేను ఏమి చేయగలనో ఇక్కడ ఉంది:\n",
        "help_outro": (
            "\nసాదా భాషలో అడగండి — ఉదా. _\"వరికి పురుగు హెచ్చరికలు\"_ లేదా "
            "_\"మహారాష్ట్ర యవత్మాల్‌లో పత్తి అమ్మడానికి సరైన సమయం\"_."
        ),
        "sug_recommend": "పంట సిఫారసు",
        "sug_mandi_tomato": "టమాటా మండీ ధర",
        "sug_pest_rice": "వరికి పురుగు హెచ్చరికలు",
        "sug_schemes": "ప్రభుత్వ పథకాలు",
        "no_crop_data": "సర్వర్‌లో పంట డేటా లోడ్ కాలేదు.",
        "crops_intro": "నా వద్ద **{n} పంటల** డేటా ఉంది:\n\n",
        "sug_about_rice": "వరి గురించి చెప్పండి",
        "no_region_data": "సర్వర్‌లో ప్రాంత డేటా లోడ్ కాలేదు.",
        "regions_intro": "నా వద్ద **{n} ప్రాంతాలకు** నేల + వాతావరణ డేటా ఉంది:\n\n",
        "sug_recommend_medak": "తెలంగాణ మెదక్ కోసం సిఫారసు చేయండి",
        "sug_mandi_sehore": "MP సెహోర్‌లో మండీ ధరలు",
        "lbl_season": "సీజన్",
        "lbl_base_yield": "మూల దిగుబడి",
        "lbl_water_need": "నీటి అవసరం",
        "lbl_npk": "NPK (కిలో/ఎకరం)",
        "lbl_temp_band": "ఉష్ణోగ్రత పరిధి",
        "lbl_avg_cost": "సగటు ఇన్‌పుట్ ఖర్చు",
        "lbl_price_range": "మండీ ధర పరిధి",
        "sug_msp_of": "{crop} యొక్క MSP",
        "sug_pest_of": "{crop}కి పురుగు హెచ్చరికలు",
        "sug_irrigation_of": "{crop}కి నీటిపారుదల షెడ్యూల్",
        "msp_not_found": "ఆ పంటకు MSP డేటా కనుగొనబడలేదు.",
        "sug_msp_wheat2": "గోధుమల MSP",
        "sug_msp_rice": "వరి MSP",
        "msp_for": "**{crop} MSP** (తాజా): ₹{price}/క్వింటాల్.",
        "sug_msp_vs_of": "{crop}కి MSP vs మార్కెట్",
        "sug_sell_time_of": "{crop} అమ్మడానికి సరైన సమయం",
        "msp_data_intro": "నా వద్ద ఉన్న MSP డేటా ఇదిగో:\n\n```json\n{data}\n```",
        "mandi_not_found": (
            "ఆ కలయిక కోసం మండీ ధరలు కనుగొనబడలేదు. నిర్దిష్ట పంట మరియు "
            "ప్రాంతం చెప్పండి."
        ),
        "sug_mandi_onion": "MP సెహోర్‌లో ఉల్లిపాయ మండీ ధర",
        "mandi_recent": "ఇటీవలి మండీ ధరలు:\n",
        "sug_forecast_of": "{crop} ధర అంచనా",
        "sug_sell_time_of2": "{crop} అమ్మడానికి సరైన సమయం",
        "recommend_need_region": (
            "**ప్రాంతం** చెప్పండి (ఉదా. _తెలంగాణ మెదక్_ లేదా _MP సెహోర్_) "
            "నేను ఉత్తమ పంటలను సిఫారసు చేస్తాను."
        ),
        "need_crop": "ఏ పంట? ఉదా. `{example} rice`",
        "sug_recommend_medak_kharif": "తెలంగాణ మెదక్ కోసం ఖరీఫ్‌లో సిఫారసు చేయండి",
        "recommend_no_strong": "{region}లో {season}కి బలమైన సిఫారసు లేదు.",
        "recommend_header": "**{region}**లో **{season}**కి అగ్రశ్రేణి పంటలు (బడ్జెట్ {budget}/ఎకరం, {area} ఎకరాలు):\n",
        "recommend_line": "{i}. **{name}** — లాభం {profit}, ROI {roi}%, రిస్క్ {risk}/100",
        "sug_open_dashboard": "డాష్‌బోర్డ్ తెరవండి",
        "sug_rotation_for": "{region}కి మార్పిడి ప్రణాళిక",
        "sug_pest_of2": "{crop}కి పురుగు హెచ్చరికలు",
        "sell_need_region": "ఏ ప్రాంతం? ఉదా. _\"మహారాష్ట్ర యవత్మాల్‌లో పత్తి అమ్మడానికి సరైన సమయం\"_.",
        "sell_error": "అమ్మకం సలహా లెక్కించలేకపోయాను: {err}",
        "sell_header": "### అమ్మకం సలహా — {crop} @ {region}\n",
        "sell_advice_line": "**సలహా:** {advice}\n",
        "sell_best_month": "- **అమ్మడానికి ఉత్తమ నెల:** నెల {month}",
        "sell_peak_price": "- **అంచనా గరిష్ఠ ధర:** ₹{price}/కిలో",
        "sell_current_price": "- **ప్రస్తుత ధర:** ₹{price}/కిలో",
        "sell_uplift": "- **ఈరోజుతో పోలిస్తే పెరుగుదల:** {pct}%",
        "sell_trend": "- **ఇటీవలి ధోరణి:** {trend}",
        "pest_header": "### పురుగు & వ్యాధి రిస్క్ — {crop}\n",
        "pest_none": "_ఈ పరిస్థితులకు క్రియాశీల పురుగు రిస్క్ సంకేతాలు లేవు._",
        "pest_severity": "_(తీవ్రత: {sev})_",
        "pest_action": "- _చర్య:_ {mgmt}",
        "sug_irrigation_of2": "{crop}కి నీటిపారుదల షెడ్యూల్",
        "sug_fertilizer_of": "{crop}కి ఎరువు",
        "irrigation_header": "### నీటిపారుదల షెడ్యూల్ — {crop}",
        "irrigation_sub": "_జూన్ 15న విత్తనం · {rain} మిమీ కాలానుగుణ వర్షపాతం_\n",
        "need_crop": "ఏ పంట? ఉదా. `/{cmd} rice`.",
        "irrigation_table_hdr": "| వారం | దశ | నీటి అవసరం (మిమీ) | వర్షం (మిమీ) | నీటిపారుదల (మిమీ) |",
        "irrigation_none": "_షెడ్యూల్ అందుబాటులో లేదు._",
        "irrigation_total": "\n**మొత్తం కాలానుగుణ నీటిపారుదల అవసరం:** {mm} మిమీ",
        "sug_calendar_of": "{crop}కి పంట క్యాలెండర్",
        "calendar_header": "### పంట క్యాలెండర్ — {crop}\n",
        "calendar_season": "**సీజన్: {season}**",
        "schemes_error": "పథకాలు సరిపోల్చలేకపోయాను: {err}",
        "schemes_none": "ఈ ప్రొఫైల్‌కు సరిపోలే ప్రభుత్వ పథకం కనుగొనబడలేదు.",
        "schemes_header": "### {area} ఎకరాల పొలానికి అర్హత గల పథకాలు\n",
        "schemes_benefit": "- **ప్రయోజనం:** {benefit}",
        "schemes_apply": "- [ఇక్కడ దరఖాస్తు చేయండి]({link})",
        "loan_need_input": (
            "**మొత్తం ఖర్చు** మరియు **అంచనా లాభం** చెప్పండి, ఉదా. "
            "_\"ఖర్చు 80000 లాభం 120000కి రుణం\"_."
        ),
        "loan_error": "కాలిక్యులేటర్ నడవలేదు: {err}",
        "loan_header": "### రుణ సాధ్యత\n",
        "lbl_loan_amount": "రుణం మొత్తం",
        "lbl_emi": "EMI / నెల",
        "lbl_interest_rate": "వడ్డీ రేటు (%)",
        "lbl_tenure": "కాలవ్యవధి (నెలలు)",
        "lbl_total_interest": "మొత్తం వడ్డీ",
        "lbl_total_repayment": "మొత్తం తిరిగి చెల్లింపు",
        "lbl_profit_after_loan": "రుణం తర్వాత లాభం",
        "lbl_verdict": "తీర్పు",
        "msp_vs_need_region": "MSP vs మార్కెట్‌ను ఏ ప్రాంతంలో పోల్చాలి?",
        "msp_vs_error": "పోల్చలేకపోయాను: {err}",
        "msp_vs_header": "### MSP vs మార్కెట్ — {crop} @ {region}\n",
        "lbl_msp_year": "MSP సంవత్సరం",
        "lbl_msp_per_kg": "MSP (₹/కిలో)",
        "lbl_current_mandi": "ప్రస్తుత మండీ ధర",
        "lbl_avg_mandi_6m": "సగటు మండీ ధర (6 నెలలు)",
        "lbl_gap_pct": "వ్యత్యాసం (%)",
        "lbl_recommendation": "సిఫారసు",
        "fallback": (
            "నాకు అర్థం కాలేదు. నేను ప్రత్యేకంగా **మిట్టి మంత్ర** కోసం "
            "తయారు చేయబడ్డాను, కాబట్టి పంటలు, ప్రాంతాలు, మండీ ధరలు, MSP, "
            "సిఫారసులు, నీటిపారుదల, పురుగులు లేదా ప్రభుత్వ పథకాల గురించి "
            "అడగండి.\n\nప్రతిదీ చూడటానికి **help** టైప్ చేయండి, లేదా "
            "`/recommend`, `/msp`, `/mandi`, `/pest`, `/sell`, `/schemes` "
            "వంటి స్లాష్ కమాండ్‌లను ప్రయత్నించండి."
        ),
        "sug_help2": "సహాయం",
        "sug_recommend_medak2": "తెలంగాణ మెదక్ కోసం పంట సిఫారసు చేయండి",
        "sug_msp_wheat3": "గోధుమల MSP",
        "sug_pest_rice2": "వరికి పురుగు హెచ్చరికలు",
        "generic_error": "పూర్తి కాలేదు: {err}",
    },
    "kn": {
        "greeting": (
            "ನಮಸ್ತೆ! ನಾನು **ಮಿಟ್ಟಿ ಮಂತ್ರ ಸಹಾಯಕ** — ಬೆಳೆ ಶಿಫಾರಸುಗಳು, ಮಂಡಿ ಬೆಲೆಗಳು, "
            "MSP, ನೀರಾವರಿ, ಕೀಟಗಳು ಮತ್ತು ಸರ್ಕಾರಿ ಯೋಜನೆಗಳಲ್ಲಿ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ, "
            "ನಿಜವಾದ ಭಾರತೀಯ ಕೃಷಿ ಡೇಟಾದೊಂದಿಗೆ.\n\nಹೀಗೆ ಕೇಳಿ: _\"ತೆಲಂಗಾಣ ಮೆದಕ್‌ಗೆ "
            "ಖರೀಫ್‌ನಲ್ಲಿ ₹15000 ಬಜೆಟ್, 3 ಎಕರೆಗಳಿಗೆ ಬೆಳೆ ಶಿಫಾರಸು ಮಾಡಿ\"_ ಅಥವಾ "
            "_\"ಗೋಧಿಯ MSP ಎಷ್ಟು?\"_"
        ),
        "sug_help": "ನೀವು ಏನು ಮಾಡಬಲ್ಲಿರಿ?",
        "sug_recommend_region": "ನನ್ನ ಪ್ರದೇಶಕ್ಕೆ ಬೆಳೆ ಶಿಫಾರಸು",
        "sug_msp_wheat": "ಗೋಧಿಯ MSP",
        "sug_list_regions": "ಪ್ರದೇಶಗಳ ಪಟ್ಟಿ",
        "help_intro": "**ಮಿಟ್ಟಿ ಮಂತ್ರ**ದಲ್ಲಿ ನಾನು ಏನು ಮಾಡಬಲ್ಲೆ ಎಂಬುದು ಇಲ್ಲಿದೆ:\n",
        "help_outro": (
            "\nಸರಳ ಭಾಷೆಯಲ್ಲಿ ಕೇಳಿ — ಉದಾ. _\"ಅಕ್ಕಿಗೆ ಕೀಟ ಎಚ್ಚರಿಕೆಗಳು\"_ ಅಥವಾ "
            "_\"ಮಹಾರಾಷ್ಟ್ರ ಯವತ್ಮಾಲ್‌ನಲ್ಲಿ ಹತ್ತಿ ಮಾರಾಟಕ್ಕೆ ಸೂಕ್ತ ಸಮಯ\"_."
        ),
        "sug_recommend": "ಬೆಳೆ ಶಿಫಾರಸು",
        "sug_mandi_tomato": "ಟೊಮ್ಯಾಟೊ ಮಂಡಿ ಬೆಲೆ",
        "sug_pest_rice": "ಅಕ್ಕಿಗೆ ಕೀಟ ಎಚ್ಚರಿಕೆಗಳು",
        "sug_schemes": "ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು",
        "no_crop_data": "ಸರ್ವರ್‌ನಲ್ಲಿ ಬೆಳೆ ಡೇಟಾ ಲೋಡ್ ಆಗಿಲ್ಲ.",
        "crops_intro": "ನನ್ನ ಬಳಿ **{n} ಬೆಳೆಗಳ** ಡೇಟಾ ಇದೆ:\n\n",
        "sug_about_rice": "ಅಕ್ಕಿಯ ಬಗ್ಗೆ ಹೇಳಿ",
        "no_region_data": "ಸರ್ವರ್‌ನಲ್ಲಿ ಪ್ರದೇಶ ಡೇಟಾ ಲೋಡ್ ಆಗಿಲ್ಲ.",
        "regions_intro": "ನನ್ನ ಬಳಿ **{n} ಪ್ರದೇಶಗಳಿಗೆ** ಮಣ್ಣು + ಹವಾಮಾನ ಡೇಟಾ ಇದೆ:\n\n",
        "sug_recommend_medak": "ತೆಲಂಗಾಣ ಮೆದಕ್‌ಗೆ ಶಿಫಾರಸು ಮಾಡಿ",
        "sug_mandi_sehore": "MP ಸೆಹೋರ್‌ನಲ್ಲಿ ಮಂಡಿ ಬೆಲೆಗಳು",
        "lbl_season": "ಋತು",
        "lbl_base_yield": "ಮೂಲ ಇಳುವರಿ",
        "lbl_water_need": "ನೀರಿನ ಅಗತ್ಯ",
        "lbl_npk": "NPK (ಕೆಜಿ/ಎಕರೆ)",
        "lbl_temp_band": "ತಾಪಮಾನ ವ್ಯಾಪ್ತಿ",
        "lbl_avg_cost": "ಸರಾಸರಿ ಇನ್‌ಪುಟ್ ವೆಚ್ಚ",
        "lbl_price_range": "ಮಂಡಿ ಬೆಲೆ ವ್ಯಾಪ್ತಿ",
        "sug_msp_of": "{crop} ಯ MSP",
        "sug_pest_of": "{crop}ಗೆ ಕೀಟ ಎಚ್ಚರಿಕೆಗಳು",
        "sug_irrigation_of": "{crop}ಗೆ ನೀರಾವರಿ ವೇಳಾಪಟ್ಟಿ",
        "msp_not_found": "ಆ ಬೆಳೆಗೆ MSP ಡೇಟಾ ಕಂಡುಬಂದಿಲ್ಲ.",
        "sug_msp_wheat2": "ಗೋಧಿಯ MSP",
        "sug_msp_rice": "ಅಕ್ಕಿಯ MSP",
        "msp_for": "**{crop} MSP** (ಇತ್ತೀಚಿನ): ₹{price}/ಕ್ವಿಂಟಲ್.",
        "sug_msp_vs_of": "{crop}ಗೆ MSP vs ಮಾರುಕಟ್ಟೆ",
        "sug_sell_time_of": "{crop} ಮಾರಾಟಕ್ಕೆ ಸೂಕ್ತ ಸಮಯ",
        "msp_data_intro": "ನನ್ನ ಬಳಿ ಇರುವ MSP ಡೇಟಾ ಇಲ್ಲಿದೆ:\n\n```json\n{data}\n```",
        "mandi_not_found": (
            "ಆ ಸಂಯೋಜನೆಗೆ ಮಂಡಿ ಬೆಲೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ. ನಿರ್ದಿಷ್ಟ ಬೆಳೆ ಮತ್ತು "
            "ಪ್ರದೇಶ ತಿಳಿಸಿ."
        ),
        "sug_mandi_onion": "MP ಸೆಹೋರ್‌ನಲ್ಲಿ ಈರುಳ್ಳಿ ಮಂಡಿ ಬೆಲೆ",
        "mandi_recent": "ಇತ್ತೀಚಿನ ಮಂಡಿ ಬೆಲೆಗಳು:\n",
        "sug_forecast_of": "{crop} ಬೆಲೆ ಮುನ್ಸೂಚನೆ",
        "sug_sell_time_of2": "{crop} ಮಾರಾಟಕ್ಕೆ ಸೂಕ್ತ ಸಮಯ",
        "recommend_need_region": (
            "**ಪ್ರದೇಶ** ತಿಳಿಸಿ (ಉದಾ. _ತೆಲಂಗಾಣ ಮೆದಕ್_ ಅಥವಾ _MP ಸೆಹೋರ್_) "
            "ನಾನು ಉತ್ತಮ ಬೆಳೆಗಳನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ."
        ),
        "sug_recommend_medak_kharif": "ತೆಲಂಗಾಣ ಮೆದಕ್‌ಗೆ ಖರೀಫ್‌ನಲ್ಲಿ ಶಿಫಾರಸು ಮಾಡಿ",
        "need_crop": "ಯಾವ ಬೆಳೆ? ಉದಾ. `{example} rice`",
        "recommend_no_strong": "{region}ನಲ್ಲಿ {season}ಗೆ ಬಲವಾದ ಶಿಫಾರಸು ಇಲ್ಲ.",
        "recommend_header": "**{region}**ನಲ್ಲಿ **{season}**ಗೆ ಅಗ್ರ ಬೆಳೆಗಳು (ಬಜೆಟ್ {budget}/ಎಕರೆ, {area} ಎಕರೆ):\n",
        "recommend_line": "{i}. **{name}** — ಲಾಭ {profit}, ROI {roi}%, ಅಪಾಯ {risk}/100",
        "sug_open_dashboard": "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ತೆರೆಯಿರಿ",
        "sug_rotation_for": "{region}ಗೆ ಸರದಿ ಯೋಜನೆ",
        "sug_pest_of2": "{crop}ಗೆ ಕೀಟ ಎಚ್ಚರಿಕೆಗಳು",
        "sell_need_region": "ಯಾವ ಪ್ರದೇಶ? ಉದಾ. _\"ಮಹಾರಾಷ್ಟ್ರ ಯವತ್ಮಾಲ್‌ನಲ್ಲಿ ಹತ್ತಿ ಮಾರಾಟಕ್ಕೆ ಸೂಕ್ತ ಸಮಯ\"_.",
        "sell_error": "ಮಾರಾಟ ಸಲಹೆ ಲೆಕ್ಕಿಸಲಾಗಲಿಲ್ಲ: {err}",
        "sell_header": "### ಮಾರಾಟ ಸಲಹೆ — {crop} @ {region}\n",
        "sell_advice_line": "**ಸಲಹೆ:** {advice}\n",
        "sell_best_month": "- **ಮಾರಾಟಕ್ಕೆ ಉತ್ತಮ ತಿಂಗಳು:** ತಿಂಗಳು {month}",
        "sell_peak_price": "- **ನಿರೀಕ್ಷಿತ ಗರಿಷ್ಠ ಬೆಲೆ:** ₹{price}/ಕೆಜಿ",
        "sell_current_price": "- **ಪ್ರಸ್ತುತ ಬೆಲೆ:** ₹{price}/ಕೆಜಿ",
        "sell_uplift": "- **ಇಂದಿಗೆ ಹೋಲಿಸಿದರೆ ಏರಿಕೆ:** {pct}%",
        "sell_trend": "- **ಇತ್ತೀಚಿನ ಪ್ರವೃತ್ತಿ:** {trend}",
        "pest_header": "### ಕೀಟ ಮತ್ತು ರೋಗ ಅಪಾಯ — {crop}\n",
        "pest_none": "_ಈ ಪರಿಸ್ಥಿತಿಗಳಿಗೆ ಯಾವುದೇ ಸಕ್ರಿಯ ಕೀಟ ಅಪಾಯ ಸಂಕೇತಗಳಿಲ್ಲ._",
        "pest_severity": "_(ತೀವ್ರತೆ: {sev})_",
        "pest_action": "- _ಕ್ರಮ:_ {mgmt}",
        "sug_irrigation_of2": "{crop}ಗೆ ನೀರಾವರಿ ವೇಳಾಪಟ್ಟಿ",
        "sug_fertilizer_of": "{crop}ಗೆ ಗೊಬ್ಬರ",
        "irrigation_header": "### ನೀರಾವರಿ ವೇಳಾಪಟ್ಟಿ — {crop}",
        "irrigation_sub": "_ಜೂನ್ 15ರಂದು ಬಿತ್ತನೆ · {rain} ಮಿಮೀ ಋತುಮಾನ ಮಳೆ_\n",
        "need_crop": "ಯಾವ ಬೆಳೆ? ಉದಾ. `/{cmd} rice`.",
        "irrigation_table_hdr": "| ವಾರ | ಹಂತ | ನೀರಿನ ಅಗತ್ಯ (ಮಿಮೀ) | ಮಳೆ (ಮಿಮೀ) | ನೀರಾವರಿ (ಮಿಮೀ) |",
        "irrigation_none": "_ವೇಳಾಪಟ್ಟಿ ಲಭ್ಯವಿಲ್ಲ._",
        "irrigation_total": "\n**ಒಟ್ಟು ಋತುಮಾನ ನೀರಾವರಿ ಅಗತ್ಯ:** {mm} ಮಿಮೀ",
        "sug_calendar_of": "{crop}ಗೆ ಬೆಳೆ ಕ್ಯಾಲೆಂಡರ್",
        "calendar_header": "### ಬೆಳೆ ಕ್ಯಾಲೆಂಡರ್ — {crop}\n",
        "calendar_season": "**ಋತು: {season}**",
        "schemes_error": "ಯೋಜನೆಗಳನ್ನು ಹೊಂದಿಸಲಾಗಲಿಲ್ಲ: {err}",
        "schemes_none": "ಈ ಪ್ರೊಫೈಲ್‌ಗೆ ಹೊಂದುವ ಸರ್ಕಾರಿ ಯೋಜನೆ ಕಂಡುಬಂದಿಲ್ಲ.",
        "schemes_header": "### {area} ಎಕರೆ ಹೊಲಕ್ಕೆ ಅರ್ಹ ಯೋಜನೆಗಳು\n",
        "schemes_benefit": "- **ಪ್ರಯೋಜನ:** {benefit}",
        "schemes_apply": "- [ಇಲ್ಲಿ ಅರ್ಜಿ ಸಲ್ಲಿಸಿ]({link})",
        "loan_need_input": (
            "**ಒಟ್ಟು ವೆಚ್ಚ** ಮತ್ತು **ನಿರೀಕ್ಷಿತ ಲಾಭ** ತಿಳಿಸಿ, ಉದಾ. "
            "_\"ವೆಚ್ಚ 80000 ಲಾಭ 120000ಗೆ ಸಾಲ\"_."
        ),
        "loan_error": "ಕ್ಯಾಲ್ಕುಲೇಟರ್ ಚಲಾಯಿಸಲಾಗಲಿಲ್ಲ: {err}",
        "loan_header": "### ಸಾಲ ಸಾಧ್ಯತೆ\n",
        "lbl_loan_amount": "ಸಾಲದ ಮೊತ್ತ",
        "lbl_emi": "EMI / ತಿಂಗಳು",
        "lbl_interest_rate": "ಬಡ್ಡಿ ದರ (%)",
        "lbl_tenure": "ಅವಧಿ (ತಿಂಗಳುಗಳು)",
        "lbl_total_interest": "ಒಟ್ಟು ಬಡ್ಡಿ",
        "lbl_total_repayment": "ಒಟ್ಟು ಮರುಪಾವತಿ",
        "lbl_profit_after_loan": "ಸಾಲದ ನಂತರ ಲಾಭ",
        "lbl_verdict": "ತೀರ್ಪು",
        "msp_vs_need_region": "MSP vs ಮಾರುಕಟ್ಟೆಯನ್ನು ಯಾವ ಪ್ರದೇಶದಲ್ಲಿ ಹೋಲಿಸಲಿ?",
        "msp_vs_error": "ಹೋಲಿಸಲಾಗಲಿಲ್ಲ: {err}",
        "msp_vs_header": "### MSP vs ಮಾರುಕಟ್ಟೆ — {crop} @ {region}\n",
        "lbl_msp_year": "MSP ವರ್ಷ",
        "lbl_msp_per_kg": "MSP (₹/ಕೆಜಿ)",
        "lbl_current_mandi": "ಪ್ರಸ್ತುತ ಮಂಡಿ ಬೆಲೆ",
        "lbl_avg_mandi_6m": "ಸರಾಸರಿ ಮಂಡಿ ಬೆಲೆ (6 ತಿಂಗಳು)",
        "lbl_gap_pct": "ವ್ಯತ್ಯಾಸ (%)",
        "lbl_recommendation": "ಶಿಫಾರಸು",
        "fallback": (
            "ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ನಾನು ನಿರ್ದಿಷ್ಟವಾಗಿ **ಮಿಟ್ಟಿ ಮಂತ್ರ**ಗಾಗಿ "
            "ರೂಪಿಸಲ್ಪಟ್ಟಿದ್ದೇನೆ, ಆದ್ದರಿಂದ ಬೆಳೆಗಳು, ಪ್ರದೇಶಗಳು, ಮಂಡಿ ಬೆಲೆಗಳು, "
            "MSP, ಶಿಫಾರಸುಗಳು, ನೀರಾವರಿ, ಕೀಟಗಳು ಅಥವಾ ಸರ್ಕಾರಿ ಯೋಜನೆಗಳ ಬಗ್ಗೆ "
            "ಕೇಳಿ.\n\nಎಲ್ಲವನ್ನೂ ನೋಡಲು **help** ಎಂದು ಟೈಪ್ ಮಾಡಿ, ಅಥವಾ "
            "`/recommend`, `/msp`, `/mandi`, `/pest`, `/sell`, `/schemes` "
            "ನಂತಹ ಸ್ಲಾಶ್ ಕಮಾಂಡ್‌ಗಳನ್ನು ಪ್ರಯತ್ನಿಸಿ."
        ),
        "sug_help2": "ಸಹಾಯ",
        "sug_recommend_medak2": "ತೆಲಂಗಾಣ ಮೆದಕ್‌ಗೆ ಬೆಳೆ ಶಿಫಾರಸು ಮಾಡಿ",
        "sug_msp_wheat3": "ಗೋಧಿಯ MSP",
        "sug_pest_rice2": "ಅಕ್ಕಿಗೆ ಕೀಟ ಎಚ್ಚರಿಕೆಗಳು",
        "generic_error": "ಪೂರ್ಣಗೊಳ್ಳಲಿಲ್ಲ: {err}",
    },
}


def T(lang: str, key: str, **kwargs) -> str:
    """Localized string lookup with English fallback. Missing keys return the
    key itself (visibly wrong, never a crash) so a gap is easy to spot."""
    table = REPLY.get(lang, {})
    template = table.get(key)
    if template is None:
        return key
    if kwargs:
        try:
            return template.format(**kwargs)
        except (KeyError, IndexError):
            return template
    return template
