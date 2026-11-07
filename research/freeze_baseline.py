"""Freezes the Proposal 3 baseline. Run once, before the study starts:

    .venv\\Scripts\\python freeze_baseline.py

Writes baselines/<date>.json (aggregates and fitted coefficients, committed to git
so the commit timestamps the pre-registration) and keeps a private copy of the
dataset as data/baseline-<date>.json (gitignored; only its hash is committed).
Refuses to overwrite an existing baseline: a frozen result that can be regenerated
later isn't frozen.
"""

import hashlib
import json
import math
import shutil
from pathlib import Path

import numpy as np

from goalsplit_research import data, study
from goalsplit_research.config import DATA_DIR, RESEARCH_DIR

BASELINES_DIR = RESEARCH_DIR / "baselines"


def clean(value):
    """Plain JSON: no numpy types, no NaN, and no spurious float precision."""
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return None if math.isnan(value) else round(float(value), 6)
    return value


def main() -> None:
    plan = study.PLAN_STUDY
    target = BASELINES_DIR / f"{plan.freeze}.json"
    if target.exists():
        raise SystemExit(f"{target} already exists. The baseline is frozen.")

    source: Path = DATA_DIR / f"dataset-{plan.freeze}.json"
    dataset = data.load_cached_dataset(source)
    baseline = study.freeze(dataset, data.garmin_days(), plan)
    baseline["data"]["dataset_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()

    BASELINES_DIR.mkdir(exist_ok=True)
    target.write_text(json.dumps(clean(baseline), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    shutil.copyfile(source, DATA_DIR / f"baseline-{plan.freeze}.json")
    print(f"Frozen: {target}")


if __name__ == "__main__":
    main()
