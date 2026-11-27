"""
Mitti Mantra site-aware chatbot.

A lightweight, intent-based conversational layer "fine-tuned" to this platform:
it understands the site's domain (crops, regions, mandi prices, MSP, schemes,
recommendations, simulation, rotation, irrigation, pests, loans) and answers
using the EXACT same engine + datasets the rest of the app uses — no
hallucinations, no external LLM required.

Multilingual support (Hindi, Telugu, Kannada, plus Hinglish/romanized Hindi)
lives in engine/chatbot_i18n.py: script + keyword-based language detection,
native-script crop/season/state synonym tables, extra intent-trigger regex
alternations, and the localized reply strings pulled in via T(lang, key).
Numbers and crop names returned by the engine stay as-is — see that module's
docstring for the scoping rationale.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from engine.features import (
    best_time_to_sell,
    fertilizer_recommendation,
    get_crop_calendar,
    get_msp_data,
    irrigation_schedule,
    loan_calculator,
    match_government_schemes,
    msp_vs_market,
    pest_disease_alerts,
    price_forecast,
)
from engine.chatbot_i18n import (
    GREETING_WORDS,
    INTENT_PATTERNS,
    T,
    detect_lang,
    find_crop_id,
    find_region_by_state_prefix,
    find_season as find_season_native,
    normalize_region_text,
)
from ml.predict import recommend_crops, rotation_planner, typical_budget_per_acre
from utils.calculations import region_display_name
from utils.csv_cache import load as _csv_load

# ---------------------------------------------------------------------------
# Data accessors — all backed by the shared mtime-aware CSV cache so the
# chatbot always reflects the latest dataset without a server restart.
# ---------------------------------------------------------------------------
def _crops() -> List[Dict[str, str]]:   return _csv_load("crop_parameters.csv")
def _soil() -> List[Dict[str, str]]:    return _csv_load("soil.csv")
def _mandi() -> List[Dict[str, str]]:   return _csv_load("mandi_prices.csv")
def _weather() -> List[Dict[str, str]]: return _csv_load("weather.csv")


def _crop_by_id() -> Dict[str, Dict[str, str]]:
    return {c["crop_id"].lower(): c for c in _crops()}


def _crop_by_name() -> Dict[str, Dict[str, str]]:
    return {c["crop_name"].lower(): c for c in _crops()}


def _crop_label(crop_id: str) -> str:
    """Human crop name for a crop_id, falling back to the id itself.

    Replies used to interleave display names ("Groundnut") with raw ids
    ("soybean", "mp_sehore") depending on which handler produced them."""
    row = _crop_by_id().get((crop_id or "").lower())
    return row["crop_name"] if row else (crop_id or "?")


def _regions() -> List[str]:
    return sorted({r["region_id"] for r in _soil()})


_VALID_SEASONS = {"kharif", "rabi", "zaid"}

# Representative sowing date per season, used when a farmer doesn't name a
# sowing date explicitly. Keeping this keyed by season (rather than a single
# hardcoded kharif date) matters because _region_weather() below also filters
# by season -- using a kharif date with rabi-filtered weather (or vice versa)
# would pair the wrong seasonal rainfall with the wrong crop-calendar labels.
_SEASON_SOWING_DATE = {"kharif": "2025-06-15", "rabi": "2025-11-01", "zaid": "2025-03-15"}


def _region_weather(region_id: Optional[str], season: Optional[str] = None) -> Dict[str, float]:
    """Look up a region's actual average temperature/rainfall from
    weather.csv (M-17 fix) so pest/irrigation replies reflect where the
    farmer actually is instead of always using the same fixed generic
    numbers. Falls back to those generic defaults when the region is
    unknown or has no weather rows on file."""
    defaults = {"avg_temp_c": 28.0, "rainfall_mm": 800.0}
    if not region_id:
        return defaults
    rows = [r for r in _weather() if r.get("region_id") == region_id]
    if season:
        season_rows = [r for r in rows if r.get("season") == season]
        if season_rows:
            rows = season_rows
    if not rows:
        return defaults
    try:
        temps = [float(r["avg_temp_c"]) for r in rows if r.get("avg_temp_c")]
        rains = [float(r["rainfall_mm"]) for r in rows if r.get("rainfall_mm")]
    except ValueError:
        return defaults
    return {
        "avg_temp_c": round(sum(temps) / len(temps), 1) if temps else defaults["avg_temp_c"],
        "rainfall_mm": round(sum(rains) / len(rains), 1) if rains else defaults["rainfall_mm"],
    }



# ---------------------------------------------------------------------------
# Site knowledge base (what the bot knows about the product itself)
# ---------------------------------------------------------------------------
FEATURES_OVERVIEW = [
    ("Smart crop recommendations", "AI ranks the best crops for your region, season, budget and land area."),
    ("Yield & profit simulator", "Physics + ML based yield forecasting with a full cost/profit breakdown."),
    ("Crop rotation planner", "Optimal Kharif → Rabi rotation plans for soil health and profit."),
    ("Mandi price analytics", "Trend, volatility, seasonality and 6-month price forecast for every crop."),
    ("MSP comparison", "Check MSP vs current mandi price so you never sell below support price."),
    ("Cross-mandi arbitrage", "See price gaps between mandis to transport produce where it pays more."),
    ("Irrigation schedule", "Week-by-week irrigation plan tuned to rainfall and crop stage."),
    ("Pest & disease alerts", "Weather-driven early warnings for your crop."),
    ("Fertilizer recommendation", "Exact N-P-K dosage based on your soil test and the crop."),
    ("Loan & EMI calculator", "Check loan feasibility against expected profit."),
    ("Government schemes", "Match eligible central/state schemes by crop, region and land size."),
    ("Expense tracker", "Log and compare actual vs planned spend per farm."),
    ("3D farm visualisation", "Interactive 3D scene of your farm and India-wide crop map."),
    ("Draw-your-farm tool", "Sketch your plot boundary to auto-estimate area and geolocation."),
]

GREETINGS = ("hi", "hii", "hello", "hey", "namaste", "namaskar", "salaam", "vanakkam", "hola")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# M-16 fix: common English synonyms that are part of a crop's own display
# name/id but wouldn't match the whole-name/whole-id checks below on their
# own — e.g. crop_name is "Rice (Paddy)" so a bare "paddy" doesn't match the
# full string "rice (paddy)", and "basmati" is only half of the crop_id
# "paddy_basmati".
_ENGLISH_CROP_ALIASES: Dict[str, str] = {
    "paddy": "rice",
    "basmati": "paddy_basmati",
    "sarson": "mustard",
}


def _find_crop(text: str) -> Optional[Dict[str, str]]:
    t = text.lower()
    cbi = _crop_by_id()
    # Prefer longer names first (e.g. "black gram" before "gram")
    for name, row in sorted(_crop_by_name().items(), key=lambda kv: -len(kv[0])):
        if name in t:
            return row
    for alias, cid in sorted(_ENGLISH_CROP_ALIASES.items(), key=lambda kv: -len(kv[0])):
        if cid in cbi and re.search(rf"\b{re.escape(alias)}\b", t):
            return cbi[cid]
    for cid, row in sorted(cbi.items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"\b{re.escape(cid)}\b", t):
            return row
        # Multi-word crop_ids ("paddy_basmati") — let either half resolve,
        # since users type spaces, not underscores.
        if "_" in cid:
            for part in cid.split("_"):
                if len(part) > 3 and re.search(rf"\b{re.escape(part)}\b", t):
                    return row
    # Native-script / Hinglish crop name (चावल, వరి, ಅಕ್ಕಿ, "chawal", ...)
    native_cid = find_crop_id(text)
    if native_cid:
        if native_cid in cbi:
            return cbi[native_cid]
    return None


# H-5 fix: generic/directional English words that show up as district
# suffixes in some region_ids ("goa_north", "tripura_west") but are common
# standalone English vocabulary — matching them bare silently resolves to an
# unrelated specific region. Never let these alone trigger the district
# fallback match.
_REGION_STOPWORDS = {
    "north", "south", "east", "west", "central",
    "district", "region", "area", "zone", "state", "rural", "urban",
}


def _find_region(text: str) -> Optional[str]:
    # Swap native-script state names (पंजाब, తెలంగాణ, ಕರ್ನಾಟಕ...) for their
    # English token first, so the existing region_id matching below "just
    # works" regardless of which script the user typed in.
    normalized = normalize_region_text(text)
    regions = _regions()
    t = normalized.lower().replace(" ", "_")

    for rid in sorted(regions, key=len, reverse=True):
        if rid.lower() in t:
            return rid

    # District-suffix fallback: "medak" -> telangana_medak. Restricted to
    # districts that (a) aren't generic/directional stopwords and (b) are
    # unique across all regions — a district name shared by multiple regions
    # can't be resolved confidently, so it falls through to the state-prefix
    # matcher / a clarifying question instead of guessing.
    district_counts: Dict[str, int] = {}
    for rid in regions:
        d = rid.split("_", 1)[-1].lower()
        district_counts[d] = district_counts.get(d, 0) + 1
    for rid in sorted(regions, key=len, reverse=True):
        district = rid.split("_", 1)[-1].lower()
        if not district or district in _REGION_STOPWORDS:
            continue
        if district_counts.get(district, 0) != 1:
            continue
        if re.search(rf"\b{re.escape(district)}\b", normalized.lower()):
            return rid

    # State name alone, for states with exactly one region — the district
    # itself usually isn't translated (see STATE_SYNONYMS), so a Telugu/
    # Kannada/Hindi query naming just the state still resolves for Telangana,
    # Bihar, etc. Ambiguous for multi-region states, so this deliberately
    # returns nothing there rather than guessing a district.
    return find_region_by_state_prefix(normalized, regions)


def _find_season(text: str) -> Optional[str]:
    t = text.lower()
    if "kharif" in t or "monsoon" in t:
        return "kharif"
    if "rabi" in t or "winter" in t:
        return "rabi"
    if "zaid" in t or "summer" in t:
        return "zaid"
    return find_season_native(text)


_NUM_RE = re.compile(r"(\d[\d,]*\.?\d*)")

# H-7 fix: role keywords used to bind a nearby number to what it actually
# means, instead of trusting sentence position. Checked in this order
# (area, profit, then budget/cost) so a number tagged by an earlier rule
# isn't re-claimed by a later, broader one (e.g. "cost" inside "budget").
_AREA_KW = re.compile(r"\bacres?\b|\bhectares?\b", re.I)
_PROFIT_KW = re.compile(r"\bprofit\b", re.I)
_BUDGET_KW = re.compile(r"\bbudget\b|\bcost\b|₹|\brs\.?\b|\brupees?\b", re.I)
_WINDOW = 18  # chars of context scanned on either side of a number


def _find_numbers(text: str) -> List[float]:
    nums = []
    for m in _NUM_RE.finditer(text):
        try:
            nums.append(float(m.group(1).replace(",", "")))
        except ValueError:
            pass
    return nums


def _find_tagged_numbers(text: str) -> Dict[str, float]:
    """Bind numbers to a semantic role (area / expected_profit / budget)
    using the nearest keyword to each number, so reordering a sentence
    ("3 acres and 15000 budget" vs "15000 budget for 3 acres") can't silently
    swap which number means what. Numbers with no nearby keyword are left
    untagged for the caller to fill in positionally.

    Two distinct bugs have been fixed here, both of which swapped roles:

    1. A fixed symmetric window plus a fixed "area beats budget" priority made
       *both* numbers resolve to the wrong role whenever their windows
       overlapped ("15000 budget and 3 acres" tagged 15000 -> area).
       Fixed by ranking on the distance to the closest keyword.

    2. Ranking on distance alone still left ties, and a tie was decided by the
       iteration order of the keyword dict. In "cost 80000 profit 150000" the
       number 80000 sits exactly one character from *both* "cost" (before it)
       and "profit" (after it); expected_profit happened to be visited first,
       so 80000 was tagged as the profit and 150000 was left untagged and then
       filled in positionally as the cost -- inverting a loan calculation.
       Fixed by preferring the keyword that *precedes* the number on a tie
       (English labels a value before stating it far more often than after),
       and by letting a number fall through to its next-best role when a
       closer number has already claimed its first choice.
    """
    numbers: List[Tuple[float, int, int]] = []
    for m in _NUM_RE.finditer(text):
        try:
            val = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        numbers.append((val, m.start(), m.end()))
    if not numbers:
        return {}

    kw_positions: Dict[str, List[Tuple[int, int]]] = {
        "area": [m.span() for m in _AREA_KW.finditer(text)],
        "expected_profit": [m.span() for m in _PROFIT_KW.finditer(text)],
        "budget": [m.span() for m in _BUDGET_KW.finditer(text)],
    }

    # For each number, every role within the window, best-first.
    ranked: List[Tuple[float, int, List[Tuple[int, int, str]]]] = []
    for val, start, end in numbers:
        options: List[Tuple[int, int, str]] = []   # (distance, 0 if keyword precedes, role)
        for role, spans in kw_positions.items():
            best_for_role: Optional[Tuple[int, int]] = None
            for kstart, kend in spans:
                if kend <= start:
                    dist, precedes = start - kend, 0
                elif kstart >= end:
                    dist, precedes = kstart - end, 1
                else:
                    dist, precedes = 0, 0
                # "acres" is a unit: it follows its number ("3 acres 20000 budget"),
                # so for area the keyword *after* the number wins a tie. Labels such
                # as "budget" and "profit" keep preferring the keyword before.
                if role == "area" and dist:
                    precedes = 1 - precedes
                if dist <= _WINDOW and (best_for_role is None or (dist, precedes) < best_for_role):
                    best_for_role = (dist, precedes)
            if best_for_role is not None:
                options.append((best_for_role[0], best_for_role[1], role))
        if options:
            options.sort()
            ranked.append((val, start, options))

    # Settle the closest bindings first; a number whose first choice is already
    # taken by a nearer number falls through to its next-best role.
    ranked.sort(key=lambda r: (r[2][0][0], r[2][0][1], r[1]))
    tags: Dict[str, float] = {}
    for val, _start, options in ranked:
        for _dist, _precedes, role in options:
            if role not in tags:
                tags[role] = val
                break
    return tags


def _extract_amounts(text: str) -> Tuple[Dict[str, float], List[float]]:
    """Returns (role-tagged numbers, remaining untagged numbers in order)
    for callers that need positional fallback for whichever roles weren't
    tagged by a keyword."""
    tagged = _find_tagged_numbers(text)
    tagged_values = set(tagged.values())
    leftover: List[float] = []
    consumed = {v: False for v in tagged_values}
    for n in _find_numbers(text):
        if n in consumed and not consumed[n]:
            consumed[n] = True
            continue
        leftover.append(n)
    return tagged, leftover


def _sane_budget(v: float) -> bool:
    return 100 <= v <= 100_000_000


def _sane_area(v: float) -> bool:
    return 0 < v <= 10_000


def _fmt_inr(v: float) -> str:
    """Rupees with Indian digit grouping (₹1,53,496), as the rest of the site shows them."""
    n = int(round(float(v)))
    sign, digits = ("-" if n < 0 else ""), str(abs(n))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups) + "," + tail
    return f"{sign}₹{digits}"


_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]


def _month_name(m: Any) -> str:
    try:
        return _MONTHS[int(m) - 1]
    except (TypeError, ValueError, IndexError):
        return str(m)


# ---------------------------------------------------------------------------
# Intent handlers  -> return (reply_markdown, suggestions)
# ---------------------------------------------------------------------------
Reply = Tuple[str, List[str]]


def _action(label: str, href: str) -> Dict[str, str]:
    return {"label": label, "href": href}


def _dashboard_link(tool: str, **params: Any) -> str:
    from urllib.parse import urlencode
    qs = urlencode({k: v for k, v in params.items() if v is not None})
    return f"/dashboard.html?tool={tool}&{qs}" if qs else f"/dashboard.html?tool={tool}"


def _intent_greeting(lang: str) -> Reply:
    if lang == "en":
        msg = (
            "Namaste! I'm **Mitti Mantra's assistant** — I can help you with crop "
            "recommendations, mandi prices, MSP, irrigation, pests, government "
            "schemes and more, using real Indian farm data.\n\n"
            "Try asking: _\"Recommend crops for Telangana Medak in Kharif with "
            "₹15000 budget on 3 acres\"_ or _\"What's the MSP of wheat?\"_"
        )
        return msg, [
            "What can you do?",
            "Recommend crops for my region",
            "MSP of wheat",
            "List regions",
        ]
    return T(lang, "greeting"), [
        T(lang, "sug_help"), T(lang, "sug_recommend_region"),
        T(lang, "sug_msp_wheat"), T(lang, "sug_list_regions"),
    ]


def _intent_help(lang: str) -> Reply:
    if lang == "en":
        lines = ["Here's what I can do on **Mitti Mantra**:\n"]
        for title, desc in FEATURES_OVERVIEW:
            lines.append(f"- **{title}** — {desc}")
        lines.append(
            "\nAsk me in plain English — e.g. _\"pest alerts for rice\"_ or "
            "_\"best time to sell cotton in Maharashtra Yavatmal\"_."
        )
        return "\n".join(lines), [
            "Recommend crops", "Mandi price of tomato",
            "Pest alerts for rice", "Government schemes",
        ]
    lines = [T(lang, "help_intro")]
    for title, desc in FEATURES_OVERVIEW:
        lines.append(f"- **{title}** — {desc}")
    lines.append(T(lang, "help_outro"))
    return "\n".join(lines), [
        T(lang, "sug_recommend"), T(lang, "sug_mandi_tomato"),
        T(lang, "sug_pest_rice"), T(lang, "sug_schemes"),
    ]


def _intent_list_crops(lang: str) -> Reply:
    crops = _crops()
    if not crops:
        return (T(lang, "no_crop_data") if lang != "en" else "No crop data is loaded on the server."), []
    names = [c["crop_name"] for c in crops]
    if lang == "en":
        msg = f"I have data on **{len(names)} crops**:\n\n" + ", ".join(names)
        return msg, ["Tell me about rice", "MSP of wheat", "Recommend crops"]
    msg = T(lang, "crops_intro", n=len(names)) + ", ".join(names)
    return msg, [T(lang, "sug_about_rice"), T(lang, "sug_msp_wheat"), T(lang, "sug_recommend")]


def _intent_list_regions(lang: str) -> Reply:
    regs = _regions()
    if not regs:
        return (T(lang, "no_region_data") if lang != "en" else "No region data is loaded on the server."), []
    pretty = ", ".join(region_display_name(r) for r in regs)
    if lang == "en":
        return (
            f"I have soil + weather data for **{len(regs)} regions**:\n\n{pretty}",
            ["Recommend for Telangana Medak", "Mandi prices in MP Sehore"],
        )
    return (
        T(lang, "regions_intro", n=len(regs)) + pretty,
        [T(lang, "sug_recommend_medak"), T(lang, "sug_mandi_sehore")],
    )


def _intent_about_crop(crop: Dict[str, str], lang: str) -> Reply:
    c = crop
    if lang == "en":
        msg = (
            f"### {c['crop_name']} ({c['crop_id']})\n"
            f"- **Season:** {c['season']}\n"
            f"- **Base yield:** {c['base_yield_kg_per_acre']} kg / acre\n"
            f"- **Water need:** {c['water_requirement_mm']} mm\n"
            f"- **NPK (kg/acre):** {c['npk_n_kg_per_acre']} - {c['npk_p_kg_per_acre']} - {c['npk_k_kg_per_acre']}\n"
            f"- **Temperature band:** {c['temp_min_c']}–{c['temp_max_c']} °C\n"
            f"- **Avg input cost:** {_fmt_inr(float(c['avg_input_cost_inr_per_acre']))}/acre\n"
            f"- **Mandi price range:** ₹{c['mandi_price_min_inr_per_kg']}–{c['mandi_price_max_inr_per_kg']}/kg"
        )
    else:
        msg = (
            f"### {c['crop_name']} ({c['crop_id']})\n"
            f"- **{T(lang, 'lbl_season')}:** {c['season']}\n"
            f"- **{T(lang, 'lbl_base_yield')}:** {c['base_yield_kg_per_acre']} kg/acre\n"
            f"- **{T(lang, 'lbl_water_need')}:** {c['water_requirement_mm']} mm\n"
            f"- **{T(lang, 'lbl_npk')}:** {c['npk_n_kg_per_acre']} - {c['npk_p_kg_per_acre']} - {c['npk_k_kg_per_acre']}\n"
            f"- **{T(lang, 'lbl_temp_band')}:** {c['temp_min_c']}–{c['temp_max_c']} °C\n"
            f"- **{T(lang, 'lbl_avg_cost')}:** {_fmt_inr(float(c['avg_input_cost_inr_per_acre']))}/acre\n"
            f"- **{T(lang, 'lbl_price_range')}:** ₹{c['mandi_price_min_inr_per_kg']}–{c['mandi_price_max_inr_per_kg']}/kg"
        )
    cid = c["crop_id"]
    if lang == "en":
        return msg, [f"MSP of {c['crop_name']}", f"Pest alerts for {cid}", f"Irrigation schedule for {cid}"]
    return msg, [
        T(lang, "sug_msp_of", crop=c["crop_name"]),
        T(lang, "sug_pest_of", crop=cid),
        T(lang, "sug_irrigation_of", crop=cid),
    ]


def _intent_msp(crop: Optional[Dict[str, str]], lang: str) -> Reply:
    data = get_msp_data(crop["crop_id"] if crop else None)
    if not data:
        msg = "I couldn't find MSP data for that crop." if lang == "en" else T(lang, "msp_not_found")
        sug = ["MSP of wheat", "MSP of rice"] if lang == "en" else [T(lang, "sug_msp_wheat2"), T(lang, "sug_msp_rice")]
        return msg, sug
    if crop:
        latest = data[-1] if isinstance(data, list) else data
        if isinstance(latest, dict):
            price = latest.get("msp_inr_per_quintal") or latest.get("msp_per_quintal") or latest
            if lang == "en":
                return (
                    f"**MSP for {crop['crop_name']}** (latest): ₹{price}/quintal.",
                    [f"MSP vs market for {crop['crop_id']}", f"Best time to sell {crop['crop_id']}"],
                )
            return (
                T(lang, "msp_for", crop=crop["crop_name"], price=price),
                [T(lang, "sug_msp_vs_of", crop=crop["crop_id"]), T(lang, "sug_sell_time_of", crop=crop["crop_id"])],
            )
    sample = data[:6] if isinstance(data, list) else [data]
    if lang == "en":
        return f"Here's the MSP data I have:\n\n```json\n{sample}\n```", []
    return T(lang, "msp_data_intro", data=sample), []


def _intent_mandi_price(crop: Optional[Dict[str, str]], region: Optional[str], lang: str) -> Reply:
    rows = _mandi()
    if crop:
        rows = [r for r in rows if r["crop_id"] == crop["crop_id"]]
    if region:
        rows = [r for r in rows if r["region_id"] == region]
    if not rows:
        if lang == "en":
            return (
                "I couldn't find mandi prices for that combination. Try naming a "
                "specific crop and region.",
                ["Mandi price of onion in MP Sehore", "List regions"],
            )
        return T(lang, "mandi_not_found"), [T(lang, "sug_mandi_onion"), T(lang, "sug_list_regions")]
    rows = rows[-6:]
    lines = ["Recent mandi prices:\n"] if lang == "en" else [T(lang, "mandi_recent")]
    for r in rows:
        lines.append(
            f"- **{_crop_label(r.get('crop_id',''))}** @ "
            f"{region_display_name(r.get('region_id','')) or '?'} "
            f"({r.get('date') or r.get('month','')}): ₹{r.get('price_inr_per_kg','?')}/kg"
        )
    tips = []
    if crop:
        if lang == "en":
            tips.append(f"Price forecast for {crop['crop_id']}")
            tips.append(f"Best time to sell {crop['crop_id']}")
        else:
            tips.append(T(lang, "sug_forecast_of", crop=crop["crop_id"]))
            tips.append(T(lang, "sug_sell_time_of2", crop=crop["crop_id"]))
    return "\n".join(lines), tips


def _intent_recommend(region: Optional[str], season: Optional[str], text: str, lang: str) -> Reply:
    if not region:
        if lang == "en":
            return (
                "Tell me the **region** (e.g. _Telangana Medak_ or _MP Sehore_) "
                "and I'll recommend the best crops.",
                ["List regions", "Recommend for Telangana Medak in Kharif"],
            )
        return T(lang, "recommend_need_region"), [T(lang, "sug_list_regions"), T(lang, "sug_recommend_medak_kharif")]
    # Matches _intent_irrigation's own validity check (C-25 fix) -- an
    # invalid, non-empty season string must default the same way here as
    # it does there, or the two intents disagree on what season a farmer
    # asked for.
    season = season if season in _VALID_SEASONS else "kharif"
    # H-7 fix: bind budget/area to nearby keywords instead of trusting
    # sentence position; fall back to positional order only for whichever
    # one wasn't tagged.
    tagged, leftover = _extract_amounts(text)
    budget = tagged.get("budget")
    area = tagged.get("area")
    if budget is None:
        # Unstated budget: what crops typically cost here this season, as the
        # dashboard and season planner default to (N-7). The old flat Rs 15,000 sat
        # below rice and cotton, so the chat ranked them underfunded.
        budget = leftover.pop(0) if leftover else _default_budget(region, season)
    if area is None:
        area = leftover.pop(0) if leftover else 3.0
    if not _sane_budget(budget) or not _sane_area(area):
        msg = (
            f"That budget/area doesn't look right ({_fmt_inr(budget)} budget, {area} acres). "
            "Try e.g. _\"recommend for 3 acres, ₹15000 budget\"_."
        ) if lang == "en" else T(lang, "generic_error", err=f"{budget}/{area}")
        return msg, []
    try:
        recs = recommend_crops(region_id=region, season=season, budget_per_acre=budget, area_acres=area)
    except Exception as e:
        return (f"Sorry, I couldn't compute recommendations: {e}" if lang == "en"
                else T(lang, "generic_error", err=e)), []
    if not recs:
        if lang == "en":
            return f"No strong recommendations for {region_display_name(region)} in {season}.", []
        return T(lang, "recommend_no_strong", region=region, season=season), []
    region_disp = region_display_name(region)
    if lang == "en":
        lines = [
            f"Top crops for **{region_disp}** in **{season.title()}** "
            f"(budget {_fmt_inr(budget)}/acre, {area} acres):\n"
        ]
        for i, r in enumerate(recs[:5], 1):
            share = r.get("adoption_share")
            grown = (f" · grown on {round(share * 100)}% of this district's area"
                     if isinstance(share, (int, float)) and share >= 0.25 else "")
            lines.append(
                f"{i}. **{r.get('crop_name')}** — "
                f"profit {_fmt_inr(r.get('expected_profit',0))}, "
                f"ROI {round(r.get('roi_percent',0))}%, risk {round(r.get('risk_score',0))}/100{grown}"
            )
        lines.append("\n_Ranked on profit, risk and what already grows well in this district, "
                     "so a widely grown crop can sit above a richer one on paper._")
        return "\n".join(lines), [
            "Open dashboard",
            f"Rotation plan for {region_disp}",
            f"Pest alerts for {recs[0].get('crop_id')}",
        ]
    lines = [T(lang, "recommend_header", region=region_disp, season=season.title(),
                budget=_fmt_inr(budget), area=area)]
    for i, r in enumerate(recs[:5], 1):
        lines.append(T(
            lang, "recommend_line", i=i, name=r.get("crop_name"),
            profit=_fmt_inr(r.get("expected_profit", 0)),
            roi=round(r.get("roi_percent", 0)), risk=round(r.get("risk_score", 0)),
        ))
    return "\n".join(lines), [
        T(lang, "sug_open_dashboard"),
        T(lang, "sug_rotation_for", region=region),
        T(lang, "sug_pest_of2", crop=recs[0].get("crop_id")),
    ]


def _kv_list(d: Dict[str, Any], keys: Optional[List[str]] = None) -> str:
    items = keys if keys else list(d.keys())
    lines = []
    for k in items:
        if k not in d:
            continue
        v = d[k]
        if isinstance(v, float):
            v = f"{v:,.2f}".rstrip("0").rstrip(".")
        lines.append(f"- **{k.replace('_', ' ').title()}:** {v}")
    return "\n".join(lines)


def _cannot_wait_for_peak(res: Dict[str, Any]) -> bool:
    """True when the seasonal peak is further away than the crop keeps."""
    keeps = res.get("max_storage_weeks")
    months = res.get("months_to_peak")
    return keeps is not None and months is not None and months > 0 and months * 4.35 > keeps


def _intent_sell_advice(crop: Dict[str, str], region: Optional[str], lang: str) -> Reply:
    if not region:
        if lang == "en":
            return "Which region? e.g. _\"best time to sell cotton in Maharashtra Yavatmal\"_.", []
        return T(lang, "sell_need_region"), []
    try:
        res = best_time_to_sell(region, crop["crop_id"])
    except Exception as e:
        return (f"Couldn't compute sell advice: {e}" if lang == "en" else T(lang, "sell_error", err=e)), []
    rtxt = region_display_name(region)
    # A peak months away means nothing for a crop that keeps a week or two: show the
    # advice and today's price, not a "best month" the farmer cannot wait for.
    if isinstance(res, dict) and _cannot_wait_for_peak(res):
        res = {k: v for k, v in res.items()
               if k not in ("best_month", "best_month_avg_price", "potential_gain_pct")}
    if lang == "en":
        lines = [f"### Sell advice — {crop['crop_name']} @ {rtxt}\n"]
        if isinstance(res, dict):
            if "advice" in res:
                lines.append(f"**Advice:** {res['advice']}\n")
            if res.get("max_storage_weeks") is not None and "best_month" not in res:
                lines.append(f"- **Keeps without cold storage:** about {res['max_storage_weeks']} week(s)")
            if "best_month" in res:
                lines.append(f"- **Best month to sell:** {_month_name(res['best_month'])}")
            if "best_month_avg_price" in res:
                lines.append(f"- **Expected peak price:** ₹{res['best_month_avg_price']:.2f}/kg")
            if "current_price" in res:
                lines.append(f"- **Current price:** ₹{res['current_price']:.2f}/kg")
            if "potential_gain_pct" in res:
                lines.append(f"- **Uplift vs today:** {res['potential_gain_pct']:+.1f}%")
            if "recent_trend" in res:
                lines.append(f"- **Recent trend:** {res['recent_trend']}")
        else:
            lines.append(str(res))
        return "\n".join(lines), [
            f"Price forecast for {crop['crop_id']}",
            f"MSP vs market for {crop['crop_id']}",
        ]
    lines = [T(lang, "sell_header", crop=crop["crop_name"], region=rtxt)]
    if isinstance(res, dict):
        if "advice" in res:
            lines.append(T(lang, "sell_advice_line", advice=res["advice"]))
        if "best_month" in res:
            lines.append(T(lang, "sell_best_month", month=res["best_month"]))
        if "best_month_avg_price" in res:
            lines.append(T(lang, "sell_peak_price", price=f"{res['best_month_avg_price']:.2f}"))
        if "current_price" in res:
            lines.append(T(lang, "sell_current_price", price=f"{res['current_price']:.2f}"))
        if "potential_gain_pct" in res:
            lines.append(T(lang, "sell_uplift", pct=f"{res['potential_gain_pct']:+.1f}"))
        if "recent_trend" in res:
            lines.append(T(lang, "sell_trend", trend=res["recent_trend"]))
    else:
        lines.append(str(res))
    return "\n".join(lines), [
        T(lang, "sug_forecast_of", crop=crop["crop_id"]),
        T(lang, "sug_msp_vs_of", crop=crop["crop_id"]),
    ]


def _intent_pest(crop: Dict[str, str], lang: str, region: Optional[str] = None,
                  season: Optional[str] = None) -> Reply:
    weather = _region_weather(region, season)
    try:
        alerts = pest_disease_alerts(crop["crop_id"], weather)
    except Exception as e:
        return (f"Couldn't fetch pest alerts: {e}" if lang == "en" else T(lang, "generic_error", err=e)), []
    items = alerts if isinstance(alerts, list) else alerts.get("alerts", []) if isinstance(alerts, dict) else []
    sev_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}
    if lang == "en":
        lines = [f"### Pest & disease risk — {crop['crop_name']}\n"]
        if not items:
            lines.append("_No active pest risk signals for these conditions._")
        for a in items[:5]:
            name = a.get("pest_disease") or a.get("name", "Unknown")
            sev = (a.get("severity") or a.get("risk") or "medium").lower()
            icon = sev_icon.get(sev, "🟡")
            desc = a.get("description", "")
            mgmt = a.get("management") or a.get("action", "")
            lines.append(f"**{icon} {name}** _(severity: {sev})_")
            if desc:
                lines.append(f"- {desc}")
            if mgmt:
                lines.append(f"- _Action:_ {mgmt}")
            lines.append("")
        return "\n".join(lines).strip(), [
            f"Irrigation schedule for {crop['crop_id']}",
            f"Fertilizer for {crop['crop_id']}",
        ]
    lines = [T(lang, "pest_header", crop=crop["crop_name"])]
    if not items:
        lines.append(T(lang, "pest_none"))
    for a in items[:5]:
        name = a.get("pest_disease") or a.get("name", "Unknown")
        sev = (a.get("severity") or a.get("risk") or "medium").lower()
        icon = sev_icon.get(sev, "🟡")
        desc = a.get("description", "")
        mgmt = a.get("management") or a.get("action", "")
        lines.append(f"**{icon} {name}** {T(lang, 'pest_severity', sev=sev)}")
        if desc:
            lines.append(f"- {desc}")
        if mgmt:
            lines.append(T(lang, "pest_action", mgmt=mgmt))
        lines.append("")
    return "\n".join(lines).strip(), [
        T(lang, "sug_irrigation_of2", crop=crop["crop_id"]),
        T(lang, "sug_fertilizer_of", crop=crop["crop_id"]),
    ]


def _intent_irrigation(crop: Dict[str, str], lang: str, region: Optional[str] = None,
                        season: Optional[str] = None) -> Reply:
    # C-25 fix: default to kharif (matching _intent_recommend's own default)
    # so the season used to filter weather and the sowing date used to build
    # the schedule always agree -- previously an unspecified season left
    # weather blended across all seasons while the sowing date stayed a
    # hardcoded kharif date, understating rainfall by ~44% on real regions.
    season = season if season in _VALID_SEASONS else "kharif"
    weather = _region_weather(region, season)
    rainfall = weather["rainfall_mm"]
    sowing_date = _SEASON_SOWING_DATE[season]
    try:
        sch = irrigation_schedule(crop["crop_id"], sowing_date, rainfall, 0.5)
    except Exception as e:
        return (f"Couldn't build schedule: {e}" if lang == "en" else T(lang, "generic_error", err=e)), []
    weeks = sch.get("weekly_schedule", []) if isinstance(sch, dict) else []
    sow_dt = datetime.strptime(sowing_date, "%Y-%m-%d")
    sow_label = f"{sow_dt.day} {sow_dt.strftime('%b')}"
    if lang == "en":
        lines = [f"### Irrigation schedule — {crop['crop_name']}", f"_Sown {sow_label} ({season}) · {rainfall:.0f} mm seasonal rainfall_\n"]
        if weeks:
            lines.append("| Week | Stage | Water Need (mm) | Rain (mm) | Irrigation (mm) |")
            lines.append("|---:|---|---:|---:|---:|")
            for w in weeks[:16]:
                wk = w.get("week") or w.get("week_number", "?")
                stage = w.get("growth_stage", "—")
                water_need = w.get("water_need_mm") or 0.0
                expected_rain = w.get("expected_rainfall_mm") or 0.0
                irr_req = w.get("irrigation_required_mm") or 0.0
                lines.append(f"| {wk} | {stage} | {water_need} | {expected_rain} | {irr_req} |")
            if isinstance(sch, dict) and sch.get("total_irrigation_needed_mm") is not None:
                lines.append(f"\n**Total seasonal irrigation needed:** {sch['total_irrigation_needed_mm']} mm")
        else:
            lines.append("_No schedule available._")
        return "\n".join(lines), [f"Pest alerts for {crop['crop_id']}", f"Crop calendar for {crop['crop_id']}"]
    lines = [T(lang, "irrigation_header", crop=crop["crop_name"]), T(lang, "irrigation_sub", rain=f"{rainfall:.0f}")]
    if weeks:
        lines.append(T(lang, "irrigation_table_hdr"))
        lines.append("|---:|---|---:|---:|---:|")
        for w in weeks[:16]:
            wk = w.get("week") or w.get("week_number", "?")
            stage = w.get("growth_stage", "—")
            water_need = w.get("water_need_mm") or 0.0
            expected_rain = w.get("expected_rainfall_mm") or 0.0
            irr_req = w.get("irrigation_required_mm") or 0.0
            lines.append(f"| {wk} | {stage} | {water_need} | {expected_rain} | {irr_req} |")
        if isinstance(sch, dict) and sch.get("total_irrigation_needed_mm") is not None:
            lines.append(T(lang, "irrigation_total", mm=sch["total_irrigation_needed_mm"]))
    else:
        lines.append(T(lang, "irrigation_none"))
    return "\n".join(lines), [
        T(lang, "sug_pest_of2", crop=crop["crop_id"]),
        T(lang, "sug_calendar_of", crop=crop["crop_id"]),
    ]


def _intent_calendar(crop: Dict[str, str], lang: str) -> Reply:
    try:
        cal = get_crop_calendar(crop["crop_id"])
    except Exception as e:
        return (f"Couldn't fetch calendar: {e}" if lang == "en" else T(lang, "generic_error", err=e)), []
    if lang == "en":
        lines = [f"### Crop calendar — {crop['crop_name']}\n"]
        if isinstance(cal, dict):
            seasons = cal.get("seasons", {})
            for season_name, cal_data in seasons.items():
                lines.append(f"**Season: {season_name.title()}**")
                for key in ("nursery", "land_prep", "sowing_transplant", "first_fertilizer", "second_fertilizer",
                            "third_fertilizer", "critical_irrigation", "pest_watch", "harvest_window", "duration_days"):
                    if key in cal_data:
                        lines.append(f"- **{key.replace('_',' ').title()}:** {cal_data[key]}")
                lines.append("")
        else:
            lines.append(str(cal))
        return "\n".join(lines), [f"Irrigation schedule for {crop['crop_id']}", f"Pest alerts for {crop['crop_id']}"]
    lines = [T(lang, "calendar_header", crop=crop["crop_name"])]
    if isinstance(cal, dict):
        seasons = cal.get("seasons", {})
        for season_name, cal_data in seasons.items():
            lines.append(T(lang, "calendar_season", season=season_name.title()))
            for key in ("nursery", "land_prep", "sowing_transplant", "first_fertilizer", "second_fertilizer",
                        "third_fertilizer", "critical_irrigation", "pest_watch", "harvest_window", "duration_days"):
                if key in cal_data:
                    lines.append(f"- **{key.replace('_',' ').title()}:** {cal_data[key]}")
            lines.append("")
    else:
        lines.append(str(cal))
    return "\n".join(lines), [
        T(lang, "sug_irrigation_of2", crop=crop["crop_id"]),
        T(lang, "sug_pest_of2", crop=crop["crop_id"]),
    ]


def _intent_schemes(crop: Optional[Dict[str, str]], region: Optional[str], text: str, lang: str) -> Reply:
    tagged, leftover = _extract_amounts(text)
    area = tagged.get("area")
    if area is None:
        area = leftover[0] if leftover else 3.0
    if not _sane_area(area):
        area = 3.0
    try:
        schemes = match_government_schemes(
            crop["crop_id"] if crop else "all",
            region or "all",
            area,
            "all",
        )
    except Exception as e:
        return (f"Couldn't match schemes: {e}" if lang == "en" else T(lang, "schemes_error", err=e)), []
    items = schemes.get("eligible_schemes", []) if isinstance(schemes, dict) else []
    if not items:
        return ("No matching government schemes found for this profile." if lang == "en"
                else T(lang, "schemes_none")), []
    if lang == "en":
        lines = [f"### Eligible schemes for {area:.1f} acre farm\n"]
        for s in items[:8]:
            name = s.get("scheme_name") or s.get("name") or "Scheme"
            desc = s.get("description", "")
            benefit = s.get("benefit_label") or s.get("benefit_value") or s.get("benefit", "")
            link = s.get("url") or s.get("apply_url")
            lines.append(f"**📜 {name}**")
            if desc:
                lines.append(f"- {desc}")
            if benefit:
                lines.append(f"- **Benefit:** {benefit}")
            if link:
                lines.append(f"- [Apply here]({link})")
            lines.append("")
        return "\n".join(lines).strip(), []
    lines = [T(lang, "schemes_header", area=f"{area:.1f}")]
    for s in items[:8]:
        name = s.get("scheme_name") or s.get("name") or "Scheme"
        desc = s.get("description", "")
        benefit = s.get("benefit_label") or s.get("benefit_value") or s.get("benefit", "")
        link = s.get("url") or s.get("apply_url")
        lines.append(f"**📜 {name}**")
        if desc:
            lines.append(f"- {desc}")
        if benefit:
            lines.append(T(lang, "schemes_benefit", benefit=benefit))
        if link:
            lines.append(T(lang, "schemes_apply", link=link))
        lines.append("")
    return "\n".join(lines).strip(), []


def _intent_loan(text: str, lang: str) -> Reply:
    tagged, leftover = _extract_amounts(text)
    total_cost = tagged.get("budget")
    expected_profit = tagged.get("expected_profit")
    if total_cost is None:
        total_cost = leftover.pop(0) if leftover else None
    if expected_profit is None:
        expected_profit = leftover.pop(0) if leftover else None
    if total_cost is None or expected_profit is None:
        if lang == "en":
            return (
                "Tell me the **total cost** and **expected profit**, e.g. "
                "_\"loan for cost 80000 profit 120000\"_.",
                [],
            )
        return T(lang, "loan_need_input"), []
    if not _sane_budget(total_cost):
        msg = (
            f"That cost doesn't look right ({_fmt_inr(total_cost)}). "
            "Try e.g. _\"loan for cost 80000 profit 120000\"_."
        ) if lang == "en" else T(lang, "loan_need_input")
        return msg, []
    try:
        res = loan_calculator(total_cost=total_cost, expected_profit=expected_profit)
    except Exception as e:
        return (f"Couldn't run calculator: {e}" if lang == "en" else T(lang, "loan_error", err=e)), []
    if lang == "en":
        lines = ["### Loan feasibility\n"]
        pretty = {
            "loan_amount": "Loan amount", "emi": "EMI / month",
            "interest_rate_annual_pct": "Interest rate (%)", "tenure_months": "Tenure (months)",
            "total_interest": "Total interest", "total_repayment": "Total repayment",
            "expected_profit_after_loan": "Profit after loan", "verdict": "Verdict",
        }
    else:
        lines = [T(lang, "loan_header")]
        pretty = {
            "loan_amount": T(lang, "lbl_loan_amount"), "emi": T(lang, "lbl_emi"),
            "interest_rate_annual_pct": T(lang, "lbl_interest_rate"), "tenure_months": T(lang, "lbl_tenure"),
            "total_interest": T(lang, "lbl_total_interest"), "total_repayment": T(lang, "lbl_total_repayment"),
            "expected_profit_after_loan": T(lang, "lbl_profit_after_loan"), "verdict": T(lang, "lbl_verdict"),
        }
    if isinstance(res, dict):
        for k, lbl in pretty.items():
            if k in res:
                v = res[k]
                if isinstance(v, (int, float)) and "rate" not in k and "ratio" not in k and "month" not in k:
                    v = _fmt_inr(v) if v > 100 else f"{v}"
                lines.append(f"- **{lbl}:** {v}")
    return "\n".join(lines), []


def _intent_msp_vs_market(crop: Dict[str, str], region: Optional[str], lang: str) -> Reply:
    if not region:
        return ("Which region should I compare MSP vs market in?" if lang == "en"
                else T(lang, "msp_vs_need_region")), []
    try:
        res = msp_vs_market(region, crop["crop_id"])
    except Exception as e:
        return (f"Couldn't compare: {e}" if lang == "en" else T(lang, "msp_vs_error", err=e)), []
    rtxt = region_display_name(region)
    if lang == "en":
        lines = [f"### MSP vs Market — {crop['crop_name']} @ {rtxt}\n"]
        pretty = {
            "msp_year": "MSP Year", "msp_inr_per_kg": "MSP (INR/kg)",
            "current_mandi_price": "Current Mandi Price", "avg_mandi_6m": "Average Mandi Price (6m)",
            "mandi_msp_gap_pct": "Difference (%)", "recommendation": "Recommendation",
        }
    else:
        lines = [T(lang, "msp_vs_header", crop=crop["crop_name"], region=rtxt)]
        pretty = {
            "msp_year": T(lang, "lbl_msp_year"), "msp_inr_per_kg": T(lang, "lbl_msp_per_kg"),
            "current_mandi_price": T(lang, "lbl_current_mandi"), "avg_mandi_6m": T(lang, "lbl_avg_mandi_6m"),
            "mandi_msp_gap_pct": T(lang, "lbl_gap_pct"), "recommendation": T(lang, "lbl_recommendation"),
        }
    if isinstance(res, dict):
        for k, lbl in pretty.items():
            if k in res:
                v = res[k]
                if isinstance(v, float) and "pct" in k:
                    v = f"{v:+.2f}%"
                elif isinstance(v, float):
                    v = f"{v:,.2f}"
                lines.append(f"- **{lbl}:** {v}")
    if lang == "en":
        return "\n".join(lines), [f"Best time to sell {crop['crop_id']}", f"Price forecast for {crop['crop_id']}"]
    return "\n".join(lines), [
        T(lang, "sug_sell_time_of", crop=crop["crop_id"]),
        T(lang, "sug_forecast_of", crop=crop["crop_id"]),
    ]


# ---------------------------------------------------------------------------
# Main router
# ---------------------------------------------------------------------------
def _intent_forecast(crop: Dict[str, str], region: Optional[str], lang: str) -> Reply:
    """Six-month price outlook.

    `_build_actions` has always had a "forecast" branch and the docs advertise
    price forecasting, but no route ever produced that intent -- the question
    fell through to the generic crop-info reply.
    """
    if not region:
        return (("Which region? e.g. _\"price forecast for soybean in MP Sehore\"_."
                 if lang == "en" else T(lang, "forecast_need_region")), [])
    try:
        res = price_forecast(region, crop["crop_id"])
    except Exception as e:
        return ((f"Couldn't build a forecast: {e}" if lang == "en"
                 else T(lang, "generic_error", err=e)), [])
    pts = res.get("forecasts") or []
    cur = res.get("current_price")
    rtxt = region_display_name(region)
    head = (f"### Price outlook — {crop['crop_name']} @ {rtxt}"
            if lang == "en" else T(lang, "forecast_header", crop=crop["crop_name"], region=rtxt))
    lines = [head, ""]
    if cur is not None:
        lines.append(f"- **Now:** ₹{cur}/kg")
    for pt in pts[:6]:
        month = pt.get("month") or ""
        price = pt.get("forecast_price")
        if price is not None:
            lines.append(f"- **{month}:** ₹{price}/kg")
    if res.get("trend_direction"):
        lines.append("")
        lines.append(f"_Trend: {res['trend_direction']} "
                     f"({res.get('trend_slope_per_month', 0)}/kg per month)._")
    sug = [f"Best time to sell {crop['crop_id']}", f"MSP vs market for {crop['crop_id']}"]
    return "\n".join(lines), sug


def _intent_rotation(region: Optional[str], lang: str) -> Reply:
    """Best kharif -> rabi pairings for a region (same engine the dashboard uses)."""
    if not region:
        return (("Which region should I plan a rotation for?" if lang == "en"
                 else T(lang, "recommend_need_region")), ["List regions"])
    try:
        plan = rotation_planner(region, _default_budget(region, "kharif"), 3)
    except Exception as e:
        return ((f"Couldn't plan a rotation: {e}" if lang == "en"
                 else T(lang, "generic_error", err=e)), [])
    combos = (plan or {}).get("top_rotations") or []
    if not combos:
        return (("No rotation pairing scored well enough for that region."
                 if lang == "en" else T(lang, "recommend_no_strong",
                                        region=region_display_name(region), season="")), [])
    rtxt = region_display_name(region)
    lines = [f"### Rotation plan — {rtxt}", ""] if lang == "en" else [
        T(lang, "rotation_header", region=rtxt), ""]
    for i, c in enumerate(combos[:3], 1):
        kh = c.get("kharif_crop") or c.get("kharif") or "?"
        rb = c.get("rabi_crop") or c.get("rabi") or "?"
        profit = c.get("annual_profit", 0)
        lines.append(f"{i}. **{_crop_label(kh)} → {_crop_label(rb)}** "
                     f"— annual profit {_fmt_inr(profit)}")
    return "\n".join(lines), ["Recommend crops for this region", "Open dashboard"]


# ---------------------------------------------------------------------------
# Intents added for the questions farmers most often typed that used to fall
# through to "I didn't catch that": leaf symptoms, fertilizer doses, weather,
# a plain EMI, two-crop comparisons, model accuracy, carbon credits, the
# site's other pages, and who the assistant is.
# ---------------------------------------------------------------------------
_SCREENED_CROPS = {"maize", "potato", "soybean", "tomato"}


def _intent_symptoms(crop: Optional[Dict[str, str]], region: Optional[str],
                     season: Optional[str], lang: str) -> Reply:
    name = crop["crop_name"] if crop else "your crop"
    lines = [f"### Leaf trouble on {name}\n"]
    if crop and crop["crop_id"] in _SCREENED_CROPS:
        lines.append("Upload a clear photo of one affected leaf to **Leaf symptom screening** on the "
                     "dashboard. It screens maize, potato, soybean and tomato leaves for 18 conditions "
                     "and gives an organic and a chemical plan.")
    else:
        lines.append("Photo screening covers **maize, potato, soybean and tomato** leaves. For "
                     f"{name}, the weather-based pest and disease rules are the closest check.")
    lines += ["", "**Until you know what it is:**",
              "- Pick off and destroy the worst-affected leaves; do not compost them.",
              "- Water at the base in the morning, not over the leaves.",
              "- Do not spray a chemical until the problem is identified.",
              "- Show a sample to your nearest **KVK** (Krishi Vigyan Kendra) for a confirmed diagnosis."]
    if crop:
        try:
            alerts = pest_disease_alerts(crop["crop_id"], _region_weather(region, season))
            items = alerts if isinstance(alerts, list) else alerts.get("alerts", []) if isinstance(alerts, dict) else []
            likely = [a for a in items
                      if str(a.get("risk_level") or a.get("severity") or "").lower() in ("high", "medium")]
            if likely:
                lines += ["", "**Likely in this weather:** " + ", ".join(
                    str(a.get("pest_disease") or a.get("name")) for a in likely[:3])]
        except Exception:
            pass
    return "\n".join(lines), ["Pest alerts for " + (crop["crop_id"] if crop else "tomato"), "Find an expert near me"]


def _intent_fertilizer(crop: Dict[str, str], region: Optional[str], lang: str) -> Reply:
    soil_row = next((r for r in _soil() if r.get("region_id") == region), None) if region else None
    if soil_row:
        soil = {k: float(soil_row[k]) for k in ("n_kg_per_acre", "p_kg_per_acre", "k_kg_per_acre")}
    else:
        soil = {"n_kg_per_acre": 0.0, "p_kg_per_acre": 0.0, "k_kg_per_acre": 0.0}
    try:
        rec = fertilizer_recommendation(crop["crop_id"], soil)
    except Exception as e:
        return f"Couldn't work out a dose: {e}", []
    where = (f"the average soil of {region_display_name(region)}" if soil_row
             else "no soil test (the crop's full requirement)")
    lines = [f"### Fertilizer for {crop['crop_name']}, per acre\n", f"_Based on {where}._\n"]
    for r in rec.get("recommendations", []) or []:
        nm = r.get("fertilizer") or r.get("name")
        qty = r.get("quantity_kg_per_acre")
        if qty is None:
            qty = r.get("kg_per_acre", r.get("quantity_kg"))
        when = r.get("application_timing") or r.get("timing") or ""
        if nm and qty is not None:
            lines.append(f"- **{nm}:** {round(float(qty), 1)} kg" + (f" · {when}" if when else ""))
    cost = rec.get("total_fertilizer_cost_per_acre") or rec.get("total_cost")
    if len(lines) <= 2:
        lines.append("The soil already supplies what this crop needs; no top-up is required.")
    elif cost:
        lines.append(f"\n**Cost:** about {_fmt_inr(cost)} per acre.")
    lines.append("\nA soil test (Soil Health Card) on your own field gives a better dose than the district average.")
    return "\n".join(lines), [f"Irrigation for {crop['crop_id']}", f"Pest alerts for {crop['crop_id']}"]


def _intent_weather(region: Optional[str], season: Optional[str], lang: str) -> Reply:
    if not region:
        return ("Which district? e.g. _\"weather in MH Pune\"_. The **My Farm** page on the dashboard "
                "shows the next 7 days for your saved farm."), ["List regions"]
    season = season if season in _VALID_SEASONS else "kharif"
    w = _region_weather(region, season)
    reply = (f"### Weather in {region_display_name(region)}, {season.title()}\n\n"
             f"- **Typical season temperature:** {w['avg_temp_c']}°C\n"
             f"- **Typical season rainfall:** {round(w['rainfall_mm'])} mm\n\n"
             "These are the district's seasonal reference values. For the next 7 days (rain, "
             "temperature and whether it is a good day to spray), open **My Farm** on the dashboard.")
    return reply, ["Irrigation for rice", "Pest alerts for rice"]


_LAKH = re.compile(r"(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l\b)", re.I)
_THOUSAND = re.compile(r"(\d+(?:\.\d+)?)\s*(k\b|thousand)", re.I)
_RATE = re.compile(r"(\d+(?:\.\d+)?)\s*(%|percent|per cent)", re.I)
_MONTHS_RE = re.compile(r"(\d+)\s*(months?|mo\b)", re.I)
_YEARS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(years?|yrs?)", re.I)


def _plain_emi(text: str) -> Optional[Reply]:
    """'loan of 2 lakh at 7% for 12 months' -> EMI. None when no principal is given."""
    m = _LAKH.search(text)
    k = _THOUSAND.search(text)
    if m:
        principal = float(m.group(1)) * 100_000
    elif k:
        principal = float(k.group(1)) * 1_000
    else:
        big = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]{3,}", text)]
        principal = big[0] if big else None
    if not principal or principal < 1000:
        return None
    rm = _RATE.search(text)
    rate = float(rm.group(1)) if rm else 7.0
    mm = _MONTHS_RE.search(text)
    ym = _YEARS_RE.search(text)
    months = int(mm.group(1)) if mm else int(round(float(ym.group(1)) * 12)) if ym else 12
    months = max(1, min(months, 360))
    r = rate / 100 / 12
    emi = principal * r * (1 + r) ** months / ((1 + r) ** months - 1) if r > 0 else principal / months
    total = emi * months
    lines = ["### Loan EMI\n",
             f"- **Loan:** {_fmt_inr(principal)}",
             f"- **Interest:** {rate:g}% a year" + ("" if rm else " (assumed; tell me your rate)"),
             f"- **Tenure:** {months} months",
             f"- **EMI:** {_fmt_inr(emi)} a month",
             f"- **Total interest:** {_fmt_inr(total - principal)}",
             f"- **Total repayment:** {_fmt_inr(total)}"]
    if rate > 4:
        lines.append("\nA **Kisan Credit Card** crop loan up to ₹3 lakh works out to about **4%** a year "
                     "when repaid on time (7% less the 3% prompt-repayment incentive).")
    return "\n".join(lines), ["Government schemes for me", "Loan for cost 80000 profit 120000"]


def _find_crops(text: str) -> List[Dict[str, str]]:
    """Every crop named in the message, in the order they appear."""
    t = text.lower()
    found: Dict[str, Tuple[int, Dict[str, str]]] = {}
    cbi = _crop_by_id()
    names = list(_crop_by_name().items())
    names += [(a, cbi[c]) for a, c in _ENGLISH_CROP_ALIASES.items() if c in cbi]
    names += [(cid.replace("_", " "), row) for cid, row in cbi.items()]
    for name, row in sorted(names, key=lambda kv: -len(kv[0])):
        hit = re.search(rf"\b{re.escape(name)}\b", t)
        if hit and row["crop_id"] not in found:
            found[row["crop_id"]] = (hit.start(), row)
    return [row for _, row in sorted(found.values(), key=lambda x: x[0])]


def _intent_compare(crops: List[Dict[str, str]], region: Optional[str], season: Optional[str],
                    lang: str) -> Reply:
    if not region:
        return "Which district should I compare them in? e.g. _\"compare rice and maize in Telangana Medak\"_.", []
    season = season if season in _VALID_SEASONS else "kharif"
    budget = _default_budget(region, season)
    try:
        recs = recommend_crops(region_id=region, season=season, budget_per_acre=budget,
                               area_acres=3.0, top_k=50, include_losses=True)
    except Exception as e:
        return f"Couldn't compare: {e}", []
    by_id = {r["crop_id"]: r for r in recs}
    lines = [f"### {' vs '.join(c['crop_name'] for c in crops)}: {region_display_name(region)}, {season.title()}\n",
             f"_3 acres at the typical {_fmt_inr(budget)}/acre:_\n"]
    rows = [(c, by_id.get(c["crop_id"])) for c in crops]
    for c, r in sorted(rows, key=lambda x: -(x[1]["expected_profit"] if x[1] else -1e12)):
        if not r:
            lines.append(f"- **{c['crop_name']}:** not a {season} crop here")
            continue
        lines.append(f"- **{c['crop_name']}:** profit {_fmt_inr(r['expected_profit'])}, "
                     f"ROI {round(r['roi_percent'])}%, risk {round(r['risk_score'])}/100, "
                     f"yield {round(r['predicted_yield_kg_per_acre'])} kg/acre")
    return "\n".join(lines), [f"Recommend crops for {region_display_name(region)}"]


def _intent_models(lang: str) -> Reply:
    return ("### How good are the models?\n\n"
            "- **Yield:** each district's own harvest record (up to 25 seasons) where one exists; "
            "the range shown is where 8 seasons in 10 have landed.\n"
            "- **Crop recommender:** 96% top-1 accuracy across 22 crops on held-out data.\n"
            "- **Price forecast:** tested against simple rules for every crop and horizon; the model is "
            "used only where it beat them.\n"
            "- **Leaf screening:** about 80% accuracy on held-out photos of maize, potato, soybean and tomato.\n\n"
            "None of them has been tested on your own field yet, so use them to compare options and "
            "trust your own experience. Every number on the dashboard says where it came from; the "
            "full test results are under **About the models**."), ["Recommend crops for my region"]


def _intent_carbon(lang: str) -> Reply:
    return ("### Soil carbon credits\n\n"
            "Zero tillage, cover crops, keeping crop residue and agroforestry store carbon in the soil. "
            "The **Carbon credits** tool on the dashboard estimates the tonnes of CO₂e a year and an "
            "illustrative value for your plot.\n\n"
            "It is an **estimate only**: a credit can be sold only after soil sampling, an approved "
            "methodology and verification by a registry, usually through an aggregator or FPO."), []


_PAGES = [
    (r"\btractors?\b|\bharvesters?\b|\bmachinery\b|\brent (a )?(machine|equipment)",
     "Book a Tractor", "/book-a-tractor.html",
     "Find tractors and implements by district. It is a **demo with sample operators**: nothing is booked or charged."),
    (r"\bmarketplace\b|\bsell (my )?(produce|harvest) online\b|\bfind (a )?buyers?\b",
     "Marketplace", "/marketplace.html",
     "List produce or browse buyers, with real mandi prices beside every listing. Listings and sellers are **sample data**."),
    (r"\bexperts?\b|\bagronomists?\b|\bconsult|\bkvk\b|\bscientists?\b",
     "Gyan Seva", "/gyan-seva.html",
     "Find agronomists by district and specialism, or the KVK scientist for your area. The expert list is "
     "**illustrative**; the KVK contact is the verified option."),
    (r"\bdraw (my )?(farm|field|plot)|\bboundary\b|\bmap (my )?(farm|field)\b",
     "Draw farm", "/farm-boundary.html",
     "Draw your field on the map: it measures the area and fetches soil for that exact spot, and every tool then uses it."),
    (r"\bback ?up\b|\bexport (my )?data\b|\bmy data\b|\bdelete (my )?data\b|\bprivacy\b",
     "Your data", "/your-data.html",
     "Everything you enter stays on this phone. Back it up to a file, restore it, or delete it from **Your data**."),
    (r"\bseason plan\b|\bplan (my|the) season\b|\bstep by step\b",
     "Plan your season", "/decide.html",
     "Answer one question at a time (farm, shortlist, trade-offs) and save a plan you can follow through the season."),
]


def _intent_page(text: str) -> Optional[Tuple[str, List[str], Dict[str, str]]]:
    for pattern, label, href, blurb in _PAGES:
        if re.search(pattern, text):
            return f"### {label}\n\n{blurb}", [], _action(f"Open {label} →", href)
    return None


_SLASH_ALIASES = {
    "/help": "help", "/?": "help",
    "/crops": "list crops", "/regions": "list regions",
    "/recommend": "recommend crops",
    "/msp": "msp",
    "/mandi": "mandi price",
    "/pest": "pest alerts",
    "/irrigate": "irrigation schedule",
    "/calendar": "crop calendar",
    "/scheme": "government schemes",
    "/schemes": "government schemes",
    "/loan": "loan",
    "/sell": "best time to sell",
    # Intents the router already handles but that had no slash form, so typing
    # the obvious command fell through to the generic crop-info reply.
    "/forecast": "price forecast",
    "/price": "price forecast",
    "/rotation": "rotation plan",
    "/mspvsmarket": "msp vs market",
}


def _unknown_slash_reply(token: str, lang: str) -> Reply:
    """An unrecognised /command used to fall through to intent matching, so the
    user got a generic "I didn't catch that" with no hint that the problem was
    a typo in the command itself."""
    known = ", ".join(sorted(k for k in _SLASH_ALIASES if k != "/?"))
    if lang == "en":
        return (
            f"**{token}** isn't a command I know.\n\n"
            f"Try one of these: {known}\n\n"
            "Or just ask in plain language, e.g. \"what's the MSP of wheat?\".",
            ["/help", "/crops", "/regions"],
        )
    return T(lang, "fallback"), ["/help", "/crops", "/regions"]


def _default_budget(region: Optional[str], season: str) -> float:
    """The region's typical per-acre input cost for the season; Rs 15,000 only
    when the region is unknown (the intent then reports the bad region itself)."""
    try:
        return round(typical_budget_per_acre(region, season)) if region else 15000.0
    except ValueError:
        return 15000.0


def _build_actions(intent: str, crop: Optional[Dict[str, str]], region: Optional[str],
                   season: Optional[str], nums: List[float]) -> List[Dict[str, str]]:
    """Build deep-link buttons into the dashboard for the given intent."""
    acts: List[Dict[str, str]] = []
    if intent == "recommend":
        budget = nums[0] if nums else _default_budget(region, season if season in _VALID_SEASONS else "kharif")
        area = nums[1] if len(nums) > 1 else 3
        acts.append(_action(
            "Open in dashboard →",
            _dashboard_link("recommend", region_id=region,
                            season=season if season in _VALID_SEASONS else "kharif",
                            budget_per_acre=budget, area_acres=area),
        ))
    elif intent == "simulate" and crop:
        acts.append(_action("Simulate in dashboard →",
                            _dashboard_link("simulate", region_id=region, crop_id=crop["crop_id"])))
    elif intent == "forecast" and crop:
        acts.append(_action("Open price forecast →",
                            _dashboard_link("forecast", region_id=region, crop_id=crop["crop_id"])))
    elif intent == "rotation":
        acts.append(_action("Plan rotation →", _dashboard_link("rotation", region_id=region)))
    elif intent == "schemes":
        acts.append(_action("View all schemes →", _dashboard_link("schemes")))
    elif intent == "pest" and crop:
        acts.append(_action("See pest dashboard →",
                            _dashboard_link("pest", crop_id=crop["crop_id"])))
    elif intent == "irrigate" and crop:
        acts.append(_action("Open irrigation planner →",
                            _dashboard_link("irrigation", crop_id=crop["crop_id"])))
    return acts


def _matches(intent_key: str, text: str, english_pattern: str) -> bool:
    """English pattern OR'd with that intent's native-script/Hinglish keywords."""
    native = INTENT_PATTERNS.get(intent_key)
    pattern = f"({english_pattern})|({native})" if native else english_pattern
    return bool(re.search(pattern, text))


def answer(message: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    context = context or {}
    raw = (message or "").strip()
    if not raw:
        return {"reply": "Ask me anything about the platform or your farm.",
                "suggestions": [], "actions": [], "context": context}

    # Expand slash command at the start to a natural-language phrase.
    unknown_slash = None
    if raw.startswith("/"):
        token = raw.split(None, 1)[0].lower()
        rest = raw[len(token):].strip()
        expansion = _SLASH_ALIASES.get(token)
        if expansion:
            raw = f"{expansion} {rest}".strip()
        else:
            unknown_slash = token

    text = raw.lower()

    # Language (C-4 fix): re-detect from THIS message every turn rather than
    # trusting a sticky context["lang"] forever — a single ambiguous message
    # (e.g. one Hinglish word) used to permanently lock the whole session
    # into that language even once the user switched back to plain English.
    # The only time we fall back to the remembered language is when this
    # message has no Latin letters at all (pure digits/punctuation, e.g. a
    # bare "15000" answering a follow-up question) and therefore carries no
    # detectable signal of its own; a message with actual Devanagari/Telugu/
    # Kannada script or English words is always trusted over the memory.
    detected_lang = detect_lang(raw)
    prev_lang = context.get("lang")
    if prev_lang and detected_lang == "en" and not re.search(r"[a-zA-Z]", raw):
        lang = prev_lang
    else:
        lang = detected_lang

    def _pack(reply: str, sug: List[str], intent: str = "",
              crop: Optional[Dict[str, str]] = None, region: Optional[str] = None,
              season: Optional[str] = None, nums: Optional[List[float]] = None) -> Dict[str, Any]:
        new_ctx = dict(context)
        new_ctx["lang"] = lang
        if region: new_ctx["region_id"] = region
        if crop:   new_ctx["crop_id"] = crop["crop_id"]
        if season: new_ctx["season"] = season
        actions = _build_actions(intent, crop, region, season, nums or []) if intent else []
        return {"reply": reply, "suggestions": sug, "actions": actions, "context": new_ctx}

    if unknown_slash:
        reply, sug = _unknown_slash_reply(unknown_slash, lang)
        return _pack(reply, sug)

    # Greetings (M-15 fix): only short-circuit to the canned greeting when
    # the ENTIRE message is made of greeting words (+ punctuation) — a
    # greeting word appearing anywhere in a short message used to swallow
    # real questions like "hey what is msp".
    _greeting_tokens = re.findall(r"\w+", text)
    _native_greeting_words = {g.lower() for g in sum(GREETING_WORDS.values(), [])}
    is_greeting = bool(_greeting_tokens) and all(
        tok in GREETINGS or tok in _native_greeting_words for tok in _greeting_tokens
    )
    if is_greeting:
        reply, sug = _intent_greeting(lang)
        return _pack(reply, sug)

    # Help / capabilities
    if _matches("help", text, r"\b(help|what can you do|features?|capabilit|about (the )?site|what is this)\b"):
        reply, sug = _intent_help(lang)
        return _pack(reply, sug)

    # Who/what the assistant is
    if re.search(r"\b(who are you|what are you|your name|are you (a )?(bot|human|robot|ai))\b", text):
        return _pack("I'm **Mitti Mantra's farm assistant**. I answer from this site's own data and "
                     "models (crops, district yields, mandi prices, MSP, schemes, pests, irrigation), "
                     "not from the open internet, and I say where each number comes from. I can't see "
                     "your field, so check anything serious with your KVK.",
                     ["What can you do?", "Recommend crops for my region"])
    if re.search(r"\bjoke\b", text):
        return _pack("Why did the farmer win an award? He was **outstanding in his field**. 🌾\n\n"
                     "Now, what can I help you grow?", ["Recommend crops for my region", "MSP of wheat"])

    # Lists
    if _matches("list_crops", text, r"\blist (of )?(all )?crops\b|\bwhich crops\b|\bavailable crops\b"):
        reply, sug = _intent_list_crops(lang)
        return _pack(reply, sug)
    if _matches("list_regions", text, r"\blist (of )?(all )?regions\b|\bwhich regions\b|\bavailable regions\b|\bregions you (have|support)\b"):
        reply, sug = _intent_list_regions(lang)
        return _pack(reply, sug)

    crop = _find_crop(text)

    # M-13 fix: crop_id from the client is already checked against the real
    # crop table below; region_id/season weren't, so a forged/stale context
    # value could reach the engine and surface a raw ValueError. Validate
    # both and drop to None on failure so the existing "which region?"
    # clarifying prompts kick in instead.
    ctx_region = context.get("region_id")
    if ctx_region and ctx_region not in _regions():
        ctx_region = None
    ctx_season = context.get("season")
    if ctx_season and ctx_season not in _VALID_SEASONS:
        ctx_season = None

    region = _find_region(raw) or ctx_region
    season = _find_season(text) or ctx_season
    nums = _find_numbers(text)
    # Fall back to remembered crop when the user asks a short follow-up like "its MSP?"
    if not crop and context.get("crop_id"):
        _cbi = _crop_by_id()
        if context["crop_id"] in _cbi:
            crop = _cbi[context["crop_id"]]

    # H-6 fix: "which crop?" clarifying prompts, shared by the crop-gated
    # intents below (including MSP vs market). These used to have no branch
    # for crop=None, so a bare /pest, /irrigate, /calendar, /sell, or
    # /mspvsmarket fell all the way through to the generic "I didn't catch
    # that" fallback -- which itself recommended trying the exact command
    # that had just failed. Defined here (rather than further down, as it
    # originally was) so the MSP-vs-market check below can use it too.
    def _need_crop(example: str) -> Reply:
        if lang == "en":
            return f"Which crop? e.g. `{example} rice`", [f"{example} rice", f"{example} wheat"]
        return T(lang, "need_crop", example=example), []

    # MSP vs market. `_intent_msp_vs_market` has existed since the MSP work
    # landed but nothing ever routed to it, so the comparison was
    # unreachable. Must be checked before the plain-MSP branch below, which
    # would otherwise swallow every comparison query first.
    #
    # C-22 fix: this exact check used to *also* exist, narrower (only
    # recognized "vs/versus/compared", not "against"/"compared to/with"),
    # right here, further up -- and *this* more complete version, with
    # proper crop-gating, sat after the plain-MSP branch below, making it
    # dead code. Plain MSP intercepted every comparison query -- both
    # `/mspvsmarket` (crop=None, so the old narrower check above also
    # skipped it via its `if crop and ...` guard) and any comparison
    # phrasing the old narrow regex didn't cover -- before this ever ran.
    # Consolidated into this single check, now reachable.
    # Two or more crops named with a comparison word
    _named = _find_crops(text)
    if (len(_named) >= 2 and not re.search(r"\bmsp\b", text)
            and re.search(r"\bcompare\b|\bvs\.?\b|\bversus\b|\bor\b|\bbetter\b|\bdifference\b", text)):
        reply, sug = _intent_compare(_named[:4], region, season, lang)
        out = _pack(reply, sug, region=region, season=season)
        out["actions"] = [_action("Open Compare crops →", _dashboard_link("compare", region_id=region))]
        return out

    # Weather (before the price forecast, which "weather forecast" would match)
    if (re.search(r"\bweather\b|\btemperature\b|\bwill it rain\b|\brainfall\b|\bmausam\b", text)
            and not re.search(r"\bprice\b|\birrigat", text)):
        reply, sug = _intent_weather(region, season, lang)
        out = _pack(reply, sug, region=region, season=season)
        out["actions"] = [_action("Open My Farm →", _dashboard_link("home"))]
        return out

    # Leaf symptoms (before pest, which needs the words pest/disease)
    if (re.search(r"\b(spots?|spotted|lesions?|yellow(ing)?|wilt(ing|ed)?|blight|rot(ting)?|curl(ing)?|"
                  r"mildew|rust|holes?|patches|dhabbe|daag)\b", text)
            and re.search(r"\b(leaf|leaves|patt?e|patton|plants?|stems?|fruits?)\b", text)):
        reply, sug = _intent_symptoms(crop, region, season, lang)
        out = _pack(reply, sug, crop=crop, region=region)
        out["actions"] = [_action("Open leaf screening →", _dashboard_link("disease")),
                          _action("Find an expert →", "/gyan-seva.html")]
        return out

    # Fertilizer doses
    if re.search(r"\b(fertili[sz]ers?|urea|dap|mop|potash|npk|nutrients?|khaad|khad)\b", text):
        if not crop:
            return _pack("Which crop? e.g. _\"how much urea for rice\"_.", ["Fertilizer for rice", "Fertilizer for wheat"])
        reply, sug = _intent_fertilizer(crop, region, lang)
        out = _pack(reply, sug, crop=crop, region=region)
        out["actions"] = [_action("Open fertilizer planner →", _dashboard_link("fertilizer", crop_id=crop["crop_id"]))]
        return out

    # Model accuracy / trust
    if re.search(r"\baccura|\bhow (good|reliable|correct)\b|\bcan i trust\b|\bmodels?\b.*\b(work|good|tested)\b", text):
        out = _pack(*_intent_models(lang))
        out["actions"] = [_action("Open model status →", _dashboard_link("ml"))]
        return out

    # Carbon credits
    if re.search(r"\bcarbon\b", text):
        out = _pack(*_intent_carbon(lang))
        out["actions"] = [_action("Open carbon estimator →", _dashboard_link("carbon"))]
        return out

    # The site's other pages
    _page = _intent_page(text)
    if _page:
        out = _pack(_page[0], _page[1])
        out["actions"] = [_page[2]]
        return out

    if _matches("msp_vs_market", text, r"\bmsp (vs|versus|against|compared? (to|with))\b|\bmsp.{0,12}market\b"):
        if not crop:
            reply, sug = _need_crop("/mspvsmarket")
            return _pack(reply, sug, region=region)
        reply, sug = _intent_msp_vs_market(crop, region, lang)
        return _pack(reply, sug, "forecast", crop, region)

    # Plain MSP
    if _matches("msp", text, r"\bmsp\b|\bminimum support price\b"):
        reply, sug = _intent_msp(crop, lang)
        return _pack(reply, sug, crop=crop, region=region)

    # Recommend
    # M-14 fix: a bare "suggest(ion)" alternation used to hijack unrelated
    # questions like "any suggestion for pest control on rice" before the
    # pest/irrigation/etc. intents below ever got a chance to match. Require
    # "suggest(ion)" to co-occur with a crop/grow/plant word so it only
    # fires for genuine crop-choice questions.
    # C-24 fix: grow/plant/sow were exact-word-only, so "-ing" forms like
    # "growing" or "planting" (a very natural way to phrase this) missed the
    # gate entirely and fell through to the generic fallback reply.
    if _matches("recommend", text, r"\brecommend(ation)?s?\b|\bwhich crops?\b|\bbest crops?\b|\bwhat (should|to) (i )?(grow(ing)?|plant(ing)?|sow(ing)?)\b|\bsuggest(ion)?s?\b.*\b(crops?|grow(ing)?|plant(ing)?|sow(ing)?)\b|\b(crops?|grow(ing)?|plant(ing)?|sow(ing)?)\b.*\bsuggest(ion)?s?\b"):
        reply, sug = _intent_recommend(region, season, text, lang)
        return _pack(reply, sug, "recommend", region=region, season=season, nums=nums)

    # Rotation planning
    if _matches("rotation", text, r"\brotation\b|\brotate\b|\bkharif.{0,12}rabi\b"):
        reply, sug = _intent_rotation(region, lang)
        return _pack(reply, sug, "rotation", region=region)

    # Price forecast. Must precede the mandi-price branch, whose broad
    # "prices?" pattern would otherwise claim every forecast question.
    if _matches("forecast", text, r"\bforecast\b|\bprice (outlook|trend|prediction)\b|predict.{0,10}price|future price"):
        if not crop:
            reply, sug = _need_crop("/forecast")
            return _pack(reply, sug, "forecast", region=region)
        reply, sug = _intent_forecast(crop, region, lang)
        return _pack(reply, sug, "forecast", crop, region)

    # Sell timing
    if _matches("sell_advice", text, r"\bbest time to sell\b|\bwhen (should|to) (i )?sell\b|\bsell(ing)? advice\b"):
        if not crop:
            reply, sug = _need_crop("/sell")
            return _pack(reply, sug, "forecast", region=region)
        reply, sug = _intent_sell_advice(crop, region, lang)
        return _pack(reply, sug, "forecast", crop, region)

    # Mandi prices
    if _matches("mandi_price", text, r"\bmandi\b|\bmarket price\b|\bprice of\b|\bprice in\b|\bprices?\b") and (crop or region):
        reply, sug = _intent_mandi_price(crop, region, lang)
        return _pack(reply, sug, "forecast", crop, region)

    # Pest / disease
    if _matches("pest", text, r"\bpest\b|\bdisease\b|\binsect\b|\bfung"):
        if not crop:
            reply, sug = _need_crop("/pest")
            return _pack(reply, sug, "pest", region=region)
        # M-17 fix: pass the extracted region/season through so pest risk
        # reflects this region's real weather instead of always using a
        # fixed generic 28C/800mm regardless of where the user asked about.
        reply, sug = _intent_pest(crop, lang, region, season)
        return _pack(reply, sug, "pest", crop, region)

    # Irrigation
    if _matches("irrigation", text, r"\birrigat|\bwater(ing)?\b"):
        if not crop:
            reply, sug = _need_crop("/irrigate")
            return _pack(reply, sug, "irrigate", region=region)
        # M-17 fix: same as pest above -- use the real region/season weather.
        reply, sug = _intent_irrigation(crop, lang, region, season)
        return _pack(reply, sug, "irrigate", crop, region)

    # Calendar
    if _matches("calendar", text, r"\bcalendar\b|\bsowing\b|\bsow(ing)? date\b|\bharvest(ing)? date\b"):
        if not crop:
            reply, sug = _need_crop("/calendar")
            return _pack(reply, sug, region=region)
        reply, sug = _intent_calendar(crop, lang)
        return _pack(reply, sug, crop=crop, region=region)

    # Schemes
    if _matches("schemes", text, r"\bscheme|\bsubsidy|\bsubsidies|\bpm[- ]?kisan\b|\bgovernment\b|\bloan waiver\b|\binsurance\b"):
        # `_intent_schemes` parses the acreage out of the raw message itself
        # (`_extract_amounts`); it was being handed the already-parsed `nums`
        # list instead, so every schemes question raised TypeError -> HTTP 500.
        reply, sug = _intent_schemes(crop, region, text, lang)
        return _pack(reply, sug, "schemes", crop, region)

    # Loan
    if _matches("loan", text, r"\bloan\b|\bemi\b|\binterest\b"):
        _emi = _plain_emi(text)
        if _emi and re.search(r"lakh|lac|%|percent|months?|years?|\bat\b", text):
            out = _pack(*_emi)
            out["actions"] = [_action("Open loan calculator →", _dashboard_link("loan"))]
            return out
        # Same defect as the schemes branch: `_intent_loan` parses amounts and
        # tenure out of the raw message, and was being passed the parsed `nums`
        # list, so any loan/EMI/interest question crashed with TypeError.
        reply, sug = _intent_loan(text, lang)
        return _pack(reply, sug)

    # Tell me about <crop>
    if crop and _matches("about", text, r"\b(tell me about|about|info on|details of|what is)\b"):
        reply, sug = _intent_about_crop(crop, lang)
        return _pack(reply, sug, "simulate", crop, region)

    # Bare crop name -> crop card
    if crop and len(text.split()) <= 3:
        reply, sug = _intent_about_crop(crop, lang)
        return _pack(reply, sug, "simulate", crop, region)

    # Fallback
    if lang == "en":
        fallback = (
            "I didn't catch that. I'm tuned specifically to **Mitti Mantra**, so "
            "try questions about crops, regions, mandi prices, MSP, recommendations, "
            "irrigation, pests or government schemes.\n\n"
            "Type **help** to see everything I can do, or try slash commands like "
            "`/recommend`, `/forecast`, `/rotation`, `/msp`, `/mandi`, `/pest`, "
            "`/sell`, `/schemes`."
        )
        sug = ["Help", "Recommend crops for Telangana Medak", "MSP of wheat", "Pest alerts for rice"]
    else:
        fallback = T(lang, "fallback")
        sug = [T(lang, "sug_help2"), T(lang, "sug_recommend_medak2"), T(lang, "sug_msp_wheat3"), T(lang, "sug_pest_rice2")]
    return _pack(fallback, sug)
