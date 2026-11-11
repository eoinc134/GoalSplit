"""Builds notebooks/03-before-after.ipynb. Edit cells here, then run:

.venv\\Scripts\\python notebooks\\build_03_before_after.py
.venv\\Scripts\\jupyter nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=1200 notebooks\\03-before-after.ipynb
"""

from pathlib import Path

import nbformat as nbf

md = nbf.v4.new_markdown_cell
code = nbf.v4.new_code_cell

cells = [
    md(
        """# 03 — Before and after the training plan

The baseline was frozen on 7 Nov 2026 (`baselines/2026-11-07.json`), before the study
window of **9 Nov 2026 to 7 Feb 2027**. Models and thresholds come from that file and
aren't refitted for the forecast test. The rules are in
[proposal 3](../proposals/03-plan-before-after.md).

The notebook works at any time. Until the window has ended, it reports adherence so
far and withholds the outcomes. The rehearsal at the end runs the same pipeline on
past periods, where nothing about the outcome is at stake."""
    ),
    code(
        """import json
import sys
sys.path.insert(0, "..")

import pandas as pd

from goalsplit_research import data, limiters as L, study as S

pd.set_option("display.width", 170)
pd.set_option("display.max_columns", 30)
pd.set_option("display.max_colwidth", 70)

plan = S.PLAN_STUDY
baseline = json.loads(open(f"../baselines/{plan.freeze}.json", encoding="utf-8").read())
ds = data.fetch_dataset()
garmin = data.garmin_days()
complete = S.is_complete(ds, plan)
print(f"Data to {ds['today']}. Study window {plan.window[0].date()} to {plan.window[1].date()}: "
      f"{'complete' if complete else 'still running, so outcomes are withheld'}.")"""
    ),
    md(
        """## 1. The frozen baseline

Thirteen-week blocks going back from the last complete week before the study. These
are the only fair comparison for a 13-week window: shorter windows mechanically show
less week-to-week variation, so the 12-month figures can't be set beside them."""
    ),
    code(
        """SCORECARD = ["start", "end", "runs", "km_per_week", "load_per_week", "breaks_14d_plus", "collapse_weeks",
             "deload_weeks", "weekend_long_run_weeks", "quality_weeks", "low_share", "acwr_spike_share",
             "weekly_load_cv", "load_severity", "load_severity_no_races", "median_drift_pct"]
blocks = pd.DataFrame(baseline["windows"]["reference_blocks"])
blocks["criteria_met"] = [int(S.adherence(row)["met"].sum()) for row in baseline["windows"]["reference_blocks"]]
print(blocks[SCORECARD + ["criteria_met"]].round(2).to_string(index=False))

bn = baseline["bottleneck"]
print(f"\\nBottleneck as of {bn['as_of']}:")
for event in L.EVENTS:
    top3 = ", ".join(f"{r['key']} {r['score']:.2f}" for r in bn["ranking"][event][:3])
    print(f"  {event:<15} {top3}  (first in {bn['top_share_under_perturbation'][event]:.1%} of perturbations)")
print("  12-month load evidence:", {k: round(v, 3) for k, v in bn["load_evidence"].items()})
print("\\nWhere the 12-month load score lands at the study's end, by projection:")
for name, row in baseline["window_floor"].items():
    print(f"  {name:<24} severity {row['severity']:.2f}, breaks {row['breaks_14d_plus']}, "
          f"spike days {row['acwr_spike_day_share']:.1%}, CV {row['weekly_load_cv']:.2f}")"""
    ),
    md(
        """## 2. Was the plan followed?

Everything below depends on this. If the plan wasn't followed, the results describe
what was actually done, not the plan."""
    ),
    code(
        """def adherence_report(followup):
    m = followup["metrics"]["study"]
    print(followup["adherence"][["criterion", "met"]].to_string(index=False))
    print(f"\\nFollowed the plan: {followup['followed_plan']} "
          f"({int(followup['adherence']['met'].sum())} of {len(S.ADHERENCE)}; no_break required)")
    print({k: (round(m[k], 2) if isinstance(m[k], float) else m[k]) for k in
           ["runs", "runs_without_hr", "km_per_week", "hours_per_week", "load_per_week", "longest_gap_days", "collapse_weeks",
            "deload_weeks", "weekend_long_run_weeks", "quality_weeks", "build_ratio", "low_share"]})

started = S.last_full_day(ds, plan) >= plan.window[0] + pd.Timedelta(days=6)  # at least one complete week
followup = S.follow_up(baseline, ds, garmin, plan) if started else None
if followup:
    adherence_report(followup)
    if not complete:
        print("\\nMid-study: the targets are for all 13 weeks, so unmet criteria aren't a verdict yet.")
    print("\\nWeeks so far:")
    print(S.weekly_table(data.activities_frame(ds), data.daily_frame(ds), plan.window[0], S.last_full_day(ds, plan))
          .round(2).to_string())
else:
    print("The study hasn't started.")"""
    ),
    md(
        """## 3. Outcomes

Printed by one function, so the rehearsal below reads the same way as the real result."""
    ),
    code(
        """def ci(row):
    if row["estimate"] is None:
        return "not enough runs"
    return f"{row['estimate']:+.3f} ({row['ci_low']:+.3f} to {row['ci_high']:+.3f})"

def outcomes_report(followup, baseline):
    m = followup["metrics"]
    print("QUESTION 1: TRAINING LOAD VS PERFORMANCE")
    print(f"\\nFrozen forecasts on {followup['held_out_runs']} new runs (skill against covariates only; "
          "an interval excluding 0 is needed to claim anything):")
    print(followup["forecast"].round(4).to_string(index=False))
    e = followup["efficiency"]
    print("\\nResidual efficiency level per window:")
    print(pd.DataFrame(e["levels"]).T.round(3).to_string())
    print(f"\\nObserved change vs the block before:   {ci(e['change'])}")
    predicted = e["predicted_from_load"]
    print(f"Predicted from the load change:        {'n/a' if predicted is None else format(predicted, '+.3f')}")
    print(f"Not explained by load:                 {ci(e['unexplained_by_load'])}")
    print(f"Same for last year's windows (season): {ci(e['last_year_unexplained_by_load'])}")
    print(f"Net of last year:                      {ci(e['unexplained_net_of_last_year'])}")
    was, now = baseline["dose_response"]["all_runs"], followup["refit"]["dose_response"]["all_runs"]
    print(f"\\nTwo-week effect per 100 TRIMP, refitted: {was['effect_per_100_trimp']:+.4f} (p={was['p']:.3f}, n={was['n']}) "
          f"→ {now['effect_per_100_trimp']:+.4f} (p={now['p']:.3f}, n={now['n']})")
    was_f, now_f = baseline["models"]["fitted"], followup["refit"]["models"]["fitted"]
    print(f"Fitted τ₁/τ₂, refitted: {was_f['tau1']:.0f}/{was_f['tau2']:.0f} → {now_f['tau1']:.0f}/{now_f['tau2']:.0f}; "
          f"R² {baseline['models']['r2_fitted']:.3f} → {followup['refit']['models']['r2_fitted']:.3f}")

    print("\\n\\nQUESTION 2: THE BOTTLENECK")
    print("\\nThirteen-week load severity (the primary measure):")
    keys = ["load_severity", "load_severity_no_races", "breaks_14d_plus", "acwr_spike_share", "weekly_load_cv", "low_share", "median_drift_pct",
            "weekend_long_run_weeks", "km_per_week", "z2_gap_pace_s_per_km"]
    print(pd.DataFrame(m).loc[keys].T.astype(float).round(3).to_string())
    was_b, now_b = baseline["bottleneck"], followup["bottleneck"]
    print("\\nThe unchanged 12-month scorer:")
    print("  load evidence before:", {k: round(v, 3) for k, v in was_b["load_evidence"].items()})
    print("  load evidence after: ", {k: round(v, 3) for k, v in now_b["load_evidence"].items()})
    for event in L.EVENTS:
        fmt = lambda b: ", ".join(f"{r['key']} {r['score']:.2f}" for r in b["ranking"][event][:3])
        print(f"  {event:<15} before: {fmt(was_b)}\\n{'':<17} after:  {fmt(now_b)} "
              f"(first in {now_b['top_share_under_perturbation'][event]:.1%} of perturbations)")

    print("\\n\\nSECONDARY")
    print("Races in the window:")
    print(pd.DataFrame(followup["races"]).round(1).to_string(index=False) if followup["races"] else "  none")
    print("Recovery:", {k: None if v is None else round(v, 2) for k, v in followup["recovery"].items()})
    print("Recovery, same weeks last year:", {k: None if v is None else round(v, 2) for k, v in followup["recovery_same_season"].items()})
    print("\\nDid the app's metrics move under the study? Baseline block, now minus frozen:",
          {k: round(v, 3) for k, v in followup["metric_drift"].items()}, "| physiology now:", followup["physiology_now"])

if complete:
    outcomes_report(followup, baseline)
else:
    print("Withheld until the window ends, so the plan isn't steered by them.")"""
    ),
    md(
        """## 4. Rehearsal on past periods

The same freeze and follow-up, with each past date treated as "now". Two periods:

- **Winter 2025–26,** when training collapsed. Adherence must fail, and load should
  worsen. This is the negative control.
- **The 2026 backyard-ultra build,** the best stretch before the study, but not this
  plan.

It also shows how wide the intervals are, so the real result isn't over-read."""
    ),
    code(
        """for name, past in [("Winter 2025–26", S.Study("2025-11-08", "2025-11-10")), ("Ultra build 2026", S.Study("2026-06-27", "2026-06-29"))]:
    print("=" * 100 + f"\\n{name}: study window {past.window[0].date()} to {past.window[1].date()}\\n" + "=" * 100)
    earlier = S.freeze(ds, garmin, past)
    rehearsal = S.follow_up(earlier, S.truncate(ds, str(past.window[1].date())), garmin, past)
    adherence_report(rehearsal)
    print()
    outcomes_report(rehearsal, earlier)
    print()"""
    ),
]

nb = nbf.v4.new_notebook(cells=cells, metadata={"kernelspec": {"name": "python3", "display_name": "Python 3"}})
nbf.write(nb, Path(__file__).parent / "03-before-after.ipynb")
print("wrote 03-before-after.ipynb")
