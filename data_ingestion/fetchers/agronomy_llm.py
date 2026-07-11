"""
data_ingestion/fetchers/agronomy_llm.py
Uses Gemini 1.5 Pro to dynamically generate agricultural reference data,
replacing hardcoded databases in the engine.
"""

import json
import os
import google.generativeai as genai

def _get_model():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel('gemini-1.5-pro')

def _parse_json_response(response_text: str) -> dict | list:
    """Safely extracts JSON from the LLM response."""
    text = response_text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())


def fetch_fertilizer_db() -> list[dict]:
    """Dynamically generates a database of common Indian fertilizers."""
    model = _get_model()
    if not model:
        return [
            {"name": "Urea", "grade": "46-0-0", "n_pct": 46, "p_pct": 0, "k_pct": 0, "cost_per_kg": 6.0},
            {"name": "DAP", "grade": "18-46-0", "n_pct": 18, "p_pct": 46, "k_pct": 0, "cost_per_kg": 25.0},
            {"name": "MOP", "grade": "0-0-60", "n_pct": 0, "p_pct": 0, "k_pct": 60, "cost_per_kg": 28.0}
        ]
    prompt = """
    Act as an expert Indian agronomist. 
    Provide a JSON list of exactly 6-8 common commercial fertilizers used in India.
    Include Urea, DAP, MOP, SSP, NPK Complexes, and Ammonium Sulphate.

    For each, provide:
    - name: String (e.g., "Urea")
    - grade: String (e.g., "46-0-0")
    - n_pct: Float (Nitrogen percentage)
    - p_pct: Float (Phosphorus percentage)
    - k_pct: Float (Potassium percentage)
    - cost_per_kg: Float (Estimated current cost in INR per kg)

    Output purely a JSON array of objects. Do not include markdown formatting or explanations.
    """
    response = model.generate_content(prompt)
    return _parse_json_response(response.text)


def fetch_irrigation_constants(crop_id: str) -> dict:
    """Dynamically fetches crop duration and critical water stages."""
    model = _get_model()
    if not model:
        return {
            "duration_days": 120,
            "water_stages": [
                [0.0, 0.2, 0.8, "Early"],
                [0.2, 0.6, 1.2, "Mid"],
                [0.6, 1.0, 0.6, "Late"]
            ]
        }
    prompt = f"""
    Act as an expert agronomist. I need the irrigation schedule constants for '{crop_id}'.
    Provide a JSON object with exactly two keys:
    1. "duration_days": Integer (typical total crop cycle duration in days).
    2. "water_stages": A list of lists, representing critical water demand stages. 
       Each inner list must have exactly 4 elements:
       [start_fraction, end_fraction, water_multiplier, stage_name]
       
       Example format for wheat:
       [
           [0.0, 0.15, 0.8, "Crown Root Initiation"],
           [0.15, 0.35, 1.0, "Tillering"],
           [0.35, 0.6, 1.4, "Heading/Flowering"],
           [0.6, 0.85, 1.2, "Grain Fill"],
           [0.85, 1.0, 0.5, "Maturity"]
       ]
       The fractions must cover 0.0 to 1.0 seamlessly.

    Output purely a JSON object. Do not include markdown formatting or explanations.
    """
    response = model.generate_content(prompt)
    return _parse_json_response(response.text)


def fetch_nutrient_impact(crop_id: str) -> dict:
    """Dynamically fetches soil NPK nutrient impact per acre for a crop."""
    model = _get_model()
    if not model:
        return {"n": -20, "p": -10, "k": -15}
    prompt = f"""
    Act as an expert agronomist. I need the typical soil nutrient depletion or fixation per acre for '{crop_id}'.
    Provide a JSON object representing how many kg per acre of N, P, and K the crop typically removes from (or adds to) the soil.
    Negative numbers mean depletion. Positive numbers mean fixation (e.g. legumes fixing Nitrogen).

    Example format for maize:
    {{"n": -28, "p": -12, "k": -15}}

    Output purely a JSON object with keys "n", "p", and "k" (all numbers). Do not include markdown formatting or explanations.
    """
    response = model.generate_content(prompt)
    return _parse_json_response(response.text)


def fetch_strategy_templates() -> list[dict]:
    """Dynamically generates farming strategy templates."""
    model = _get_model()
    if not model:
        return [
            {
                "template_id": "fallback_1",
                "name": "Standard Mock Strategy",
                "description": "Mock strategy since API key is missing.",
                "profile": "small",
                "config": {
                    "crop_id": "rice",
                    "area_acres": 2.0,
                    "season": "kharif",
                    "irrigation_level": 1.0,
                    "seed_variety": "Standard",
                    "budget_per_acre": 15000,
                    "sowing_date": "2025-06-15"
                }
            }
        ]
    prompt = """
    Act as an expert Indian agricultural economist.
    Generate a JSON list of exactly 6 diverse farming strategy profiles.
    Cover different scenarios: small holders, large commercial farmers, organic farming, rainfed vs irrigated, different crops, different seasons.

    Each object must strictly have this structure:
    {
        "template_id": "unique_string_id",
        "name": "Human readable name",
        "description": "Brief description of the strategy",
        "profile": "Target farmer profile string",
        "config": {
            "crop_id": "string (e.g. rice, wheat, cotton, pulses)",
            "area_acres": float,
            "season": "string (e.g. kharif, rabi, annual)",
            "irrigation_level": float (0.1 to 1.0),
            "seed_variety": "string",
            "budget_per_acre": float,
            "sowing_date": "YYYY-MM-DD"
        }
    }

    Output purely a JSON array of objects. Do not include markdown formatting or explanations.
    """
    response = model.generate_content(prompt)
    return _parse_json_response(response.text)
