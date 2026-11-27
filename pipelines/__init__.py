"""Phase 1 data pipeline: raw downloads -> staged -> curated -> serving.

    python -m pipelines.run download   # fetch every source into data/raw/
    python -m pipelines.run build      # stage, curate, validate, build serving

See docs/superpowers/specs/2026-11-11-phase1-data-foundation-design.md.
"""
