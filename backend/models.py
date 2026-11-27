from datetime import date
from pydantic import BaseModel, Field, field_validator
from typing import Annotated, Dict, Any, List, Optional

# Upper bounds shared by every request model (defect N-8: 1e9 acres at
# Rs 1e12/acre used to return 200 with a profit of -1e21). Same limits as
# backend/season_routes.py.
MAX_AREA_ACRES = 100_000
MAX_BUDGET_PER_ACRE = 10_000_000


# Size bounds on free-form fields (Phase 3.4). Ids are short slugs ("mp_sehore",
# "kharif"); soil and weather dicts carry a few dozen numbers. Generous, so no real
# client is refused, but an oversized payload is a 422 before any engine runs.
Id = Annotated[str, Field(max_length=100)]
DateText = Annotated[str, Field(max_length=32)]
MAX_DICT_KEYS = 100


def _check_area(v: float) -> float:
    if v <= 0:
        raise ValueError("area_acres must be greater than 0")
    if v > MAX_AREA_ACRES:
        raise ValueError(f"area_acres must not exceed {MAX_AREA_ACRES:,}")
    return v


def _check_budget(v: float) -> float:
    if v <= 0:
        raise ValueError("budget_per_acre must be greater than 0")
    if v > MAX_BUDGET_PER_ACRE:
        raise ValueError(f"budget_per_acre must not exceed {MAX_BUDGET_PER_ACRE:,}")
    return v


def _check_area_or_budget(v: float, field_name: str) -> float:
    return _check_budget(v) if "budget" in field_name else _check_area(v)


def parse_sowing_date(v: Optional[str]) -> Optional[str]:
    """Accept YYYY-MM-DD only; '2026-13-45' is a 422, not a silent default (N-17)."""
    if v is None or v == "":
        return None
    try:
        return date.fromisoformat(str(v)).isoformat()
    except ValueError as exc:
        raise ValueError("sowing_date must be a real date in YYYY-MM-DD format") from exc
class SimulationRequest(BaseModel):
    crop_id: Id
    area_acres: float
    region_id: Id
    mandi_price_per_kg: float
    irrigation_level: Optional[float] = 0.5
    seed_variety: Optional[Id] = "standard"
    sowing_date: Optional[DateText] = "2024-06-15"
    soil: Dict[str, Any] = Field(..., max_length=MAX_DICT_KEYS)
    weather: Dict[str, Any] = Field(..., max_length=MAX_DICT_KEYS)
    input_plan: Optional[Dict[str, float]] = Field(default_factory=dict, max_length=MAX_DICT_KEYS)

    @field_validator("area_acres")
    @classmethod
    def area_must_be_positive(cls, v: float) -> float:
        return _check_area(v)

    @field_validator("sowing_date")
    @classmethod
    def sowing_date_is_a_date(cls, v: Optional[str]) -> Optional[str]:
        return parse_sowing_date(v)

    @field_validator("mandi_price_per_kg")
    @classmethod
    def price_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("mandi_price_per_kg must be greater than 0")
        return v

    @field_validator("irrigation_level")
    @classmethod
    def irrigation_in_range(cls, v: float | None) -> float | None:
        if v is not None and not (0.0 <= v <= 1.0):
            raise ValueError("irrigation_level must be between 0 and 1")
        return v

class RecommendationRequest(BaseModel):
    region_id: Id
    season: Id
    budget_per_acre: float
    area_acres: float

    @field_validator("budget_per_acre", "area_acres")
    @classmethod
    def must_be_positive(cls, v: float, info) -> float:
        return _check_area_or_budget(v, info.field_name)

class CommitmentRequest(BaseModel):
    region_id: Id
    crop_id: Id
    season: Id
    area_acres: float
    device_id: Id

    @field_validator("area_acres")
    @classmethod
    def area_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("area_acres must be greater than 0")
        if v > 10000:
            raise ValueError("area_acres must not exceed 10,000 acres for a single commitment")
        return v

class CompareRequest(BaseModel):
    strategies: List[SimulationRequest] = Field(..., max_length=20)

    @field_validator("strategies")
    @classmethod
    def must_not_be_empty(cls, v: List[SimulationRequest]) -> List[SimulationRequest]:
        if not v:
            raise ValueError("strategies list cannot be empty")
        return v

class RotationRequest(BaseModel):
    region_id: Id
    budget_per_acre: float
    area_acres: float

    @field_validator("budget_per_acre", "area_acres")
    @classmethod
    def must_be_positive_rot(cls, v: float, info) -> float:
        return _check_area_or_budget(v, info.field_name)

class BatchSimRequest(BaseModel):
    crop_ids: List[Id] = Field(..., max_length=100)
    area_acres: float
    region_id: Id
    budget_per_acre: float
    irrigation_level: Optional[float] = 0.5
    seed_variety: Optional[Id] = "standard"
    sowing_date: Optional[DateText] = "2024-06-15"
    soil: Dict[str, Any] = Field(..., max_length=MAX_DICT_KEYS)
    weather: Dict[str, Any] = Field(..., max_length=MAX_DICT_KEYS)

    @field_validator("crop_ids")
    @classmethod
    def crop_ids_not_empty(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("crop_ids list cannot be empty")
        return v

    @field_validator("area_acres", "budget_per_acre")
    @classmethod
    def batch_must_be_positive(cls, v: float, info) -> float:
        return _check_area_or_budget(v, info.field_name)

    @field_validator("sowing_date")
    @classmethod
    def batch_sowing_date_is_a_date(cls, v: Optional[str]) -> Optional[str]:
        return parse_sowing_date(v)


class CropMixRequest(BaseModel):
    region_id: Id
    season: Id
    total_area_acres: float
    total_budget: float
    # Accepted for backward compatibility with older clients; the allocation
    # reads the region's own soil/weather through recommend_crops().
    soil: Optional[Dict[str, Any]] = Field(None, max_length=MAX_DICT_KEYS)
    weather: Optional[Dict[str, Any]] = Field(None, max_length=MAX_DICT_KEYS)

    @field_validator("total_area_acres", "total_budget")
    @classmethod
    def must_be_positive_mix(cls, v: float, info) -> float:
        if v <= 0:
            raise ValueError(f"{info.field_name} must be greater than 0")
        if info.field_name == "total_area_acres":
            return _check_area(v)
        if v > MAX_BUDGET_PER_ACRE * MAX_AREA_ACRES:
            raise ValueError("total_budget is too large")
        return v

class LoanRequest(BaseModel):
    total_cost: float = Field(gt=0)
    expected_profit: float
    loan_amount: Optional[float] = Field(None, gt=0)
    interest_rate_annual: Optional[float] = Field(4.0, ge=0, le=100)
    tenure_months: Optional[int] = Field(12, ge=1, le=360)

class DiseasePredictQuery(BaseModel):
    image_b64: str = Field(..., max_length=10_000_000, description="Base64 encoded crop leaf image (JPEG or PNG, max 10MB)")
    crop_id: Optional[str] = Field(None, max_length=100, description="Crop identifier, e.g., 'tomato'")
    region_id: Optional[str] = Field(None, max_length=100, description="Region identifier, e.g., 'up_lucknow'")
    area_acres: Optional[float] = Field(1.0, gt=0, le=100_000, description="Affected plot area, used to scale treatment quantity and cost")


class SoilProjectionRequest(BaseModel):
    current_soil: Dict[str, Any] = Field(..., max_length=MAX_DICT_KEYS)
    rotation: List[Annotated[Dict[str, Id], Field(max_length=10)]] = Field(..., max_length=20)
    # The projection loops years x rotation steps; an unbounded years kept a
    # function busy until its timeout.
    years: Optional[int] = Field(5, ge=1, le=50)
    apply_fertilizer: Optional[bool] = True

class ExpenseLogRequest(BaseModel):
    farm_id: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0, le=10_000_000)
    date: Optional[str] = Field(None, max_length=10)
    note: Optional[str] = Field("", max_length=1_000)

class BenchmarkRequest(BaseModel):
    region_id: Id
    crop_id: Id
    user_yield_kg_per_acre: float
    user_profit_per_acre: float

# --- New Flagship Feature Request Models ---
class NDVIQuery(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    crop_id: Optional[Id] = "wheat"
    area_acres: Optional[float] = Field(4.0, gt=0, le=100_000)

class FarmScoreQuery(BaseModel):
    region_id: Id
    season: Id
    budget_per_acre: float = Field(gt=0, le=MAX_BUDGET_PER_ACRE)
    area_acres: float = Field(gt=0, le=MAX_AREA_ACRES)
    crop_id: Optional[Id] = None
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)


class ClimateAlertQuery(BaseModel):
    crop_id: Id = "wheat"
    region_id: Optional[Id] = "mp_sehore"
    weather: Optional[Dict[str, float]] = Field(None, max_length=MAX_DICT_KEYS)

class CarbonCreditQuery(BaseModel):
    crop_id: Id = "wheat"
    area_acres: float = Field(4.0, gt=0, le=100_000)
    tillage_practice: Optional[Id] = "no_till"  # 'conventional', 'reduced_till', 'no_till'
    cover_crop: Optional[bool] = True
    biochar_application: Optional[bool] = False

class IoTTelemetryQuery(BaseModel):
    farm_id: Optional[str] = Field("farm_01", min_length=1, max_length=100)
    region_id: Optional[str] = Field(None, max_length=100)
    # Uploaded readings are only merged in for the device that uploaded them.
    device_id: Optional[str] = Field(None, min_length=1, max_length=100)

class SensorUploadRequest(BaseModel):
    region_id: str = Field(..., min_length=1, max_length=100)
    # Required: readings are scoped to the uploading device, so an upload
    # without one would land in a bucket every anonymous caller shares.
    device_id: str = Field(..., min_length=1, max_length=100)
    filename: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1, max_length=2_000_000)

class IoTTriggerRequest(BaseModel):
    farm_id: Optional[str] = Field("farm_01", min_length=1, max_length=100)
    target_moisture_pct: Optional[float] = Field(65.0, ge=0, le=100)
    current_moisture_pct: Optional[float] = Field(40.0, ge=0, le=100)
    area_acres: Optional[float] = Field(4.0, gt=0, le=100_000)
    flow_rate_lpm: Optional[float] = Field(120.0, gt=0, le=100_000)
    # Depth of soil the crop draws water from: ~15-30 cm for vegetables and
    # rice, 30-60 cm for most field crops, deeper for sugarcane and orchards.
    root_zone_depth_cm: Optional[float] = Field(30.0, ge=5, le=150)


class CropRecQuery(BaseModel):
    region_id: Id
    season: Id
    budget_per_acre: float = Field(..., gt=0, le=MAX_BUDGET_PER_ACRE, description="Financial budget constraint per acre in INR")
    area_acres: float = Field(..., gt=0, le=MAX_AREA_ACRES, description="Total farm area size in acres")

class YieldPredQuery(BaseModel):
    crop_id: Id
    region_id: Id
    season: Id
    irrigation_level: Optional[float] = Field(0.5, ge=0.0, le=1.0, description="Irrigation level multiplier (0.0 to 1.0)")

class ProfitEstRequest(BaseModel):
    crop_id: Id
    predicted_yield_kg_per_acre: float = Field(..., ge=0, description="Predicted yield volume in kg per acre")
    area_acres: float = Field(..., gt=0, le=MAX_AREA_ACRES, description="Total farm area size in acres")
    budget_per_acre: float = Field(..., gt=0, le=MAX_BUDGET_PER_ACRE, description="Allocated budget limit per acre in INR")
    mandi_price_per_kg: Optional[float] = Field(None, ge=0, description="Current market price per kg in INR")

class IrrigationQuery(BaseModel):
    crop_id: Id
    # Query-parameter model (used with Depends()), so the format check is a
    # Field pattern FastAPI turns into a 422; the route checks it is a real date.
    sowing_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Sowing date in YYYY-MM-DD format; defaults to the crop's calendar sowing date for the current or next season")
    rainfall_mm: Optional[float] = Field(800, ge=0, description="Seasonal cumulative rainfall in mm")
    irrigation_level: Optional[float] = Field(0.5, ge=0.0, le=1.0, description="Irrigation level multiplier (0.0 to 1.0)")

class FertilizerQuery(BaseModel):
    crop_id: Id
    n_kg_per_acre: float = Field(..., ge=0, description="Current soil Nitrogen content in kg per acre")
    p_kg_per_acre: float = Field(..., ge=0, description="Current soil Phosphorus content in kg per acre")
    k_kg_per_acre: float = Field(..., ge=0, description="Current soil Potassium content in kg per acre")


class UsageCollectRequest(BaseModel):
    """Anonymous event counts, e.g. {"tool_open_recommend": 3}.

    Deliberately has no identifier field of any kind — no user id, session id or
    timestamp — so two submissions can never be tied to the same person.
    Event names are validated against a strict pattern in utils/usage_store.
    """
    counts: Dict[str, int] = Field(default_factory=dict, max_length=60)

