"""One command for the whole pipeline (spec goal 5).

    python -m pipelines.run download [--pilots-only]   fetch every source into data/raw/
    python -m pipelines.run build [--allow-shrink]     stage -> curate -> validate -> serve
    python -m pipelines.run refresh [--full]           scheduled job: save today's live mandi snapshot;
                                                       on Mondays (or --full) also re-pull this year's bulk
                                                       prices and weather older than 30 days; then build
"""
from __future__ import annotations

import json
import logging
import shutil
import sys

from pipelines import build_curated, build_serving, districts, validate
from pipelines.common import CURATED, MANIFEST
from pipelines.sources import agmarknet_live, apmc, apy, costs, irrigation, msp, nasa_power, soil_health

# Smaller national and state tables: optional in a build (skipped with a warning
# when not downloaded), so a pilots-only checkout still builds.
EXTRA_SOURCES = (costs, msp, irrigation, soil_health)


def download(pilots_only: bool = False) -> None:
    apy.download()
    apy.stage()  # districts need the yield table's district list
    apmc.download_markets()
    apmc.download()
    districts.build()
    nasa_power.download(only_pilots=pilots_only)
    for src in EXTRA_SOURCES:
        src.download()


def build(allow_shrink: bool = False) -> int:
    apy.stage()
    apmc.stage()
    districts.build()
    nasa_power.stage()
    for src in EXTRA_SOURCES:
        if (src.RAW_DIR / "_fetch.json").exists():
            src.stage()
    agmarknet_live.stage()  # no-op until daily snapshots exist
    build_curated.build()
    errors = validate.validate(allow_shrink=allow_shrink)
    if errors:
        for e in errors:
            print(f"FAIL {e}")
        return 1
    build_serving.build()
    shutil.copyfile(CURATED / "manifest.json", MANIFEST)
    # The store itself is not in git (37 MB, rebuilt daily); the manifest
    # names the release asset that holds it and its checksum.
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["serving"] = build_serving.serving_entry()
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("pipeline: build passed validation; serving store and fallback CSVs written")
    return 0


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    cmd = argv[0] if argv else "build"
    if cmd == "download":
        download(pilots_only="--pilots-only" in argv)
        return 0
    if cmd == "refresh":
        from datetime import date

        download_all = not (CURATED.parent / "staged" / "districts.parquet").exists()
        if download_all:
            download()
        # Daily: today's live mandi snapshot (needs DATAGOV_API_KEY). The bulk
        # mirror and weather change slowly, so they are re-pulled on Mondays.
        agmarknet_live.download()
        if date.today().weekday() == 0 or "--full" in argv:
            apmc.download(refresh_since=date.today().year)
            nasa_power.download(max_age_days=30)
        return build(allow_shrink="--allow-shrink" in argv)
    if cmd == "build":
        return build(allow_shrink="--allow-shrink" in argv)
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
