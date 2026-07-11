from .predict import (
    location_based_insights,
    predict_yield_kg_per_acre,
    profit_estimator,
    recommend_crops,
    smart_risk_score,
    mandi_price_analytics,
    rotation_planner,
    _ml_predict_price,
    _ml_recommend_crop,
)

# Lazy import: train_models.py is excluded by .vercelignore to keep the
# deployment bundle small.  Importing it eagerly would crash the app on
# Vercel with ModuleNotFoundError.  The train endpoint already does its
# own lazy import, so this only matters if someone does `from ml import train_all`.
def __getattr__(name):
    if name == "train_all":
        from .train_models import train_all
        return train_all
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "predict_yield_kg_per_acre",
    "smart_risk_score",
    "profit_estimator",
    "location_based_insights",
    "recommend_crops",
    "mandi_price_analytics",
    "rotation_planner",
    "_ml_predict_price",
    "_ml_recommend_crop",
    "train_all",
]
