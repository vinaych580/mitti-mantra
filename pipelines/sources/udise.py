"""District points from UDISE+ school locations, via India Data Portal.

Not a farm dataset: used only to give a weather point to districts that have
neither a pilot headquarters nor a geocoded mandi (pipelines/districts.py).
The point is the median latitude and longitude of the district's schools,
which follow where people live and farm. Checked against districts that also
have a mandi point: median distance 13 km, 95th percentile 61 km.

UDISE+ codes districts with zero-padded LGD codes ("01", "001"); 97% of
matched names agree and the rest are official renames (Osmanabad/Dharashiv).
"""
from __future__ import annotations

from pathlib import Path

from pipelines.common import RAW, log, portal_sql_all, write_fetch_meta

RESOURCE_ID = "457fddf1-982f-4c85-855d-5095578accc1"
RAW_DIR = RAW / "udise"
POINTS_FILE = RAW_DIR / "district_points.csv"
SOURCE = "UDISE+ school locations via India Data Portal"
LICENCE = "ODC-By 1.0"


def download_points(force: bool = False) -> Path:
    import pandas as pd

    if POINTS_FILE.exists() and not force:
        return POINTS_FILE
    rows = portal_sql_all(f"""
SELECT state_code, district_code, max(state_name) AS state_name, max(district_name) AS district_name,
       count(*) AS n_schools,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY latitude) AS lat,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY longitude) AS lon
FROM "{RESOURCE_ID}"
WHERE latitude BETWEEN 6 AND 38 AND longitude BETWEEN 68 AND 98
  AND district_code IS NOT NULL AND district_code <> 'None'
GROUP BY state_code, district_code
ORDER BY state_code, district_code""")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(POINTS_FILE, index=False)
    write_fetch_meta(RAW_DIR, resource=RESOURCE_ID, rows=len(rows))
    log.info("udise: %d district points", len(rows))
    return POINTS_FILE


def points():
    """(state_code, district_code) as plain integers' strings -> lat, lon, n_schools."""
    import pandas as pd

    p = pd.read_csv(download_points(), dtype={"state_code": str, "district_code": str})
    p = p[p["state_code"].str.isdigit() & p["district_code"].str.isdigit()].copy()
    p["state_code"] = p["state_code"].astype(int).astype(str)
    p["district_code"] = p["district_code"].astype(int).astype(str)
    return p[["state_code", "district_code", "lat", "lon", "n_schools"]]
