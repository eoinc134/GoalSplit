"""Checks that the app's plan-adherence view (GET /api/plan/adherence, ported
to TypeScript in apps/api/src/lib/plan-adherence.ts) agrees with the study's
own scoring in goalsplit_research/study.py, on every complete study week.

The dashboard shows progress mid-study; the study's verdict comes from
study.py. If the two drift apart, the dashboard would show one thing and the
follow-up conclude another, so run this after changing either side:

    .venv\\Scripts\\python check_adherence_parity.py

It reads both from the same API (GOALSPLIT_API_URL, default the research API
on port 3002; set it to http://localhost:3001/api for the dev API). Exits 1
on any mismatch.
"""

from __future__ import annotations

import sys

import pandas as pd
import requests

from goalsplit_research import study as S
from goalsplit_research.config import api_headers, api_url
from goalsplit_research.data import fetch_dataset

KM_TOLERANCE = 0.05  # the API rounds weekly km to 0.1
RATIO_TOLERANCE = 0.006  # and ratios to 0.01
LOW_SHARE_TOLERANCE = 0.06  # percentage points; the API rounds to 0.1


def main() -> int:
    res = requests.get(f"{api_url()}/plan/adherence", headers=api_headers(), timeout=120)
    res.raise_for_status()
    app = res.json()["data"]
    if app is None or app["status"] == "not-started":
        print("The study hasn't started (or no athlete): nothing to compare.")
        return 0

    complete = [w for w in app["weeks"] if w["state"] == "complete"]
    if not complete:
        print("No complete study week yet: nothing to compare.")
        return 0
    start = pd.Timestamp(app["study"]["start"])
    last_day = pd.Timestamp(complete[-1]["weekStart"]) + pd.Timedelta(days=6)

    frames = S.Frames.build(fetch_dataset(refresh=True))
    weeks = S.weekly_table(frames.acts, frames.daily, start, last_day)
    metrics = S.window_metrics(frames.acts, frames.daily, frames.races, start, last_day)

    problems: list[str] = []

    def check(what: str, ours, theirs, tolerance: float | None = None) -> None:
        if ours is None and theirs is None:
            return
        if tolerance is None:
            same = ours == theirs
        else:
            same = ours is not None and theirs is not None and abs(float(ours) - float(theirs)) <= tolerance
        if not same:
            problems.append(f"{what}: study.py {ours!r} vs app {theirs!r}")

    for w in complete:
        row = weeks.loc[pd.Timestamp(w["weekStart"])]
        label = f"week {w['weekNumber']} ({w['weekStart']})"
        check(f"{label} km", round(float(row["km"]), 2), w["km"], KM_TOLERANCE)
        check(f"{label} weekend long run", bool(row["weekend_long_run"]), w["weekendLongRun"])
        check(f"{label} quality", bool(row["quality"]), w["quality"])
        ratio = None if pd.isna(row["km_vs_trailing"]) else round(float(row["km_vs_trailing"]), 3)
        check(f"{label} km vs trailing 3", ratio, w["kmVsTrailing"], RATIO_TOLERANCE)

    crit = {c["key"]: c for c in app["criteria"]}
    check("breaks of 14+ days", metrics["breaks_14d_plus"], crit["no_break"]["value"])
    check("collapse weeks", metrics["collapse_weeks"], crit["no_collapse"]["value"])
    check("deload weeks", metrics["deload_weeks"], crit["deloads"]["value"])
    low = None if metrics["low_share"] is None else 100 * metrics["low_share"]
    # The app's low share also counts the current partial week, so compare it
    # only while that week has no heart-rate time yet.
    current = next((w for w in app["weeks"] if w["state"] == "current"), None)
    if current is None or current["lowPct"] is None:
        check("low-intensity share %", low, crit["easy"]["value"], LOW_SHARE_TOLERANCE)

    if problems:
        print(f"{len(problems)} mismatch(es) between study.py and /api/plan/adherence:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"study.py and /api/plan/adherence agree on {len(complete)} complete week(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
