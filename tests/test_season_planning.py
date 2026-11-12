import csv
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.season_routes import router
from ml import season_evidence

app = FastAPI()
app.include_router(router)
client = TestClient(app)
INPUT = dict(region_id='telangana_medak', season='kharif', crop_ids=['maize','cotton'],
             area_acres=3, budget_per_acre=15000, irrigation_level=.5, rainfall_factor=1)


def test_comparison_matches_reference_and_exposes_sources():
    response = client.post('/api/season/compare', json=INPUT)
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result['crops']) == 2
    assert result['model_version'] and result['sources']
    for crop in result['crops']:
        assert crop['selected'] == crop['baseline']
        assert crop['profit_change'] == 0
        assert crop['dry']['rainfall_mm'] == crop['selected']['rainfall_mm'] / 2
        assert crop['planned_cost'] == 45000
        assert crop['price_source']
    assert result['crops'][0]['selected']['expected_profit'] >= result['crops'][1]['selected']['expected_profit']


@pytest.mark.parametrize('patch', [dict(area_acres=0), dict(rainfall_factor=-1), dict(irrigation_level=2),
    dict(crop_ids=['maize','maize']), dict(crop_ids=[]), dict(season='winter')])
def test_invalid_scenarios_rejected(patch):
    assert client.post('/api/season/compare', json={**INPUT, **patch}).status_code == 422


def test_unknown_region_and_out_of_season_crop():
    assert client.post('/api/season/compare', json={**INPUT,'region_id':'missing'}).status_code == 400
    assert client.post('/api/season/compare', json={**INPUT,'crop_ids':['wheat']}).status_code == 400


def test_missing_calendar_does_not_block_comparison():
    # Seasonal crops may not have a hand-written calendar.
    from unittest.mock import patch
    with patch('engine.features.get_crop_calendar', side_effect=ValueError('No calendar')):
        result = client.post('/api/season/compare', json=INPUT).json()
    assert all(r['calendar'] is None for r in result['crops'])


def test_stale_evaluation_never_served_as_current(tmp_path, monkeypatch):
    report=tmp_path/'evidence.json'
    report.write_text(json.dumps({'model_version':'old','overall':{'samples':100}}))
    monkeypatch.setattr(season_evidence,'REPORT',report)
    monkeypatch.setattr(season_evidence,'fingerprint',lambda:'new')
    assert season_evidence.read_evidence()['status']=='stale'
    assert 'overall' not in season_evidence.read_evidence()


def test_field_observations_require_prior_predictions(tmp_path):
    path=tmp_path/'observations.csv'
    row=dict(model_version='v1', predicted_at='2026-10-01',observed_at='2026-09-01',source='Farm record',
             crop_id='maize',region_id='telangana_medak',actual=100,predicted=105,lower=90,upper=120)
    def write():
        with path.open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=row.keys());writer.writeheader();writer.writerow(row)
    write()
    with pytest.raises(ValueError):season_evidence.external_rows(path,'v1')
    row['observed_at']='2026-10-02';write()
    assert season_evidence.metrics(season_evidence.external_rows(path,'v1'))['mae_kg_per_acre']==5
    row['actual']='NaN';write()
    with pytest.raises(ValueError):season_evidence.external_rows(path,'v1')


def _selected_yield(**patch):
    response = client.post('/api/season/compare', json={**INPUT, **patch})
    assert response.status_code == 200, response.text
    return {c['crop_id']: c for c in response.json()['crops']}


SCENARIO_CASES = [('telangana_medak', 'kharif', 'rice'), ('telangana_medak', 'kharif', 'cotton'),
                  ('telangana_medak', 'kharif', 'maize'), ('punjab_ludhiana', 'kharif', 'rice'),
                  ('punjab_ludhiana', 'kharif', 'cotton'), ('punjab_ludhiana', 'kharif', 'maize'),
                  ('up_lucknow', 'kharif', 'rice'), ('up_lucknow', 'kharif', 'maize')]


@pytest.mark.parametrize('region,season,crop', SCENARIO_CASES)
def test_less_rain_lowers_yield(region, season, crop):
    """N-1: the rainfall control must move the estimate."""
    base = dict(region_id=region, season=season, crop_ids=[crop], budget_per_acre=40000)
    full = _selected_yield(**base, rainfall_factor=1.0)[crop]
    half = _selected_yield(**base, rainfall_factor=0.5)[crop]
    assert half['selected']['achievable_yield_kg_per_acre'] < full['selected']['achievable_yield_kg_per_acre']
    assert half['selected']['prediction_source'] in ('heuristic', 'ml_model_heuristic_response')
    assert half['profit_change'] < 0
    # Reference row is the same estimate in both requests.
    assert half['baseline'] == full['baseline']


def test_more_rain_than_needed_never_raises_yield_above_reference_response():
    """Surplus rain is runoff in the water response, not a yield bonus or penalty."""
    base = dict(crop_ids=['maize'], budget_per_acre=40000, irrigation_level=0.5)
    wet = _selected_yield(**base, rainfall_factor=1.5)['maize']['selected']
    ref = _selected_yield(**base, rainfall_factor=1.0)['maize']['selected']
    assert wet['achievable_yield_kg_per_acre'] >= ref['achievable_yield_kg_per_acre']


@pytest.mark.parametrize('region,season,crop', SCENARIO_CASES)
def test_irrigation_helps_under_low_rain(region, season, crop):
    """N-2: irrigation must not lower yield when rain is short."""
    base = dict(region_id=region, season=season, crop_ids=[crop], budget_per_acre=40000, rainfall_factor=0.5)
    none = _selected_yield(**base, irrigation_level=0)[crop]['selected']
    full = _selected_yield(**base, irrigation_level=1)[crop]['selected']
    assert full['achievable_yield_kg_per_acre'] > none['achievable_yield_kg_per_acre']


def test_dry_scenario_differs_from_selected():
    crops = _selected_yield(crop_ids=['rice'], budget_per_acre=40000)
    rice = crops['rice']
    assert rice['dry']['achievable_yield_kg_per_acre'] < rice['selected']['achievable_yield_kg_per_acre']


def test_assumptions_say_which_rows_are_heuristic():
    result = client.post('/api/season/compare', json=INPUT).json()
    assert any('heuristic' in a.lower() for a in result['assumptions'])


def test_season_is_case_insensitive():
    assert client.post('/api/season/compare', json={**INPUT, 'season': 'KHARIF'}).status_code == 200


def test_large_budget_is_not_counted_as_loss():
    """N-7: budget beyond what the crop uses is unspent, not cost."""
    rows = _selected_yield(crop_ids=['cotton'], budget_per_acre=100000)
    cotton = rows['cotton']
    assert cotton['unspent_budget'] > 0
    assert cotton['planned_cost'] < 100000 * INPUT['area_acres']
