"""Grouped holdout evaluation. Run: python -m ml.season_evidence [--observations CSV].

External rows must be previously recorded predictions paired with harvest outcomes,
never fitted predictions reconstructed after observing the harvest.
"""
import argparse
import csv
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / 'ml/models'
REPORT = MODEL_DIR / 'season_evidence.json'


def fingerprint():
    from engine.season_planning import model_version
    return model_version()


def metrics(rows):
    errors = [abs(r['actual'] - r['predicted']) for r in rows]
    return {'samples': len(rows), 'mae_kg_per_acre': round(sum(errors) / len(rows), 2),
            'coverage': round(sum(r['lower'] <= r['actual'] <= r['upper'] for r in rows) / len(rows), 4),
            'small_sample': len(rows) < 30}


def grouped(rows, key):
    return {value: metrics([r for r in rows if r[key] == value]) for value in sorted({r[key] for r in rows})}


def external_rows(path, version):
    rows = []
    with Path(path).open(encoding='utf-8-sig', newline='') as f:
        for line, row in enumerate(csv.DictReader(f), 2):
            if row['model_version'] != version:
                raise ValueError(f'Row {line}: model version differs from deployed yield model.')
            predicted_at = datetime.fromisoformat(row['predicted_at'])
            observed_at = datetime.fromisoformat(row['observed_at'])
            if predicted_at >= observed_at or not row['source'].strip():
                raise ValueError(f'Row {line}: source and prediction preceding observation required.')
            item = {k: float(row[k]) for k in ('actual', 'predicted', 'lower', 'upper')}
            if not all(math.isfinite(v) and v >= 0 for v in item.values()) or not item['lower'] <= item['predicted'] <= item['upper']:
                raise ValueError(f'Row {line}: invalid yield or interval.')
            rows.append({**item, 'crop_id': row['crop_id'], 'region_id': row['region_id']})
    if not rows:
        raise ValueError('No observations in CSV.')
    return rows


def build_report(observations=None):
    import joblib
    import numpy as np
    from ml.dataset_builders import YIELD_FEATURE_NAMES
    holdout = joblib.load(MODEL_DIR / 'holdout_yield.joblib')
    enc = joblib.load(MODEL_DIR / 'label_encoders.joblib')
    model = joblib.load(MODEL_DIR / 'yield_model.joblib')
    x, y = np.asarray(holdout['X_test']), np.asarray(holdout['y_test'])
    pred = model.predict(x)
    # Reserve disjoint portions of the persisted holdout for interval calibration
    # and coverage measurement. Do not retrain or tune the deployed model here.
    indices = np.random.default_rng(719).permutation(len(y))
    calibration, evaluation = indices[:len(y)//2], indices[len(y)//2:]
    residuals = np.abs(y[calibration] - pred[calibration])
    rank = min(len(residuals) - 1, math.ceil((len(residuals) + 1) * .9) - 1)
    radius = float(np.sort(residuals)[rank])
    crops = enc['crop'].inverse_transform(x[:, YIELD_FEATURE_NAMES.index('crop_enc')].astype(int))
    regions = enc['region'].inverse_transform(x[:, YIELD_FEATURE_NAMES.index('region_enc')].astype(int))
    rows = [{'crop_id': str(crops[i]), 'region_id': str(regions[i]), 'actual': float(y[i]),
             'predicted': float(pred[i]), 'lower': max(0, float(pred[i]) - radius),
             'upper': float(pred[i]) + radius} for i in evaluation]
    report = {'generated_at': datetime.now(timezone.utc).isoformat(), 'model_version': fingerprint(),
              'holdout_sha256': hashlib.sha256((MODEL_DIR / 'holdout_yield.joblib').read_bytes()).hexdigest(),
              'status': 'repository_holdout', 'calibration_samples': len(calibration),
              'interval_radius_kg_per_acre': radius, 'target_coverage': .9,
              'overall': metrics(rows), 'by_crop': grouped(rows, 'crop_id'), 'by_region': grouped(rows, 'region_id'),
              'field_evaluation': None,
              'limitations': 'Repository holdout, not independent field validation. Pooled residual intervals are experimental; coverage can differ by crop and region. They do not validate budget-adjusted profit or weather counterfactuals.'}
    if observations:
        external = external_rows(observations, report['model_version'])
        report['field_evaluation'] = {'status': 'user_supplied_observations_not_independently_verified',
                                     'overall': metrics(external), 'by_crop': grouped(external, 'crop_id'),
                                     'by_region': grouped(external, 'region_id')}
    REPORT.write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def read_evidence():
    if not REPORT.exists():
        return {'status': 'not_evaluated', 'field_evaluation': None}
    report = json.loads(REPORT.read_text(encoding='utf-8'))
    if report.get('model_version') != fingerprint():
        return {'status': 'stale', 'field_evaluation': None}
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--observations', type=Path)
    args = parser.parse_args()
    report = build_report(args.observations)
    print(json.dumps({'status': report['status'], 'overall': report['overall']}))
