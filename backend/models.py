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
    total_cost: float
    expected_profit: float
    loan_amount: Optional[float] = None
    interest_rate_annual: Optional[float] = 4.0
    tenure_months: Optional[int] = 12

class DiseasePredictQuery(BaseModel):
    image_b64: str = Field(..., max_length=10_000_000, description="Base64 encoded crop leaf image (JPEG or PNG, max 10MB)")
    crop_id: Optional[str] = Field(None, description="Crop identifier, e.g., 'tomato'")
    region_id: Optional[str] = Field(None, description="Region identifier, e.g., 'up_lucknow'")


class SoilProjectionRequest(BaseModel):
    current_soil: Dict[str, Any]
    rotation: List[Dict[str, str]]
    years: Optional[int] = 5
    apply_fertilizer: Optional[bool] = True

class ExpenseLogRequest(BaseModel):
    farm_id: str
    category: str
    amount: float
    date: Optional[str] = None
    note: Optional[str] = ""

class BenchmarkRequest(BaseModel):
    region_id: str
    crop_id: str
    user_yield_kg_per_acre: float
    user_profit_per_acre: float

# --- New Flagship Feature Request Models ---
class NDVIQuery(BaseModel):
    lat: float
    lon: float
    crop_id: Optional[str] = "wheat"
    area_acres: Optional[float] = 4.0

class ClimateAlertQuery(BaseModel):
    crop_id: str = "wheat"
    region_id: Optional[str] = "mp_sehore"
    weather: Optional[Dict[str, float]] = None

class CarbonCreditQuery(BaseModel):
    crop_id: str = "wheat"
    area_acres: float = 4.0
    tillage_practice: Optional[str] = "no_till"  # 'conventional', 'reduced_till', 'no_till'
    cover_crop: Optional[bool] = True
    biochar_application: Optional[bool] = False

class IoTTelemetryQuery(BaseModel):
    farm_id: Optional[str] = "farm_01"

class IoTTriggerRequest(BaseModel):
    farm_id: Optional[str] = "farm_01"
    target_moisture_pct: Optional[float] = 65.0
    current_moisture_pct: Optional[float] = 40.0
    area_acres: Optional[float] = 4.0
    flow_rate_lpm: Optional[float] = 120.0


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

