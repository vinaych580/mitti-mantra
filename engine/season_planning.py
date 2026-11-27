"""Comparable scenarios with explicit assumptions and immutable evidence metadata."""
from datetime import datetime, timezone
import hashlib
from pathlib import Path

from ml import predict as p
from utils.csv_cache import index_by
from utils.calculations import water_response_factor
from utils.provenance import describe_sources

ROOT = Path(__file__).resolve().parents[1]


def model_version():
    # Hash the deployed yield artifact, rather than a possibly stale manifest.
    path = ROOT / 'ml/models/yield_model.joblib'
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16] if path.exists() else 'heuristic'


def compare_plan(req):
    crops = p._load_crop_parameters()
    weather, soil = p._prepare_region_data(req.region_id, req.season)
    rows = sorted(index_by('mandi_prices.csv', 'region_id').get(req.region_id, []),
                  key=lambda r: r.get('date', ''))
    prices = {r['crop_id']: r for r in rows}
    result = []
    for crop_id in req.crop_ids:
        crop = crops.get(crop_id)
        if not crop or not p._season_match(req.season, crop.season) or p._is_perennial(crop.season):
            raise ValueError('Select a supported seasonal crop for this season.')
        row = prices.get(crop_id)
        price = float(row['price_inr_per_kg']) if row else (crop.mandi_price_min_inr_per_kg + crop.mandi_price_max_inr_per_kg) / 2
        # The yield model cannot respond to rainfall or irrigation (its
        # weather and irrigation importances are below 0.003: N-1, N-2), so a
        # scenario keeps the reference estimate's level and scales it by the
        # FAO-33 water response of the rule-based simulator. Reference,
        # selected and dry rows therefore share one basis.
        # The reference level is the district's record where one exists (Phase 2).
        ref_yield, ref_source, _ = p.predict_yield_detail(
            crop_id, req.region_id, req.season, weather, soil, .5)
        ref_response = water_response_factor(crop, weather['rainfall_mm'], .5)

        def scenario(rain, irrigation):
            rainfall = weather['rainfall_mm'] * rain
            at_reference = abs(rain - 1) < 1e-9 and abs(irrigation - .5) < 1e-9
            if at_reference:
                y, source = ref_yield, ref_source
            else:
                response = water_response_factor(crop, rainfall, irrigation)
                y = ref_yield * response / ref_response if ref_response > 0 else 0.0
                source = 'heuristic' if ref_source == 'heuristic' else f'{ref_source}_heuristic_response'
            profit = p.profit_estimator(crop_id, round(y, 2), req.area_acres, req.budget_per_acre, price)
            return {**profit, 'prediction_source': source,
                    'rainfall_mm': rainfall, 'irrigation_level': irrigation}
        baseline = scenario(1, .5)
        selected = scenario(req.rainfall_factor, req.irrigation_level)
        dry = scenario(req.rainfall_factor * .5, req.irrigation_level)
        result.append({'crop_id': crop_id, 'crop_name': crop.crop_name,
                       'baseline': baseline, 'selected': selected, 'dry': dry,
                       'profit_change': round(selected['expected_profit'] - baseline['expected_profit'], 2),
                       'water_requirement_mm': crop.water_requirement_mm,
                       'typical_input_cost_per_acre': crop.avg_input_cost_inr_per_acre,
                       'planned_cost': selected['spent_cost'],
                       'unspent_budget': selected['unspent_budget'],
                       'price_per_kg': price, 'price_as_of': row.get('date') if row else None,
                       'price_source': 'dataset/mandi_prices.csv' if row else 'crop parameter price midpoint'})
    result.sort(key=lambda r: r['selected']['expected_profit'], reverse=True)
    from engine.features import get_crop_calendar, pest_disease_alerts
    for item in result:
        try:
            item['calendar'] = get_crop_calendar(item['crop_id'], req.season)['calendar']
        except ValueError:
            item['calendar'] = None
        item['alerts'] = pest_disease_alerts(item['crop_id'], weather)['alerts']
    return {'inputs': req.model_dump(), 'crops': result,
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'model_version': model_version(), 'sources': describe_sources()['sources'],
            'validation': 'Development estimates; independent field validation has not been established.',
            'assumptions': ['Ranked by expected profit within your shortlist, not the recommendation smart score.',
                            "Planned cost is the entered budget, up to 15% above the crop's typical input cost; budget beyond that is shown as unspent, not as a loss.",
                            'Dry scenario halves the selected rainfall; it is not a forecast or confidence interval.',
                            'Scenario rows are heuristic: the yield model does not yet respond to rainfall or irrigation, so scenarios keep the reference estimate and scale it by the FAO-33 water response (yield loss = Ky x water deficit), using effective rainfall plus the share of the shortfall irrigation covers.',
                            'Zaid crops are assumed irrigated: their water need is treated as met and the irrigation level scales yield.',
                            'Reference scenario uses regional rainfall and irrigation level 0.5.',
                            'Prices are repository references, not live sale offers.']}
