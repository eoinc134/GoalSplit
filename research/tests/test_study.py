from itertools import pairwise

import numpy as np
import pandas as pd

from goalsplit_research import study as S


def weeks_of_runs(km_by_week, start="2026-01-05", long_run_min=90):
    """Saturday long run plus a Tuesday quality session, per week; km=0 means an empty week."""
    rows = []
    for w, km in enumerate(km_by_week):
        monday = pd.Timestamp(start) + pd.Timedelta(weeks=w)
        if km <= 0:
            continue
        rows.append(
            {
                "localDate": monday + pd.Timedelta(days=5),
                "distanceM": km * 600.0,
                "movingTimeS": long_run_min * 60,
                "runClass": "long",
                "zoneMinutes": [
                    {"minutes": long_run_min},
                    {"minutes": 0},
                    {"minutes": 0},
                    {"minutes": 0},
                    {"minutes": 0},
                ],
            }
        )
        rows.append(
            {
                "localDate": monday + pd.Timedelta(days=1),
                "distanceM": km * 400.0,
                "movingTimeS": 3000,
                "runClass": "workout",
                "zoneMinutes": [{"minutes": 10}, {"minutes": 25}, {"minutes": 15}, {"minutes": 0}, {"minutes": 0}],
            }
        )
    a = pd.DataFrame(rows).sort_values("localDate").reset_index(drop=True)
    a["type"] = "Run"
    a["week"] = a["localDate"].dt.to_period("W-SUN").dt.start_time
    a["decouplingPct"] = 3.0
    a["z2Seconds"] = 1000
    a["z2GapDistanceM"] = 3000.0
    a["loadSource"] = "stream"
    a["workoutType"] = 0
    return a


def daily_from(acts, start, end):
    days = pd.date_range(start, end)
    by_day = acts.groupby("localDate")["distanceM"].agg(["sum", "count"]).reindex(days, fill_value=0)
    d = pd.DataFrame({"load": by_day["sum"] / 100.0, "activityCount": by_day["count"]}, index=days)
    d["acwr"] = S.recompute_acwr(d["load"])
    return d


NO_RACES = pd.DataFrame({"localDate": pd.to_datetime([])})


def test_study_windows_are_whole_weeks_and_do_not_overlap():
    s = S.PLAN_STUDY
    start, end = s.window
    assert start.dayofweek == 0 and end.dayofweek == 6
    assert (end - start).days + 1 == 91
    assert s.before[1] < start and (start - s.before[1]).days == 8  # the freeze week sits between them
    assert (s.before[1] - s.before[0]).days + 1 == 91
    assert (start - s.same_season[0]).days == 364
    blocks = s.reference_blocks(pd.Timestamp("2024-02-06"))
    assert blocks[0] == s.before
    # Blocks run back in time from the study: each starts after the next one ends.
    assert all(newer[0] > older[1] for newer, older in pairwise(blocks))
    assert all(b[0] >= pd.Timestamp("2024-02-06") for b in blocks)


def test_scorecard_recognises_a_plan_shaped_block():
    km = [40, 42, 44, 33, 44, 46, 48, 36, 48, 50, 52, 39, 52, 54, 56, 42]  # 3 lead-in weeks, then 13
    acts = weeks_of_runs(km)
    start = pd.Timestamp("2026-01-05") + pd.Timedelta(weeks=3)
    end = start + pd.Timedelta(weeks=13) - pd.Timedelta(days=1)
    daily = daily_from(acts, "2026-01-05", end)
    m = S.window_metrics(acts, daily, NO_RACES, start, end)
    assert m["breaks_14d_plus"] == 0
    assert m["collapse_weeks"] == 0
    assert m["deload_weeks"] == 4
    assert m["weekend_long_run_weeks"] == 13
    assert m["quality_weeks"] == 13
    assert m["build_ratio"] > 1.10
    assert m["low_share"] > 0.80
    assert S.followed_plan(S.adherence(m))


def test_scorecard_catches_a_collapse_and_a_break():
    km = [40, 42, 44, 44, 44, 44, 0, 0, 0, 44, 44, 44, 44, 44, 44, 44]
    acts = weeks_of_runs(km)
    start = pd.Timestamp("2026-01-05") + pd.Timedelta(weeks=3)
    end = start + pd.Timedelta(weeks=13) - pd.Timedelta(days=1)
    daily = daily_from(acts, "2026-01-05", end)
    m = S.window_metrics(acts, daily, NO_RACES, start, end)
    assert m["breaks_14d_plus"] == 1
    assert m["collapse_weeks"] >= 1
    table = S.adherence(m)
    assert not table.set_index("key").loc["no_break", "met"]
    assert not S.followed_plan(table)  # a break fails the plan however much else was met


def test_steadier_block_scores_lower_load_severity():
    steady = S.window_load_severity(0, 91, 0.0, 0.2)
    erratic = S.window_load_severity(1, 91, 0.15, 0.9)
    assert steady == 0.0
    assert erratic > 0.8


def test_acwr_matches_the_app_formula():
    load = pd.Series([100.0, 0.0, 50.0], index=pd.date_range("2026-01-01", periods=3))
    acwr = S.recompute_acwr(load)
    acute = chronic = 0.0
    for value in load:
        acute = value * 0.25 + acute * 0.75
        chronic = value * 2 / 29 + chronic * (1 - 2 / 29)
    assert np.isclose(acwr.iloc[-1], acute / chronic)


def test_forecast_skill_rewards_the_better_model():
    n = 40
    weeks = pd.Series(np.repeat(np.arange(10), 4))
    actual = pd.Series(np.sin(np.arange(n)))
    preds = pd.DataFrame({"Covariates only": actual + 0.5, "Good": actual + 0.05})
    table = S.forecast_skill(preds, actual, weeks).set_index("model")
    assert table.loc["Good", "skill_vs_covariates"] > 0.9
    assert table.loc["Good", "delta_mse_high"] < 0
    assert table.loc["Covariates only", "skill_vs_covariates"] == 0


def test_truncate_hides_the_future():
    ds = {
        "today": "2026-02-01",
        "daily": [{"date": "2026-01-01"}, {"date": "2026-01-20"}],
        "activities": [{"localDate": "2026-01-01"}, {"localDate": "2026-01-20T10:00:00"}],
    }
    out = S.truncate(ds, "2026-01-10")
    assert len(out["daily"]) == 1 and len(out["activities"]) == 1 and out["today"] == "2026-01-10"
    assert len(ds["daily"]) == 2


def test_efficiency_change_separates_what_load_explains():
    weeks = pd.date_range("2025-08-04", "2026-11-01", freq="W-MON")
    study = S.Study(freeze="2026-11-01", start="2026-08-03", weeks=4)
    rows = []
    for w in weeks:
        for offset in (1, 3):
            rows.append({"localDate": w + pd.Timedelta(days=offset), "week": w})
    runs = pd.DataFrame(rows)
    runs["intensity"], runs["log_hours"], runs["hilly"] = 0.0, 0.0, 0.0
    days = pd.date_range("2025-06-01", "2026-11-01")
    daily = pd.DataFrame({"load": 20.0}, index=days)
    daily.loc[daily.index >= study.window[0] - pd.Timedelta(days=14), "load"] = 40.0  # fortnight load doubles
    runs["ef"] = 1.0
    during = runs["localDate"] >= study.window[0]
    runs.loc[during, "ef"] = 1.0 + 0.01 * (560 - 280) / 100  # exactly what the load predicts
    models = {"covariates": [1.0, 0.0, 0.0, 0.0]}
    out = S.efficiency_change(models, 0.01, runs, daily, study)
    assert np.isclose(out["predicted_from_load"], 0.028, atol=0.002)
    assert np.isclose(out["change"]["estimate"], 0.028, atol=1e-9)
    assert abs(out["unexplained_by_load"]["estimate"]) < 0.002


def test_mid_study_stops_at_the_last_complete_week():
    s = S.Study(freeze="2026-11-07", start="2026-11-09")
    assert S.last_full_day({"today": "2026-11-18"}, s) == pd.Timestamp("2026-11-15")  # a Wednesday
    assert S.last_full_day({"today": "2026-11-22"}, s) == pd.Timestamp("2026-11-22")  # a Sunday
    assert S.last_full_day({"today": "2027-03-01"}, s) == s.window[1]
