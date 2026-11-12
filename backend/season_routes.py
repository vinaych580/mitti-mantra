from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict, field_validator

router = APIRouter()


class PlanComparison(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    region_id: str = Field(min_length=1, max_length=80)
    season: Literal['kharif', 'rabi', 'zaid']
    crop_ids: list[str] = Field(min_length=1, max_length=3)
    area_acres: float = Field(gt=0, le=100000)
    budget_per_acre: float = Field(gt=0, le=10000000)
    irrigation_level: float = Field(default=.5, ge=0, le=1)
    rainfall_factor: float = Field(default=1, ge=0, le=2)

    @field_validator('season', mode='before')
    @classmethod
    def lower_season(cls, value):
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator('crop_ids')
    @classmethod
    def unique_crops(cls, values):
        if len(set(values)) != len(values):
            raise ValueError('Select distinct crops.')
        return values


@router.post('/api/season/compare')
def compare(req: PlanComparison):
    from engine.season_planning import compare_plan
    try:
        return compare_plan(req)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get('/api/season/evidence')
def evidence():
    from ml.season_evidence import read_evidence
    return read_evidence()
