import json
import os
import re
from typing import Dict, Any

try:
    import google.generativeai as genai
except ImportError:
    genai = None

def fetch_dynamic_crop_calendar(crop_id: str, season: str = None) -> Dict[str, Any]:
    """
    Uses Google Gemini API to dynamically generate an agronomic crop calendar.
    Requires GEMINI_API_KEY to be set in the environment.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key or not genai:
        raise RuntimeError("GEMINI_API_KEY not found or google-generativeai not installed.")
        
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-pro")
    
    season_text = f"focus specifically on the '{season}' season" if season else "provide all primary growing seasons (kharif, rabi, and/or annual)"
    
    prompt = f"""
    Act as an expert agronomist for India. Generate a highly detailed, realistic crop calendar for the crop '{crop_id}'.
    {season_text}.
    
    Return the response as a valid JSON object matching this schema EXACTLY:
    {{
        "kharif": {{
            "land_prep": "Month Day - Month Day",
            "sowing_transplant": "...",
            "first_fertilizer": "...",
            "second_fertilizer": "...",
            "third_fertilizer": "...",
            "critical_irrigation": "...",
            "pest_watch": "...",
            "harvest_window": "...",
            "duration_days": 100
        }}
    }}
    * If the season is rabi, use "rabi" as the key. If annual, use "annual". 
    * Do not include the crop_id in the JSON root, just the season names as keys.
    * Output ONLY the raw JSON string, without markdown formatting like ```json.
    """
    
    response = model.generate_content(prompt)
    text = response.text.strip()
    
    # Strip markdown code blocks if the LLM adds them
    text = re.sub(r"^```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    
    try:
        calendars = json.loads(text.strip())
        return calendars
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse LLM response as JSON: {text}") from e
