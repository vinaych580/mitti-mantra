"""Build tests/fixtures/agronomic_acceptance.json (Phase 2, spec 2.3).

For each pilot region x kharif/rabi: the crops that must appear in the top three (at
least one of the district's two largest seasonal crops by recorded area, last five
years on record) and crops that must not (seasonal candidates with no recorded area
anywhere in the district's state, by ml.district_evidence.state_has_record, so basmati
counts rice's record in the basmati GI states). Source: DES APY district area via the serving store.

    python scripts/ml/build_agronomic_acceptance.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from ml import district_evidence as de  # noqa: E402
from ml import predict as P  # noqa: E402
from utils import store  # noqa: E402

OUT = ROOT / "tests" / "fixtures" / "agronomic_acceptance.json"


def main() -> int:
    params = P._load_crop_parameters()
    regions = store.query("SELECT district_id, region_id, state_code, district_name FROM districts "
                          "WHERE region_id != '' ORDER BY region_id")
    cases = []
    for r in regions:
        for season in ("kharif", "rabi"):
            cands = {c for c, cp in params.items() if P._season_match(season, cp.season) and not P._is_perennial(cp.season)}
            rows = store.query("SELECT crop_id, year, area_acres FROM yield_dcy WHERE district_id = ? "
                               "AND season = ? AND area_acres > 0", (r["district_id"], season))
            if not rows:
                continue
            last = max(x["year"] for x in rows)
            area: dict[str, float] = {}
            for x in rows:
                if x["year"] > last - 5 and x["crop_id"] in cands:
                    area[x["crop_id"]] = area.get(x["crop_id"], 0) + x["area_acres"]
            top = sorted(area, key=area.get, reverse=True)[:2]
            if not top:
                continue
            must_not = sorted(c for c in cands if not de.state_has_record(r["district_id"], c, season))
            total = sum(area.values())
            cases.append({"region_id": r["region_id"], "district": r["district_name"], "season": season,
                          "must_include_any": top,
                          "top_shares": {c: round(area[c] / total, 3) for c in top},
                          "must_not_include": must_not})
    OUT.write_text(json.dumps({"source": "DES APY district area (serving store), last 5 years on record",
                               "built_by": "scripts/ml/build_agronomic_acceptance.py",
                               "cases": cases}, indent=1), encoding="utf-8")
    print(f"{len(cases)} cases -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
