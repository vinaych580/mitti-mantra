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
from typing import Any, Dict, List, Optional, Tuple

from engine.features import (
    best_time_to_sell,
    get_crop_calendar,
    get_msp_data,
    irrigation_schedule,
    loan_calculator,
    match_government_schemes,
    msp_vs_market,
    pest_disease_alerts,
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
from ml.predict import recommend_crops
from utils.csv_cache import load as _csv_load

# ---------------------------------------------------------------------------
# Data accessors — all backed by the shared mtime-aware CSV cache so the
# chatbot always reflects the latest dataset without a server restart.
# ---------------------------------------------------------------------------
def _crops() -> List[Dict[str, str]]:   return _csv_load("crop_parameters.csv")
def _soil() -> List[Dict[str, str]]:    return _csv_load("soil.csv")
def _mandi() -> List[Dict[str, str]]:   return _csv_load("mandi_prices.csv")


def _crop_by_id() -> Dict[str, Dict[str, str]]:
    return {c["crop_id"].lower(): c for c in _crops()}


def _crop_by_name() -> Dict[str, Dict[str, str]]:
    return {c["crop_name"].lower(): c for c in _crops()}


def _regions() -> List[str]:
    return sorted({r["region_id"] for r in _soil()})



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
def _find_crop(text: str) -> Optional[Dict[str, str]]:
    t = text.lower()
    # Prefer longer names first (e.g. "black gram" before "gram")
    for name, row in sorted(_crop_by_name().items(), key=lambda kv: -len(kv[0])):
        if name in t:
            return row
    for cid, row in sorted(_crop_by_id().items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"\b{re.escape(cid)}\b", t):
            return row
    # Native-script / Hinglish crop name (चावल, వరి, ಅಕ್ಕಿ, "chawal", ...)
    native_cid = find_crop_id(text)
    if native_cid:
        cbi = _crop_by_id()
        if native_cid in cbi:
            return cbi[native_cid]
    return None


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
        # also allow matching just the district part: "medak" -> telangana_medak
        district = rid.split("_", 1)[-1]
        if district and re.search(rf"\b{re.escape(district)}\b", normalized.lower()):
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


def _find_numbers(text: str) -> List[float]:
    nums = []
    for m in _NUM_RE.finditer(text):
        try:
            nums.append(float(m.group(1).replace(",", "")))
        except ValueError:
            pass
    return nums


def _fmt_inr(v: float) -> str:
    return f"₹{v:,.0f}"


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
    pretty = ", ".join(r.replace("_", " · ").title() for r in regs)
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
            f"- **{r.get('crop_id','?')}** @ {r.get('region_id','?')} "
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


def _intent_recommend(region: Optional[str], season: Optional[str], nums: List[float], lang: str) -> Reply:
    if not region:
        if lang == "en":
            return (
                "Tell me the **region** (e.g. _Telangana Medak_ or _MP Sehore_) "
                "and I'll recommend the best crops.",
                ["List regions", "Recommend for Telangana Medak in Kharif"],
            )
        return T(lang, "recommend_need_region"), [T(lang, "sug_list_regions"), T(lang, "sug_recommend_medak_kharif")]
    season = season or "kharif"
    budget = nums[0] if nums else 15000.0
    area = nums[1] if len(nums) > 1 else 3.0
    try:
        recs = recommend_crops(region_id=region, season=season, budget_per_acre=budget, area_acres=area)
    except Exception as e:
        return (f"Sorry, I couldn't compute recommendations: {e}" if lang == "en"
                else T(lang, "generic_error", err=e)), []
    if not recs:
        if lang == "en":
            return f"No strong recommendations for {region} in {season}.", []
        return T(lang, "recommend_no_strong", region=region, season=season), []
    region_disp = region.replace('_', ' · ').title()
    if lang == "en":
        lines = [
            f"Top crops for **{region_disp}** in **{season.title()}** "
            f"(budget {_fmt_inr(budget)}/acre, {area} acres):\n"
        ]
        for i, r in enumerate(recs[:5], 1):
            lines.append(
                f"{i}. **{r.get('crop_name')}** — "
                f"profit {_fmt_inr(r.get('expected_profit',0))}, "
                f"ROI {r.get('roi_percent',0)}%, risk {r.get('risk_score',0)}/10"
            )
        return "\n".join(lines), [
            "Open dashboard",
            f"Rotation plan for {region}",
            f"Pest alerts for {recs[0].get('crop_id')}",
        ]
    lines = [T(lang, "recommend_header", region=region_disp, season=season.title(),
                budget=_fmt_inr(budget), area=area)]
    for i, r in enumerate(recs[:5], 1):
        lines.append(T(
            lang, "recommend_line", i=i, name=r.get("crop_name"),
            profit=_fmt_inr(r.get("expected_profit", 0)),
            roi=r.get("roi_percent", 0), risk=r.get("risk_score", 0),
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


def _intent_sell_advice(crop: Dict[str, str], region: Optional[str], lang: str) -> Reply:
    if not region:
        if lang == "en":
            return "Which region? e.g. _\"best time to sell cotton in Maharashtra Yavatmal\"_.", []
        return T(lang, "sell_need_region"), []
    try:
        res = best_time_to_sell(region, crop["crop_id"])
    except Exception as e:
        return (f"Couldn't compute sell advice: {e}" if lang == "en" else T(lang, "sell_error", err=e)), []
    rtxt = region.replace("_", " · ").title()
    if lang == "en":
        lines = [f"### Sell advice — {crop['crop_name']} @ {rtxt}\n"]
        if isinstance(res, dict):
            if "advice" in res:
                lines.append(f"**Advice:** {res['advice']}\n")
            if "best_month" in res:
                lines.append(f"- **Best month to sell:** Month {res['best_month']}")
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


def _intent_pest(crop: Dict[str, str], lang: str) -> Reply:
    try:
        alerts = pest_disease_alerts(crop["crop_id"], {"avg_temp_c": 28, "rainfall_mm": 800})
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


def _intent_irrigation(crop: Dict[str, str], lang: str) -> Reply:
    try:
        sch = irrigation_schedule(crop["crop_id"], "2025-06-15", 800, 0.5)
    except Exception as e:
        return (f"Couldn't build schedule: {e}" if lang == "en" else T(lang, "generic_error", err=e)), []
    weeks = sch.get("weekly_schedule", []) if isinstance(sch, dict) else []
    if lang == "en":
        lines = [f"### Irrigation schedule — {crop['crop_name']}", "_Sown 15 Jun · 800 mm seasonal rainfall_\n"]
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
    lines = [T(lang, "irrigation_header", crop=crop["crop_name"]), T(lang, "irrigation_sub")]
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


def _intent_schemes(crop: Optional[Dict[str, str]], region: Optional[str], nums: List[float], lang: str) -> Reply:
    area = nums[0] if nums else 3.0
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
            benefit = s.get("benefit_value") or s.get("benefit", "")
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
        benefit = s.get("benefit_value") or s.get("benefit", "")
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


def _intent_loan(nums: List[float], lang: str) -> Reply:
    if len(nums) < 2:
        if lang == "en":
            return (
                "Tell me the **total cost** and **expected profit**, e.g. "
                "_\"loan for cost 80000 profit 120000\"_.",
                [],
            )
        return T(lang, "loan_need_input"), []
    try:
        res = loan_calculator(total_cost=nums[0], expected_profit=nums[1])
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
    rtxt = region.replace('_', ' · ').title()
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
}


def _build_actions(intent: str, crop: Optional[Dict[str, str]], region: Optional[str],
                   season: Optional[str], nums: List[float]) -> List[Dict[str, str]]:
    """Build deep-link buttons into the dashboard for the given intent."""
    acts: List[Dict[str, str]] = []
    if intent == "recommend":
        budget = nums[0] if nums else 15000
        area = nums[1] if len(nums) > 1 else 3
        acts.append(_action(
            "Open in dashboard →",
            _dashboard_link("recommend", region_id=region, season=season or "kharif",
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
                            _dashboard_link("pests", crop_id=crop["crop_id"])))
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
    if raw.startswith("/"):
        token = raw.split(None, 1)[0].lower()
        rest = raw[len(token):].strip()
        expansion = _SLASH_ALIASES.get(token)
        if expansion:
            raw = f"{expansion} {rest}".strip()

    text = raw.lower()

    # Language: an explicit context value (set by a prior turn, or passed by
    # the frontend from its own i18n.js language choice) wins; otherwise
    # detect from script/Hinglish cues in this message. A short English-script
    # follow-up ("MSP?") after a Hindi conversation keeps the remembered
    # language rather than bouncing back to English.
    lang = context.get("lang") or detect_lang(raw)

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

    # Greetings
    is_greeting = (
        any(re.search(rf"\b{g}\b", text) for g in GREETINGS)
        or any(g in raw for g in sum(GREETING_WORDS.values(), []))
    )
    if is_greeting and len(text.split()) <= 4:
        reply, sug = _intent_greeting(lang)
        return _pack(reply, sug)

    # Help / capabilities
    if _matches("help", text, r"\b(help|what can you do|features?|capabilit|about (the )?site|what is this)\b"):
        reply, sug = _intent_help(lang)
        return _pack(reply, sug)

    # Lists
    if _matches("list_crops", text, r"\blist (of )?(all )?crops\b|\bwhich crops\b|\bavailable crops\b"):
        reply, sug = _intent_list_crops(lang)
        return _pack(reply, sug)
    if _matches("list_regions", text, r"\blist (of )?(all )?regions\b|\bwhich regions\b|\bavailable regions\b|\bregions you (have|support)\b"):
        reply, sug = _intent_list_regions(lang)
        return _pack(reply, sug)

    crop = _find_crop(text)
    region = _find_region(raw) or context.get("region_id")
    season = _find_season(text) or context.get("season")
    nums = _find_numbers(text)
    # Fall back to remembered crop when the user asks a short follow-up like "its MSP?"
    if not crop and context.get("crop_id"):
        _cbi = _crop_by_id()
        if context["crop_id"] in _cbi:
            crop = _cbi[context["crop_id"]]

    # MSP vs market
    if crop and _matches("msp_vs_market", text, r"msp\s*(vs|versus|compared)\s*(mandi|market)"):
        reply, sug = _intent_msp_vs_market(crop, region, lang)
        return _pack(reply, sug, "forecast", crop, region, season, nums)

    # Plain MSP
    if _matches("msp", text, r"\bmsp\b|\bminimum support price\b"):
        reply, sug = _intent_msp(crop, lang)
        return _pack(reply, sug, crop=crop, region=region)

    # Recommend
    if _matches("recommend", text, r"\brecommend(ation)?\b|\bsuggest(ion)?\b|\bwhich crop\b|\bbest crop\b|\bwhat (should|to) (i )?(grow|plant|sow)\b"):
        reply, sug = _intent_recommend(region, season, nums, lang)
        return _pack(reply, sug, "recommend", region=region, season=season, nums=nums)

    # Sell timing
    if crop and _matches("sell_advice", text, r"\bbest time to sell\b|\bwhen (should|to) (i )?sell\b|\bsell(ing)? advice\b"):
        reply, sug = _intent_sell_advice(crop, region, lang)
        return _pack(reply, sug, "forecast", crop, region)

    # Mandi prices
    if _matches("mandi_price", text, r"\bmandi\b|\bmarket price\b|\bprice of\b|\bprice in\b|\bprices?\b") and (crop or region):
        reply, sug = _intent_mandi_price(crop, region, lang)
        return _pack(reply, sug, "forecast", crop, region)

    # Pest / disease
    if crop and _matches("pest", text, r"\bpest\b|\bdisease\b|\binsect\b|\bfung"):
        reply, sug = _intent_pest(crop, lang)
        return _pack(reply, sug, "pest", crop, region)

    # Irrigation
    if crop and _matches("irrigation", text, r"\birrigat|\bwater(ing)?\b"):
        reply, sug = _intent_irrigation(crop, lang)
        return _pack(reply, sug, "irrigate", crop, region)

    # Calendar
    if crop and _matches("calendar", text, r"\bcalendar\b|\bsowing\b|\bsow(ing)? date\b|\bharvest(ing)? date\b"):
        reply, sug = _intent_calendar(crop, lang)
        return _pack(reply, sug, crop=crop, region=region)

    # Schemes
    if _matches("schemes", text, r"\bscheme|\bsubsidy|\bsubsidies|\bpm[- ]?kisan\b|\bgovernment\b|\bloan waiver\b|\binsurance\b"):
        reply, sug = _intent_schemes(crop, region, nums, lang)
        return _pack(reply, sug, "schemes", crop, region)

    # Loan
    if _matches("loan", text, r"\bloan\b|\bemi\b|\binterest\b"):
        reply, sug = _intent_loan(nums, lang)
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
            "`/recommend`, `/msp`, `/mandi`, `/pest`, `/sell`, `/schemes`."
        )
        sug = ["Help", "Recommend crops for Telangana Medak", "MSP of wheat", "Pest alerts for rice"]
    else:
        fallback = T(lang, "fallback")
        sug = [T(lang, "sug_help2"), T(lang, "sug_recommend_medak2"), T(lang, "sug_msp_wheat3"), T(lang, "sug_pest_rice2")]
    return _pack(fallback, sug)
