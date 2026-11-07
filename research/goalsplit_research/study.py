"""Plan before/after study (Proposal 3): freeze the results now, follow the
training plan for 13 weeks, then measure what changed.

Everything the comparison depends on is decided here, before the study starts:
the windows, the definition of following the plan, and the fixed metrics. The
limiter thresholds and weights stay exactly as in limiters.py. See
proposals/03-plan-before-after.md.

`freeze` and `follow_up` take any Study, so the whole pipeline can be rehearsed
on past periods, where nothing about the outcome is at stake.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import statsmodels.api as sm

from . import datasets
from . import limiters as L
from .data import activities_frame, daily_frame
from .fitness_fatigue import Fit, LoadTerms, fit_fixed, fit_grid, predict

COVARIATES = ["intensity", "log_hours", "hilly"]
SINGLE_TERM_TAU = 13.0  # Findings 1: the fit collapses to one load term of about this length
DEFAULT_TAUS = (42.0, 7.0)
FORM_DAYS = 28
DOSE_LAGS = 8
AFTER_BREAK_DAYS = 21
BREAK_DAYS = 14
N_PERTURB = 1000
N_BOOT = 2000
MIN_RUNS_FOR_LEVEL = 8  # fewer runs than this in a window: its efficiency level isn't reported

# What following the plan means. Long runs and deloads are defined from the
# training itself, not from tags, except that quality sessions need a class.
LONG_RUN_MINUTES = 75
QUALITY_MIN_ABOVE_Z2 = 10
DELOAD_RANGE = (0.50, 0.85)  # week's km ÷ mean of the previous 3 weeks
TRAILING_WEEKS = 3
BUILD_FIRST_WEEKS = 4
BUILD_FROM_WEEK = 6  # the best 4-week stretch from here on, so a race taper isn't penalised

ADHERENCE = {
    "no_break": ("No 14+ day break", lambda m: m["breaks_14d_plus"] == 0),
    "no_collapse": ("No week under 50% of the previous 3 weeks' km", lambda m: m["collapse_weeks"] == 0),
    "deloads": ("At least 2 deload weeks (50–85% of the previous 3 weeks' km)", lambda m: m["deload_weeks"] >= 2),
    "long_runs": ("Weekend 75+ min run in at least 10 of 13 weeks", lambda m: m["weekend_long_run_weeks"] >= 10),
    "quality": ("Quality session in at least 9 of 13 weeks", lambda m: m["quality_weeks"] >= 9),
    "easy": ("At least 80% of heart-rate time in Z1–2", lambda m: (m["low_share"] or 0) >= 0.80),
    "build": ("Best later 4 weeks at least 10% above the first 4 (km)", lambda m: (m["build_ratio"] or 0) >= 1.10),
}
ADHERENT_MIN = 6  # of the 7 criteria, and no_break is required


@dataclass(frozen=True)
class Study:
    freeze: str
    start: str  # a Monday
    weeks: int = 13

    def _block(self, weeks_before_start: int) -> tuple[pd.Timestamp, pd.Timestamp]:
        first = pd.Timestamp(self.start) - pd.Timedelta(weeks=weeks_before_start)
        return first, first + pd.Timedelta(weeks=self.weeks) - pd.Timedelta(days=1)

    @property
    def window(self):
        return self._block(0)

    @property
    def before(self):
        """The last 13 complete weeks before the study, skipping the week the freeze falls in."""
        return self._block(self.weeks + 1)

    @property
    def same_season(self):
        return self._block(52)

    @property
    def before_same_season(self):
        return self._block(52 + self.weeks + 1)

    def reference_blocks(self, first_day: pd.Timestamp) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
        """Every whole, non-overlapping 13-week block before the study."""
        blocks = []
        offset = self.weeks + 1
        while (block := self._block(offset))[0] >= first_day:
            blocks.append(block)
            offset += self.weeks
        return blocks


PLAN_STUDY = Study(freeze="2026-11-07", start="2026-11-09")


def truncate(dataset: dict, as_of: str) -> dict:
    """The dataset as it stood on `as_of`, for freezing at a past date in a rehearsal."""
    out = dict(dataset)
    out["today"] = as_of
    out["daily"] = [d for d in dataset["daily"] if d["date"] <= as_of]
    out["activities"] = [a for a in dataset["activities"] if a["localDate"][:10] <= as_of]
    return out


def _monday(day: pd.Timestamp) -> pd.Timestamp:
    return day - pd.Timedelta(days=day.dayofweek)


def _minutes_above_z2(zone_minutes) -> float | None:
    if not isinstance(zone_minutes, list):
        return None
    return float(sum(z["minutes"] for z in zone_minutes[2:]))


def _is_quality(run: pd.Series) -> bool:
    if run["runClass"] not in ("workout", "race"):
        return False
    above = _minutes_above_z2(run["zoneMinutes"])
    return above is None or above >= QUALITY_MIN_ABOVE_Z2  # no heart rate: trust the class


def weekly_table(acts: pd.DataFrame, daily: pd.DataFrame, start, end) -> pd.DataFrame:
    """One row per Monday-based week in [start, end], with the km ratios needing earlier weeks."""
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    weeks = pd.date_range(start - pd.Timedelta(weeks=TRAILING_WEEKS), end, freq="W-MON")
    runs = acts[acts["type"] == "Run"]
    table = pd.DataFrame(index=weeks)
    table["km"] = (runs.groupby("week")["distanceM"].sum() / 1000).reindex(weeks, fill_value=0.0)
    table["hours"] = (runs.groupby("week")["movingTimeS"].sum() / 3600).reindex(weeks, fill_value=0.0)
    load_week = daily.index.to_period("W-SUN").start_time
    table["load"] = daily["load"].groupby(load_week).sum().reindex(weeks, fill_value=0.0)

    weekend = runs[(runs["localDate"].dt.dayofweek >= 5) & (runs["movingTimeS"] >= LONG_RUN_MINUTES * 60)]
    table["weekend_long_run"] = table.index.isin(weekend["week"])
    quality_weeks = runs[runs.apply(_is_quality, axis=1)]["week"] if len(runs) else []
    table["quality"] = table.index.isin(quality_weeks)

    trailing = table["km"].shift(1).rolling(TRAILING_WEEKS).mean()
    table["km_vs_trailing"] = (table["km"] / trailing).where(trailing > 0)
    return table[table.index >= start]


def _mean(values) -> float | None:
    vals = [v for v in values if v is not None]
    return float(np.mean(vals)) if vals else None


def window_load_severity(breaks: int, days: int, spike_share, cv, params=L.PARAMS) -> float | None:
    """The same three ramps as limiters.load_management, on one 13-week window.
    Breaks are annualised to stay on the per-year ramp. Only comparable with other
    13-week windows: a shorter window mechanically shows less weekly variation."""
    annual_breaks = breaks * L.YEAR_DAYS / days if days else None
    return _mean([
        L.ramp(annual_breaks, *params["breaks_per_year"]),
        L.ramp(spike_share, *params["acwr_spike_share"]),
        L.ramp(cv, *params["weekly_load_cv"]),
    ])


def _cv(values: pd.Series) -> float | None:
    return float(values.std() / values.mean()) if len(values) > 4 and values.mean() > 0 else None


def window_metrics(acts: pd.DataFrame, daily: pd.DataFrame, races: pd.DataFrame, start, end) -> dict:
    """The fixed scorecard for one window."""
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    a = acts[(acts["localDate"] >= start) & (acts["localDate"] <= end)]
    d = daily[(daily.index >= start) & (daily.index <= end)]
    runs = a[a["type"] == "Run"]
    weeks = weekly_table(acts, daily, start, end)

    active = d["activityCount"] > 0
    gap_id = (active != active.shift()).cumsum()
    gaps = d[~active].groupby(gap_id[~active]).size()
    breaks = int((gaps >= BREAK_DAYS).sum())

    race_days = L.race_window_days(L.Context.at(end, acts, daily, races))
    race_weeks = {_monday(day) for day in race_days}
    spikes_no_races = d[~d.index.isin(race_days)]["acwr"] > 1.5
    weekly_no_races = weeks.loc[~weeks.index.isin(list(race_weeks)), "load"]
    spike_share = float((d["acwr"] > 1.5).mean()) if len(d) else None
    spike_share_no_races = float(spikes_no_races.mean()) if len(spikes_no_races) else None
    cv = _cv(weeks["load"])
    cv_no_races = _cv(weekly_no_races)

    minutes = np.zeros(5)
    for zones in a["zoneMinutes"]:
        if isinstance(zones, list):
            minutes += np.array([z["minutes"] for z in zones])
    total = minutes.sum()

    long_runs = runs[(runs["movingTimeS"] >= L.MIN_LONG_RUN_MINUTES * 60) & runs["decouplingPct"].notna()]
    first = weeks["km"].iloc[:BUILD_FIRST_WEEKS].mean()
    later = weeks["km"].iloc[BUILD_FROM_WEEK - 1:].rolling(BUILD_FIRST_WEEKS).mean().max()
    z2_seconds = runs["z2Seconds"].fillna(0).sum()
    z2_metres = runs["z2GapDistanceM"].fillna(0).sum()
    ratio = weeks["km_vs_trailing"]
    # A week following three empty weeks has no ratio, so it counts as neither a collapse nor a deload.
    return {
        "runs": len(runs),
        "runs_without_hr": int((runs["loadSource"] == "none").sum()),
        "km_per_week": float(weeks["km"].mean()),
        "hours_per_week": float(weeks["hours"].mean()),
        "load_per_week": float(weeks["load"].mean()),
        "breaks_14d_plus": breaks,
        "longest_gap_days": int(gaps.max()) if len(gaps) else 0,
        "collapse_weeks": int((ratio < DELOAD_RANGE[0]).sum()),
        "deload_weeks": int(((ratio >= DELOAD_RANGE[0]) & (ratio <= DELOAD_RANGE[1])).sum()),
        "weekend_long_run_weeks": int(weeks["weekend_long_run"].sum()),
        "quality_weeks": int(weeks["quality"].sum()),
        "build_ratio": float(later / first) if first > 0 and pd.notna(later) else None,
        "low_share": float((minutes[0] + minutes[1]) / total) if total else None,
        "moderate_share": float(minutes[2] / total) if total else None,
        "high_share": float((minutes[3] + minutes[4]) / total) if total else None,
        "acwr_spike_share": spike_share,
        "acwr_spike_share_no_races": spike_share_no_races,
        "weekly_load_cv": cv,
        "weekly_load_cv_no_races": cv_no_races,
        "load_severity": window_load_severity(breaks, len(d), spike_share, cv),
        "load_severity_no_races": window_load_severity(breaks, len(d), spike_share_no_races, cv_no_races),
        "long_runs_90min": len(long_runs),
        "median_drift_pct": float(long_runs["decouplingPct"].median()) if len(long_runs) else None,
        "z2_gap_pace_s_per_km": float(z2_seconds / z2_metres * 1000) if z2_metres > 0 else None,
    }


def adherence(metrics: dict) -> pd.DataFrame:
    rows = [{"key": key, "criterion": label, "met": bool(test(metrics))} for key, (label, test) in ADHERENCE.items()]
    return pd.DataFrame(rows)


def followed_plan(table: pd.DataFrame) -> bool:
    met = table.set_index("key")["met"]
    return bool(met["no_break"]) and int(met.sum()) >= ADHERENT_MIN


# ── Question 1: training load vs performance ────────────────────────────────


def fit_models(runs: pd.DataFrame, terms: LoadTerms, as_of) -> dict:
    """Every efficiency model, fitted only on runs up to `as_of` and stored as plain numbers."""
    train = runs[runs["localDate"] <= pd.Timestamp(as_of)]
    idx = terms.day_index(train["localDate"])
    X, y = train[COVARIATES].to_numpy(), train["ef"].to_numpy()
    A = np.column_stack([np.ones(len(y)), X])
    cov = np.linalg.lstsq(A, y, rcond=None)[0]
    residual = y - A @ cov
    recent = (train["localDate"] > pd.Timestamp(as_of) - pd.Timedelta(days=FORM_DAYS)).to_numpy()
    single = np.linalg.lstsq(np.column_stack([A, terms.at(SINGLE_TERM_TAU, idx)]), y, rcond=None)[0]
    default = fit_fixed(terms, idx, X, y, *DEFAULT_TAUS)
    fitted = fit_grid(terms, idx, X, y)
    sst = float(((y - y.mean()) ** 2).sum())
    return {
        "n_runs": len(y),
        "r2_covariates": 1 - float(residual @ residual) / sst,
        "r2_fitted": 1 - fitted.sse / sst,
        "covariates": cov.tolist(),
        "recent_form": float(residual[recent].mean()) if recent.any() else 0.0,
        "single_term": {"tau": SINGLE_TERM_TAU, "coef": single.tolist()},
        "default": _fit_dict(default),
        "fitted": _fit_dict(fitted),
    }


def _fit_dict(fit: Fit) -> dict:
    return {"tau1": fit.tau1, "tau2": fit.tau2, "k1": float(fit.k1), "k2": float(fit.k2), "beta": fit.beta.tolist()}


def _fit_from(d: dict) -> Fit:
    return Fit(d["tau1"], d["tau2"], d["k1"], d["k2"], np.array(d["beta"]), float("nan"), 0)


def forecasts(models: dict, runs: pd.DataFrame, terms: LoadTerms) -> pd.DataFrame:
    """The frozen models' forecasts: no refitting, given only each run's covariates and prior load."""
    idx = terms.day_index(runs["localDate"])
    X = runs[COVARIATES].to_numpy()
    A = np.column_stack([np.ones(len(runs)), X])
    covariates = A @ np.array(models["covariates"])
    single = np.column_stack([A, terms.at(models["single_term"]["tau"], idx)]) @ np.array(models["single_term"]["coef"])
    return pd.DataFrame({
        "Covariates only": covariates,
        "Recent form": covariates + models["recent_form"],
        f"One load term (τ={SINGLE_TERM_TAU:.0f})": single,
        "Fitness–fatigue 42/7": predict(_fit_from(models["default"]), terms, idx, X),
        "Fitness–fatigue fitted": predict(_fit_from(models["fitted"]), terms, idx, X),
    }, index=runs.index)


def _resample_weeks(weeks: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Row positions for a bootstrap that resamples whole weeks (runs in one week are correlated)."""
    unique = np.unique(weeks)
    picks = rng.choice(unique, size=len(unique), replace=True)
    return np.concatenate([np.flatnonzero(weeks == w) for w in picks])


def forecast_skill(preds: pd.DataFrame, actual: pd.Series, weeks: pd.Series, seed: int = 0) -> pd.DataFrame:
    """Skill against covariates only, with a week-resampled interval on the mean squared-error difference."""
    rng = np.random.default_rng(seed)
    errors = preds.rsub(actual, axis=0) ** 2
    ref = errors["Covariates only"].to_numpy()
    week_values = weeks.to_numpy()
    rows = []
    for model in errors.columns:
        e = errors[model].to_numpy()
        diff = e - ref
        boots = [diff[_resample_weeks(week_values, rng)].mean() for _ in range(N_BOOT)]
        lo, hi = np.percentile(boots, [2.5, 97.5])
        rows.append({"model": model, "rmse": float(np.sqrt(e.mean())), "bias": float((actual - preds[model]).mean()),
                     "skill_vs_covariates": 1 - e.mean() / ref.mean(), "delta_mse_low": float(lo), "delta_mse_high": float(hi)})
    return pd.DataFrame(rows)


def prior_fortnight(runs: pd.DataFrame, daily: pd.DataFrame) -> pd.Series:
    """TRIMP in the 14 days before each run, excluding the run's own day."""
    cum = np.concatenate([[0.0], np.cumsum(daily["load"].to_numpy())])
    idx = daily.index.get_indexer(runs["localDate"])
    return pd.Series(cum[idx] - cum[np.maximum(idx - 14, 0)], index=runs.index)


def _after_break_flags(runs: pd.DataFrame, daily: pd.DataFrame) -> pd.Series:
    active = daily["activityCount"] > 0
    gap_id = (active != active.shift()).cumsum()
    flags = pd.Series(False, index=runs.index)
    for _, gap in daily[~active].groupby(gap_id[~active]):
        if len(gap) >= BREAK_DAYS:
            end = gap.index[-1]
            flags |= (runs["localDate"] > end) & (runs["localDate"] <= end + pd.Timedelta(days=AFTER_BREAK_DAYS))
    return flags


def dose_response(runs: pd.DataFrame, daily: pd.DataFrame) -> dict:
    """Findings 1's distributed-lag model, in-sample on all data given: the weeks 1–2
    effect on residual efficiency per 100 TRIMP, with and without post-break runs."""
    r = runs.sort_values("localDate").reset_index(drop=True)
    X = sm.add_constant(r[COVARIATES])
    r["resid_ef"] = sm.OLS(r["ef"], X).fit().resid
    cum = np.concatenate([[0.0], np.cumsum(daily["load"].to_numpy())])
    idx = daily.index.get_indexer(r["localDate"])
    cols = []
    for lag in range(1, DOSE_LAGS + 1):
        hi = idx - 7 * (lag - 1)
        lo = np.maximum(idx - 7 * lag, 0)
        r[f"load_w{lag}"] = (cum[np.clip(hi, 0, None)] - cum[lo]) / 100
        cols.append(f"load_w{lag}")
    usable = r[idx >= 7 * DOSE_LAGS]
    after_break = _after_break_flags(usable, daily)

    def fit(frame: pd.DataFrame) -> dict:
        model = sm.OLS(frame["resid_ef"], sm.add_constant(frame[cols])).fit(cov_type="HAC", cov_kwds={"maxlags": DOSE_LAGS})
        test = model.t_test("load_w1 + load_w2 = 0")
        low, high = test.conf_int()[0]
        return {"effect_per_100_trimp": float(model.params[["load_w1", "load_w2"]].sum()), "ci_low": float(low),
                "ci_high": float(high), "p": float(test.pvalue), "n": len(frame)}

    return {"all_runs": fit(usable), "excluding_post_break": fit(usable[~after_break])}


def _level(residual: pd.Series, weeks: pd.Series, rng: np.random.Generator) -> dict:
    n = len(residual)
    if n < MIN_RUNS_FOR_LEVEL:
        return {"n": n, "mean": None, "boots": None}
    values, week_values = residual.to_numpy(), weeks.to_numpy()
    return {"n": n, "mean": float(values.mean()),
            "boots": np.array([values[_resample_weeks(week_values, rng)].mean() for _ in range(N_BOOT)])}


def efficiency_change(models: dict, dose_effect: float, runs: pd.DataFrame, daily: pd.DataFrame, study: Study, seed: int = 0) -> dict:
    """Did efficiency change, net of duration, intensity and terrain, by as much as the load change predicts?

    Levels are residuals from the frozen covariates, and `dose_effect` is the frozen
    effect per 100 TRIMP of the prior fortnight. What the load change doesn't explain
    is compared with the same quantity for last year's windows, the only available
    proxy for season. Last year's raw swing can't be the proxy: it held a long break,
    so it mostly measures load (the rehearsal on winter 2025–26 shows this)."""
    rng = np.random.default_rng(seed)
    A = np.column_stack([np.ones(len(runs)), runs[COVARIATES].to_numpy()])
    residual = runs["ef"] - A @ np.array(models["covariates"])
    fortnight = prior_fortnight(runs, daily)

    def level(window):
        mask = (runs["localDate"] >= window[0]) & (runs["localDate"] <= window[1])
        out = _level(residual[mask], runs.loc[mask, "week"], rng)
        out["fortnight_load"] = float(fortnight[mask].mean()) if mask.any() else None
        out["fortnight_load_sd"] = float(fortnight[mask].std()) if mask.sum() > 1 else None
        return out

    during, before = level(study.window), level(study.before)
    season, season_before = level(study.same_season), level(study.before_same_season)

    def delta(a: dict, b: dict) -> tuple[float | None, np.ndarray | None]:
        if a["mean"] is None or b["mean"] is None:
            return None, None
        return a["mean"] - b["mean"], a["boots"] - b["boots"]

    def summary(value, boots) -> dict:
        if value is None:
            return {"estimate": None, "ci_low": None, "ci_high": None}
        lo, hi = np.percentile(boots, [2.5, 97.5])
        return {"estimate": float(value), "ci_low": float(lo), "ci_high": float(hi)}

    def load_explained(a: dict, b: dict) -> float | None:
        if a["fortnight_load"] is None or b["fortnight_load"] is None:
            return None
        return dose_effect * (a["fortnight_load"] - b["fortnight_load"]) / 100

    def unexplained(value, boots, explained) -> tuple[float | None, np.ndarray | None]:
        if value is None or explained is None:
            return None, None
        return value - explained, boots - explained

    change, change_boots = delta(during, before)
    predicted = load_explained(during, before)
    rest, rest_boots = unexplained(change, change_boots, predicted)
    swing, swing_boots = delta(season, season_before)
    season_rest, season_rest_boots = unexplained(swing, swing_boots, load_explained(season, season_before))
    net = rest - season_rest if rest is not None and season_rest is not None else None
    net_boots = rest_boots - season_rest_boots if net is not None else None
    return {
        "levels": {name: {k: v for k, v in lv.items() if k != "boots"} for name, lv in
                   [("study", during), ("before", before), ("same_season", season), ("before_same_season", season_before)]},
        "change": summary(change, change_boots),
        "predicted_from_load": predicted,
        "unexplained_by_load": summary(rest, rest_boots),
        "last_year_swing": summary(swing, swing_boots),
        "last_year_unexplained_by_load": summary(season_rest, season_rest_boots),
        "unexplained_net_of_last_year": summary(net, net_boots),
    }


# ── Question 2: the bottleneck ──────────────────────────────────────────────


def bottleneck(acts: pd.DataFrame, daily: pd.DataFrame, races: pd.DataFrame, as_of, seed: int = 0) -> dict:
    """The Proposal 2 scorer, unchanged, at `as_of`: each event's ranking, how robust
    the winner is to perturbed thresholds, and the same again without race weeks."""
    ctx = L.Context.at(as_of, acts, daily, races)
    riegel = L.riegel_exponent(ctx.races)

    def ranked(exclude_races: bool) -> dict:
        result = L.assess(ctx, exclude_races=exclude_races, riegel=riegel)
        return {event: L.rank(result[event], event)[["key", "severity", "score", "confidence"]].to_dict("records")
                for event in L.EVENTS}

    rng = np.random.default_rng(seed)
    base_ranking = ranked(False)
    top = {event: base_ranking[event][0]["key"] for event in L.EVENTS}
    wins = dict.fromkeys(L.EVENTS, 0)
    for _ in range(N_PERTURB):
        params, relevance = L.perturbed(rng)
        result = L.assess(ctx, params=params, riegel=riegel)
        for event in L.EVENTS:
            wins[event] += L.rank(result[event], event, relevance).iloc[0]["key"] == top[event]
    load = L.load_management(ctx)
    return {
        "as_of": str(pd.Timestamp(as_of).date()),
        "ranking": base_ranking,
        "ranking_no_races": ranked(True),
        "top": top,
        "top_share_under_perturbation": {event: wins[event] / N_PERTURB for event in L.EVENTS},
        "load_evidence": load.evidence,
        "riegel": riegel and {k: riegel[k] for k in ("b", "ci_low", "ci_high", "n")},
    }


def recompute_acwr(load: pd.Series) -> pd.Series:
    """The app's EWMA ACWR (training-load.ts), for projected load series."""
    acute = chronic = 0.0
    out = []
    for value in load.to_numpy(dtype=float):
        acute = value * 2 / 8 + acute * (1 - 2 / 8)
        chronic = value * 2 / 29 + chronic * (1 - 2 / 29)
        out.append(acute / chronic if chronic > 0 else np.nan)
    return pd.Series(out, index=load.index)


def _projected_daily(daily: pd.DataFrame, study: Study, weekly_load: list[float]) -> pd.DataFrame:
    """`daily` with the weeks up to the study's end filled in: the given weekly load
    from the study's start (three sessions and a weekend long run), nothing before it."""
    split = {1: 0.2, 3: 0.25, 5: 0.15, 6: 0.4}  # day of week → share of the week's load
    last = daily.index.max()
    days = pd.date_range(last + pd.Timedelta(days=1), study.window[1])
    extra = pd.DataFrame(0.0, index=days, columns=["load", "activityCount"])
    for week, load in enumerate(weekly_load):
        monday = study.window[0] + pd.Timedelta(weeks=week)
        for offset, share in split.items():
            day = monday + pd.Timedelta(days=offset)
            if day in extra.index and load > 0:
                extra.loc[day, ["load", "activityCount"]] = [load * share, 1.0]
    out = pd.concat([daily[["load", "activityCount"]], extra])
    out["acwr"] = recompute_acwr(out["load"])
    return out


def plan_week_loads(level: float, weeks: int = 13) -> list[float]:
    """A build with a deload every fourth week, averaging about `level` TRIMP."""
    pattern = [0.95, 1.0, 1.05, 0.75]
    return [level * (1 + 0.015 * w) * pattern[w % 4] for w in range(weeks)]


def rolling_window_floor(acts: pd.DataFrame, daily: pd.DataFrame, races: pd.DataFrame, study: Study, level: float) -> dict:
    """Where the 12-month load score lands by the study's end under a textbook plan,
    and under that plan with a 4-week break. Old breaks and spikes leave the window
    whatever happens, so this separates what time does from what the training earns."""
    plan = plan_week_loads(level, study.weeks)
    interrupted = [0.0 if 5 <= w < 9 else load for w, load in enumerate(plan)]
    end = study.window[1]
    out = {}
    for name, weeks in [("plan_followed", plan), ("plan_with_4_week_break", interrupted)]:
        projected = _projected_daily(daily, study, weeks)
        ctx = L.Context.at(end, acts, projected, races)
        limiter = L.load_management(ctx)
        out[name] = {"severity": limiter.severity, **limiter.evidence}
    return out


# ── Races and recovery ──────────────────────────────────────────────────────


def race_rows(races: pd.DataFrame, acts: pd.DataFrame, start=None, end=None) -> list[dict]:
    r = races.merge(acts[["id", "paceFadePct", "decouplingPct"]], on="id", how="left")
    if start is not None:
        r = r[(r["localDate"] >= pd.Timestamp(start)) & (r["localDate"] <= pd.Timestamp(end))]
    return [{"date": str(row["localDate"].date()), "name": row["name"], "distance_m": row["distance_m"],
             "time_s": row["time_s"], "vdot": float(row["vdot"]),
             "fade_pct": None if pd.isna(row["paceFadePct"]) else float(row["paceFadePct"]),
             "drift_pct": None if pd.isna(row["decouplingPct"]) else float(row["decouplingPct"])}
            for _, row in r.iterrows()]


def recovery_metrics(garmin: pd.DataFrame, start, end) -> dict:
    g = garmin[(garmin["day"] >= pd.Timestamp(start)) & (garmin["day"] <= pd.Timestamp(end))]
    def stat(col: str) -> tuple[float | None, int]:
        values = g[col].dropna() if col in g else pd.Series(dtype=float)
        return (float(values.mean()) if len(values) else None, len(values))
    rhr, rhr_n = stat("resting_heart_rate")
    sleep, sleep_n = stat("sleep_duration_hours")
    stress, stress_n = stat("avg_stress_level")
    return {"resting_hr": rhr, "resting_hr_days": rhr_n, "sleep_hours": sleep, "sleep_days": sleep_n,
            "stress": stress, "stress_days": stress_n}


# ── Freeze and follow up ────────────────────────────────────────────────────


@dataclass
class Frames:
    dataset: dict
    acts: pd.DataFrame
    daily: pd.DataFrame
    races: pd.DataFrame
    runs: pd.DataFrame
    terms: LoadTerms

    @classmethod
    def build(cls, dataset: dict, physiology: dict | None = None) -> "Frames":
        """`physiology` pins HRmax and resting HR for the intensity covariate, so a
        follow-up doesn't move the frozen covariates if the app's values have changed."""
        acts = activities_frame(dataset)
        daily = daily_frame(dataset)
        pinned = {**dataset, "physiology": physiology} if physiology else dataset
        runs = datasets.run_table(pinned, acts).sort_values("localDate").reset_index(drop=True)
        return cls(dataset, acts, daily, datasets.road_races(dataset, acts), runs, LoadTerms(daily["load"]))


def freeze(dataset: dict, garmin: pd.DataFrame, study: Study) -> dict:
    """Everything the follow-up compares against, computed only from data up to the freeze."""
    frozen = truncate(dataset, study.freeze)
    f = Frames.build(frozen)
    first_day = f.daily.index.min()
    blocks = study.reference_blocks(first_day)
    block_rows = [{"start": str(s.date()), "end": str(e.date()), **window_metrics(f.acts, f.daily, f.races, s, e)} for s, e in blocks]
    recent_level = float(window_metrics(f.acts, f.daily, f.races, *study.before)["load_per_week"])
    train = f.runs[f.runs["localDate"] <= pd.Timestamp(study.freeze)]
    models = fit_models(f.runs, f.terms, study.freeze)
    dose = dose_response(f.runs, f.daily)
    p = frozen["physiology"]
    last_year = (pd.Timestamp(study.freeze) - pd.Timedelta(days=L.YEAR_DAYS), study.freeze)
    return {
        "study": {"freeze": study.freeze, "start": study.start, "end": str(study.window[1].date()), "weeks": study.weeks,
                  "before": [str(d.date()) for d in study.before], "same_season": [str(d.date()) for d in study.same_season],
                  "before_same_season": [str(d.date()) for d in study.before_same_season]},
        "data": {"generated_at": dataset.get("generatedAt"), "metrics_version": dataset.get("metricsVersion"),
                 "activities": len(frozen["activities"]), "days": len(frozen["daily"]), "runs_in_models": len(train),
                 "road_races": len(f.races)},
        "physiology": {"hrMax": p["hrMax"], "hrRest": p["hrRest"], "hrRestSource": p.get("hrRestSource"),
                       "trimpCoefficient": p.get("trimpCoefficient"), "z2Band": frozen.get("z2Band")},
        "windows": {"reference_blocks": block_rows},
        "models": models,
        "dose_response": dose,
        "efficiency": efficiency_change(models, dose["all_runs"]["effect_per_100_trimp"], f.runs, f.daily, study),
        "bottleneck": bottleneck(f.acts, f.daily, f.races, study.freeze),
        "window_floor": rolling_window_floor(f.acts, f.daily, f.races, study, recent_level),
        "races": race_rows(f.races, f.acts),
        "recovery": {"before": recovery_metrics(garmin, *study.before),
                     "last_12_months": recovery_metrics(garmin, *last_year)},
    }


def is_complete(dataset: dict, study: Study) -> bool:
    return pd.Timestamp(dataset["today"]) >= study.window[1]


def last_full_day(dataset: dict, study: Study) -> pd.Timestamp:
    """The study's last day, or mid-study the last Sunday: a week still in progress
    would read as a collapse."""
    today = pd.Timestamp(dataset["today"])
    if today >= study.window[1]:
        return study.window[1]
    return today - pd.Timedelta(days=(today.dayofweek + 1) % 7)


def follow_up(baseline: dict, dataset: dict, garmin: pd.DataFrame, study: Study) -> dict:
    """The comparison. Models and thresholds come from `baseline`; nothing is refitted
    for the forecast test. The refits in `refit` are labelled as such."""
    end = last_full_day(dataset, study)
    current = truncate(dataset, str(end.date())) if pd.Timestamp(dataset["today"]) > end else dataset
    f = Frames.build(current, physiology=baseline["physiology"])
    metrics = {
        "study": window_metrics(f.acts, f.daily, f.races, study.window[0], end),
        "before": window_metrics(f.acts, f.daily, f.races, *study.before),
        "same_season": window_metrics(f.acts, f.daily, f.races, *study.same_season),
    }
    held_out = f.runs[(f.runs["localDate"] >= study.window[0]) & (f.runs["localDate"] <= end)]
    preds = forecasts(baseline["models"], held_out, f.terms)
    # Same rows, recomputed now: differences show the app's metrics moved under the study.
    frozen_blocks = {b["start"]: b for b in baseline["windows"]["reference_blocks"]}
    frozen_before = frozen_blocks[str(study.before[0].date())]
    drift = {key: metrics["before"][key] - frozen_before[key]
             for key in ("load_per_week", "low_share", "z2_gap_pace_s_per_km")
             if metrics["before"][key] is not None and frozen_before[key] is not None}
    return {
        "metrics": metrics,
        "adherence": adherence(metrics["study"]),
        "followed_plan": followed_plan(adherence(metrics["study"])),
        "forecast": forecast_skill(preds, held_out["ef"], held_out["week"]) if len(held_out) else None,
        "held_out_runs": len(held_out),
        "efficiency": efficiency_change(baseline["models"], baseline["dose_response"]["all_runs"]["effect_per_100_trimp"],
                                        f.runs, f.daily, study),
        "refit": {"models": fit_models(f.runs, f.terms, end), "dose_response": dose_response(f.runs, f.daily)},
        "bottleneck": bottleneck(f.acts, f.daily, f.races, end),
        "races": race_rows(f.races, f.acts, study.window[0], end),
        "recovery": recovery_metrics(garmin, study.window[0], end),
        "recovery_same_season": recovery_metrics(garmin, *study.same_season),
        "metric_drift": drift,
        "physiology_now": {k: dataset["physiology"].get(k) for k in ("hrMax", "hrRest")},
    }
