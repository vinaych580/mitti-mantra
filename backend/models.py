from pydantic import BaseModel, Field, field_validator
from typing import Dict, Any, List, Optional
class SimulationRequest(BaseModel):
    crop_id: str
    area_acres: float
    region_id: str
    mandi_price_per_kg: float
    irrigation_level: Optional[float] = 0.5
    seed_variety: Optional[str] = "standard"
    sowing_date: Optional[str] = "2024-06-15"
    soil: Dict[str, Any]
    weather: Dict[str, Any]
    input_plan: Optional[Dict[str, float]] = Field(default_factory=dict)

    @field_validator("area_acres")
    @classmethod
    def area_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("area_acres must be greater than 0")
        return v

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
    region_id: str
    season: str
    budget_per_acre: float
    area_acres: float

    @field_validator("budget_per_acre", "area_acres")
    @classmethod
    def must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Value must be greater than 0")
        return v

class CommitmentRequest(BaseModel):
    region_id: str
    crop_id: str
    season: str
    area_acres: float
    device_id: str

    @field_validator("area_acres")
    @classmethod
    def area_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("area_acres must be greater than 0")
        if v > 10000:
            raise ValueError("area_acres must not exceed 10,000 acres for a single commitment")
        return v

class CompareRequest(BaseModel):
    strategies: List[SimulationRequest]

    @field_validator("strategies")
    @classmethod
    def must_not_be_empty(cls, v: List[SimulationRequest]) -> List[SimulationRequest]:
        if not v:
            raise ValueError("strategies list cannot be empty")
        return v

class RotationRequest(BaseModel):
    region_id: str
    budget_per_acre: float
    area_acres: float

    @field_validator("budget_per_acre", "area_acres")
    @classmethod
    def must_be_positive_rot(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Value must be greater than 0")
        return v

class BatchSimRequest(BaseModel):
    crop_ids: List[str]
    area_acres: float
    region_id: str
    budget_per_acre: float
    irrigation_level: Optional[float] = 0.5
    seed_variety: Optional[str] = "standard"
    sowing_date: Optional[str] = "2024-06-15"
    soil: Dict[str, Any]
    weather: Dict[str, Any]

    @field_validator("crop_ids")
    @classmethod
    def crop_ids_not_empty(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("crop_ids list cannot be empty")
        return v

    @field_validator("area_acres", "budget_per_acre")
    @classmethod
    def batch_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Value must be greater than 0")
        return v


class CropMixRequest(BaseModel):
    region_id: str
    season: str
    total_area_acres: float
    total_budget: float
    soil: Dict[str, Any]
    weather: Dict[str, Any]

    @field_validator("total_area_acres", "total_budget")
    @classmethod
    def must_be_positive_mix(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Value must be greater than 0")
        return v

class LoanRequest(BaseModel):
    total_cost: float = Field(gt=0)
    expected_profit: float
    loan_amount: Optional[float] = Field(None, gt=0)
    interest_rate_annual: Optional[float] = Field(4.0, ge=0, le=100)
    tenure_months: Optional[int] = Field(12, ge=1, le=360)

class DiseasePredictQuery(BaseModel):
    image_b64: str = Field(..., max_length=10_000_000, description="Base64 encoded crop leaf image (JPEG or PNG, max 10MB)")
    crop_id: Optional[str] = Field(None, description="Crop identifier, e.g., 'tomato'")
    region_id: Optional[str] = Field(None, description="Region identifier, e.g., 'up_lucknow'")
    area_acres: Optional[float] = Field(1.0, gt=0, le=100_000, description="Affected plot area, used to scale treatment quantity and cost")


class SoilProjectionRequest(BaseModel):
    current_soil: Dict[str, Any]
    rotation: List[Dict[str, str]]
    years: Optional[int] = 5
    apply_fertilizer: Optional[bool] = True

class ExpenseLogRequest(BaseModel):
    farm_id: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0, le=10_000_000)
    date: Optional[str] = Field(None, max_length=10)
    note: Optional[str] = Field("", max_length=1_000)

class BenchmarkRequest(BaseModel):
    region_id: str
    crop_id: str
    user_yield_kg_per_acre: float
    user_profit_per_acre: float

# --- New Flagship Feature Request Models ---
class NDVIQuery(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    crop_id: Optional[str] = "wheat"
    area_acres: Optional[float] = Field(4.0, gt=0, le=100_000)

class FarmScoreQuery(BaseModel):
    region_id: str
    season: str
    budget_per_acre: float = Field(gt=0)
    area_acres: float = Field(gt=0, le=100_000)
    crop_id: Optional[str] = None
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)


class ClimateAlertQuery(BaseModel):
    crop_id: str = "wheat"
    region_id: Optional[str] = "mp_sehore"
    weather: Optional[Dict[str, float]] = None

class CarbonCreditQuery(BaseModel):
    crop_id: str = "wheat"
    area_acres: float = Field(4.0, gt=0, le=100_000)
    tillage_practice: Optional[str] = "no_till"  # 'conventional', 'reduced_till', 'no_till'
    cover_crop: Optional[bool] = True
    biochar_application: Optional[bool] = False

class IoTTelemetryQuery(BaseModel):
    farm_id: Optional[str] = Field("farm_01", min_length=1, max_length=100)
    region_id: Optional[str] = Field(None, max_length=100)

class SensorUploadRequest(BaseModel):
    region_id: str = Field(..., min_length=1, max_length=100)
    device_id: Optional[str] = Field(None, max_length=100)
    filename: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1, max_length=2_000_000)

class IoTTriggerRequest(BaseModel):
    farm_id: Optional[str] = Field("farm_01", min_length=1, max_length=100)
    target_moisture_pct: Optional[float] = Field(65.0, ge=0, le=100)
    current_moisture_pct: Optional[float] = Field(40.0, ge=0, le=100)
    area_acres: Optional[float] = Field(4.0, gt=0, le=100_000)
    flow_rate_lpm: Optional[float] = Field(120.0, gt=0, le=100_000)


class CropRecQuery(BaseModel):
    region_id: str
    season: str
    budget_per_acre: float = Field(..., gt=0, description="Financial budget constraint per acre in INR")
    area_acres: float = Field(..., gt=0, description="Total farm area size in acres")

class YieldPredQuery(BaseModel):
    crop_id: str
    region_id: str
    season: str
    irrigation_level: Optional[float] = Field(0.5, ge=0.0, le=1.0, description="Irrigation level multiplier (0.0 to 1.0)")

class ProfitEstRequest(BaseModel):
    crop_id: str
    predicted_yield_kg_per_acre: float = Field(..., ge=0, description="Predicted yield volume in kg per acre")
    area_acres: float = Field(..., gt=0, description="Total farm area size in acres")
    budget_per_acre: float = Field(..., gt=0, description="Allocated budget limit per acre in INR")
    mandi_price_per_kg: Optional[float] = Field(None, ge=0, description="Current market price per kg in INR")

class IrrigationQuery(BaseModel):
    crop_id: str
    sowing_date: Optional[str] = Field("2025-06-15", description="Estimated sowing date in YYYY-MM-DD format")
    rainfall_mm: Optional[float] = Field(800, ge=0, description="Seasonal cumulative rainfall in mm")
    irrigation_level: Optional[float] = Field(0.5, ge=0.0, le=1.0, description="Irrigation level multiplier (0.0 to 1.0)")

class FertilizerQuery(BaseModel):
    crop_id: str
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

