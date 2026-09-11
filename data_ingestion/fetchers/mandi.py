from __future__ import annotations

import csv
import logging
import os
import threading
import time
from pathlib import Path

from data_ingestion.cache import cached
from data_ingestion.fetchers.agmarknet import fetch_mandi_records

_DATASET_DIR = Path(__file__).resolve().parents[2] / "dataset"
_FALLBACK_CSV = _DATASET_DIR / "mandi_prices.csv"

# Records how the most recent price lookup was actually resolved, so the
# /api/data-freshness endpoint can tell the user whether they are looking at
# live Agmarknet numbers or the seed CSV. Purely observational — nothing in the
# pricing path reads it back.
_LAST_RESOLUTION: dict[str, object] = {
    "mode": None,        # "live" | "seed" | None (never queried this process)
    "at": None,          # epoch seconds of the last resolution
    "live_ok_at": None,  # epoch seconds of the last *successful* live fetch
    "live_error": None,  # short reason string for the last live failure
}
_RESOLUTION_LOCK = threading.Lock()


def _record(mode: str | None, live_error: str | None = None) -> None:
    with _RESOLUTION_LOCK:
        now = time.time()
        if mode is not None:
            _LAST_RESOLUTION["mode"] = mode
            _LAST_RESOLUTION["at"] = now
        if mode == "live":
            _LAST_RESOLUTION["live_ok_at"] = now
            _LAST_RESOLUTION["live_error"] = None
        elif live_error is not None:
            _LAST_RESOLUTION["live_error"] = live_error


def last_resolution() -> dict[str, object]:
    """Snapshot of how the last mandi price was resolved (live vs seed CSV)."""
    with _RESOLUTION_LOCK:
        return dict(_LAST_RESOLUTION)

# Crop name mapping for data.gov.in commodity filter
_CROP_COMMODITY: dict[str, str] = {
    "rice": "Rice",
    "wheat": "Wheat",
    "maize": "Maize",
    "sugarcane": "Sugarcane",
    "cotton": "Cotton",
    "pulses": "Tur",
    "groundnut": "Groundnut",
    "soybean": "Soybean",
}

logger = logging.getLogger(__name__)


@cached(ttl_seconds=3600, key="mandi_price")  # 1-hour TTL; prices update a few times/day
def fetch_mandi_price(crop_id: str, state: str | None = None) -> float | None:
    """
    Fetch latest mandi price (INR/kg) for a crop from data.gov.in (Agmarknet),
    via the shared AgmarknetClient in data_ingestion/fetchers/agmarknet.py.
    Returns None if API is unavailable or key is missing; caller should use fallback.
    API key is read from the DATAGOV_API_KEY environment variable.
    """
    api_key = os.getenv("DATAGOV_API_KEY")
    if not api_key:
        logger.info("DATAGOV_API_KEY not found; skipping live mandi price fetch.")
        _record(None, live_error="DATAGOV_API_KEY is not set")
        return None

    commodity = _CROP_COMMODITY.get(crop_id)
    if not commodity:
        logger.warning(f"No commodity mapping for crop_id='{crop_id}'; cannot fetch live price.")
        _record(None, live_error=f"no data.gov.in commodity mapping for '{crop_id}'")
        return None

    try:
        records = fetch_mandi_records(commodity, state)
    except Exception as e:
        logger.error(f"Unexpected error fetching mandi price for {crop_id}: {e}")
        _record(None, live_error=f"{e.__class__.__name__}: {e}")
        return None

    if not records:
        logger.info(f"No recent mandi records found for {commodity}.")
        _record(None, live_error=f"no recent data.gov.in records for {commodity}")
        return None

    # Modal price is the most representative; convert quintal → kg (÷100)
    prices = [float(r["Modal_Price"]) / 100 for r in records if r.get("Modal_Price")]
    if not prices:
        _record(None, live_error=f"data.gov.in records for {commodity} carried no modal price")
        return None
    return round(sum(prices) / len(prices), 2)


def get_mandi_price(crop_id: str, region_id: str, state: str | None = None) -> float:
    """
    Returns mandi price for a crop. Tries live API first, falls back to CSV.
    """
    # _record() is called here rather than inside fetch_mandi_price() because
    # that function is @cached — a cache hit never runs its body.
    try:
        live = fetch_mandi_price(crop_id, state)
        if live is not None:
            _record("live")
            return live
    except Exception as e:
        logger.warning(f"Failed to get live mandi price for {crop_id}: {e}")
        _record(None, live_error=f"{e.__class__.__name__}: {e}")

    # Fallback: read from static CSV
    try:
        if _FALLBACK_CSV.exists():
            with _FALLBACK_CSV.open("r", newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    if row["crop_id"] == crop_id and row["region_id"] == region_id:
                        _record("seed")
                        return float(row["price_inr_per_kg"])
    except Exception as e:
        logger.error(f"Error reading mandi fallback CSV: {e}")

    raise ValueError(f"No mandi price available for crop='{crop_id}' region='{region_id}'")
