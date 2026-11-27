"""Copy a trained run into the app bundle (Phase 2, spec 2.5).

    python -m ml.release yield <version> [--override "reason"]

Copies ml/runs/<model>/<version>/{model.joblib, metrics.json, model_card.md} to
ml/models/<model>/ as current.joblib, metrics.json and model_card.md, and records the
release in ml/models/<model>/releases.json. A run whose behaviour tests failed is refused
unless --override gives a reason, which is recorded with the release. A run whose gate
failed releases normally and serves its baseline instead of the model.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def release(model: str, version: str, override: str | None = None) -> Path:
    run = ROOT / "ml" / "runs" / model / version
    if not (run / "model.joblib").exists():
        raise SystemExit(f"no run at {run}")
    metrics = json.loads((run / "metrics.json").read_text(encoding="utf-8"))
    # A failed gate is not a problem here: the run then serves its baseline (its
    # metrics say which, under "serves"). Failed behaviour tests are.
    problems = []
    if metrics.get("behaviour_passed") is False:
        problems.append("behaviour tests failed")
    if problems and not override:
        raise SystemExit(f"refusing to release {model} {version}: {', '.join(problems)} "
                         "(pass --override \"reason\" to release anyway)")
    dest = ROOT / "ml" / "models" / model
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(run / "model.joblib", dest / "current.joblib")
    shutil.copy2(run / "metrics.json", dest / "metrics.json")
    shutil.copy2(run / "model_card.md", dest / "model_card.md")
    log = dest / "releases.json"
    history = json.loads(log.read_text(encoding="utf-8")) if log.exists() else []
    history.append({"version": version, "released_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "serves": metrics.get("serves", "model"), "gate_passed": metrics.get("gate", {}).get("passed"),
                    "problems": problems, "override": override})
    log.write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"released {model} {version} -> {dest}")
    return dest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("model")
    ap.add_argument("version")
    ap.add_argument("--override")
    a = ap.parse_args(argv)
    release(a.model, a.version, a.override)
    return 0


if __name__ == "__main__":
    sys.exit(main())
