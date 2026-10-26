"""Bottleneck identifier (Proposal 2): which part of fitness most limits
performance at a given event, scored transparently from the athlete's data.

Every limiter returns a severity in [0, 1] (0 = no concern, 1 = clearly
limiting), a confidence in [0, 1] from how much data backs it, and the raw
evidence. Each severity is a linear ramp between two reference points kept in
PARAMS, so the sensitivity analysis can perturb every judgment call at once.
Event relevance weights live in RELEVANCE. Both are documented heuristics,
not fitted values — see proposals/02-bottleneck-identifier.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .performance import vdot

EVENTS = ["10K", "Half marathon", "Marathon", "Backyard ultra"]

# A run counts as event-specific long-run preparation at or above this duration.
LONG_RUN_MINUTES = {"10K": 60, "Half marathon": 90, "Marathon": 150, "Backyard ultra": 180}

# How much each limiter matters for each event (0–1). Durability barely matters
# for a 10K and dominates ultras; top-end speed is the reverse.
RELEVANCE = {
    "10K": {"durability": 0.3, "speed": 1.0, "base": 0.6, "intensity": 0.7, "load": 0.8},
    "Half marathon": {"durability": 0.6, "speed": 0.7, "base": 0.8, "intensity": 0.7, "load": 0.8},
    "Marathon": {"durability": 1.0, "speed": 0.4, "base": 1.0, "intensity": 0.6, "load": 0.9},
    "Backyard ultra": {"durability": 1.0, "speed": 0.1, "base": 1.0, "intensity": 0.4, "load": 0.9},
}

# Severity ramps: (value giving severity 0, value giving severity 1).
PARAMS = {
    "decoupling_pct": (5.0, 10.0),  # median drift on 90+ min runs (Friel: <5% well coupled)
    "riegel_endurance": (1.06, 1.12),  # fatigue exponent above typical → fades with distance
    "riegel_speed": (1.06, 1.02),  # below typical → relatively short of speed
    "volume_ratio": (1.0, 0.5),  # recent weekly hours ÷ own best 12-week block
    "long_run_share": (0.75, 0.0),  # share of recent weeks with an event-length long run
    "low_intensity_share": (0.80, 0.60),  # share of HR time in Z1–2 (Seiler ~75–80%)
    "breaks_per_year": (0.0, 3.0),  # 14+ day gaps in the last 12 months
    "acwr_spike_share": (0.0, 0.10),  # share of days with EWMA ACWR > 1.5
    "weekly_load_cv": (0.4, 1.0),  # coefficient of variation of weekly TRIMP
}

RECENT_WEEKS = 12
YEAR_DAYS = 365
MIN_LONG_RUN_MINUTES = 90


def ramp(value: float | None, zero: float, one: float) -> float | None:
    """Linear 0→1 between `zero` and `one` (works for either direction), clipped."""
    if value is None or np.isnan(value):
        return None
    return float(np.clip((value - zero) / (one - zero), 0.0, 1.0))


@dataclass
class Limiter:
    key: str
    label: str
    severity: float | None  # None = not enough data to judge
    confidence: float
    evidence: dict = field(default_factory=dict)
    lever: str = ""


@dataclass
class Context:
    """Everything up to `as_of` — so the same scoring can be replayed at past dates."""

    as_of: pd.Timestamp
    activities: pd.DataFrame  # from data.activities_frame (all types)
    daily: pd.DataFrame  # from data.daily_frame
    races: pd.DataFrame  # from datasets.road_races

    @classmethod
    def at(cls, as_of, activities, daily, races) -> "Context":
        t = pd.Timestamp(as_of)
        return cls(
            as_of=t,
            activities=activities[activities["localDate"] <= t],
            daily=daily[daily.index <= t],
            races=races[races["localDate"] <= t],
        )

    def last(self, days: int, frame: str = "activities") -> pd.DataFrame:
        start = self.as_of - pd.Timedelta(days=days - 1)
        if frame == "daily":
            return self.daily[self.daily.index >= start]
        return self.activities[self.activities["localDate"] >= start]


def _mean(values: list[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return float(np.mean(vals)) if vals else None


# ── Speed–endurance balance ─────────────────────────────────────────────────


def riegel_exponent(races: pd.DataFrame, n_boot: int = 2000, seed: int = 0) -> dict | None:
    """Personal fatigue exponent b in time ∝ distance^b (Riegel 1981; typical
    ~1.06), from road races. log(time) is regressed on log(distance) and years
    elapsed, so fitness changing over time doesn't masquerade as distance
    fatigue. Bootstrap interval over races."""
    r = races.dropna(subset=["distance_m", "time_s"])
    if len(r) < 4 or r["distance_m"].nunique() < 3:
        return None
    years = (r["localDate"] - r["localDate"].min()).dt.days.to_numpy() / 365.25
    X = np.column_stack([np.ones(len(r)), np.log(r["distance_m"].to_numpy()), years])
    y = np.log(r["time_s"].to_numpy())
    b = float(np.linalg.lstsq(X, y, rcond=None)[0][1])
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(n_boot):
        i = rng.integers(0, len(r), len(r))
        if len(np.unique(X[i, 1])) < 3:
            continue
        boots.append(np.linalg.lstsq(X[i], y[i], rcond=None)[0][1])
    lo, hi = np.percentile(boots, [2.5, 97.5])
    return {"b": b, "ci_low": float(lo), "ci_high": float(hi), "n": len(r),
            "distance_span_km": (r["distance_m"].min() / 1000, r["distance_m"].max() / 1000)}


def critical_speed(best_efforts: pd.DataFrame, as_of, days: int = YEAR_DAYS) -> dict | None:
    """Critical speed (CS) and D′ from the 2-parameter linear model
    distance = CS·t + D′ (Jones et al. 2010), using the athlete's best effort at
    each standard distance lasting 2–20 minutes in the last year."""
    t = pd.Timestamp(as_of)
    recent = best_efforts[(best_efforts["local_date"] <= t) & (best_efforts["local_date"] > t - pd.Timedelta(days=days))]
    best = recent.loc[recent.groupby("effort")["elapsed_s"].idxmin()] if len(recent) else recent
    best = best[(best["elapsed_s"] >= 120) & (best["elapsed_s"] <= 1200)]
    if len(best) < 3:
        return None
    slope, intercept = np.polyfit(best["elapsed_s"], best["distance_m"], 1)
    pred = slope * best["elapsed_s"] + intercept
    ss_res = float(((best["distance_m"] - pred) ** 2).sum())
    ss_tot = float(((best["distance_m"] - best["distance_m"].mean()) ** 2).sum())
    return {"cs_m_s": float(slope), "d_prime_m": float(intercept), "r2": 1 - ss_res / ss_tot if ss_tot else 1.0,
            "efforts": best[["effort", "elapsed_s"]].to_dict("records")}


# ── Limiters ────────────────────────────────────────────────────────────────


def durability(ctx: Context, riegel: dict | None, params=PARAMS) -> Limiter:
    long_runs = ctx.last(YEAR_DAYS)
    long_runs = long_runs[(long_runs["type"] == "Run") & (long_runs["movingTimeS"] >= MIN_LONG_RUN_MINUTES * 60)
                          & long_runs["decouplingPct"].notna()]
    median_drift = float(long_runs["decouplingPct"].median()) if len(long_runs) else None
    s_drift = ramp(median_drift, *params["decoupling_pct"])
    s_riegel = ramp(riegel["b"], *params["riegel_endurance"]) if riegel else None
    confidence = min(1.0, len(long_runs) / 10) * 0.6 + (0.4 if riegel else 0.0)
    return Limiter(
        "durability", "Aerobic durability", _mean([s_drift, s_riegel]), round(confidence, 2),
        {"median_drift_pct_90min_plus": median_drift, "long_runs": len(long_runs), "riegel_b": riegel and riegel["b"]},
        "More, and progressively longer, steady long runs; practise race fuelling on them.",
    )


def speed(ctx: Context, riegel: dict | None, params=PARAMS) -> Limiter:
    s = ramp(riegel["b"], *params["riegel_speed"]) if riegel else None
    confidence = min(1.0, riegel["n"] / 10) if riegel else 0.0
    return Limiter(
        "speed", "Speed vs endurance balance", s, round(confidence, 2),
        {"riegel_b": riegel and riegel["b"]},
        "Regular interval and threshold work; shorter races to sharpen speed.",
    )


def base(ctx: Context, event: str, params=PARAMS) -> Limiter:
    runs = ctx.activities[ctx.activities["type"] == "Run"]
    weekly_h = runs.groupby("week")["movingTimeS"].sum() / 3600
    weeks = pd.date_range(ctx.activities["week"].min(), ctx.as_of, freq="W-MON") if len(runs) else []
    weekly_h = weekly_h.reindex(weeks, fill_value=0.0)
    rolling = weekly_h.rolling(RECENT_WEEKS).mean()
    current = float(rolling.iloc[-1]) if len(rolling.dropna()) else None
    peak = float(rolling.max()) if len(rolling.dropna()) else None
    ratio = current / peak if current is not None and peak else None

    recent = runs[runs["localDate"] > ctx.as_of - pd.Timedelta(weeks=RECENT_WEEKS)]
    long_weeks = recent[recent["movingTimeS"] >= LONG_RUN_MINUTES[event] * 60]["week"].nunique()
    share = long_weeks / RECENT_WEEKS
    severity = _mean([ramp(ratio, *params["volume_ratio"]), ramp(share, *params["long_run_share"])])
    confidence = min(1.0, len(weekly_h) / 52)
    return Limiter(
        "base", "Aerobic base and long runs", severity, round(confidence, 2),
        {"weekly_hours_last_12wk": current, "best_12wk_weekly_hours": peak, "volume_ratio": ratio,
         f"weeks_with_{LONG_RUN_MINUTES[event]}min_run": f"{long_weeks}/{RECENT_WEEKS}"},
        f"Build steady weekly volume and a regular {LONG_RUN_MINUTES[event]}+ minute long run.",
    )


def intensity(ctx: Context, params=PARAMS) -> Limiter:
    recent = ctx.last(RECENT_WEEKS * 7)
    zones = [z for z in recent["zoneMinutes"] if isinstance(z, list)]
    minutes = np.zeros(5)
    for z in zones:
        minutes += np.array([b["minutes"] for b in z])
    total = minutes.sum()
    low = (minutes[0] + minutes[1]) / total if total > 0 else None
    confidence = min(1.0, total / (RECENT_WEEKS * 180))  # ~3 h of HR time a week = full confidence
    return Limiter(
        "intensity", "Intensity distribution", ramp(low, *params["low_intensity_share"]), round(confidence, 2),
        {"low_share_z1_z2": low, "moderate_share_z3": minutes[2] / total if total else None,
         "high_share_z4_z5": (minutes[3] + minutes[4]) / total if total else None},
        "Make easy days genuinely easy (Z1–2) so quality sessions can be harder.",
    )


RACE_RECOVERY_DAYS = 7


def race_window_days(ctx: Context) -> pd.DatetimeIndex:
    """Each tagged race (any distance, ultras included) plus the week after it."""
    if "workoutType" not in ctx.activities:
        return pd.DatetimeIndex([])
    races = ctx.activities.loc[ctx.activities["workoutType"] == 1, "localDate"]
    days = [d + pd.Timedelta(days=i) for d in races for i in range(RACE_RECOVERY_DAYS + 1)]
    return pd.DatetimeIndex(days).unique()


def load_management(ctx: Context, params=PARAMS, exclude_races: bool = False) -> Limiter:
    """`exclude_races` is a robustness check: a race is a deliberate load spike
    (an ultra especially), so spikes and uneven weeks are re-measured without
    race days, the week after each race, or weeks containing a race."""
    daily = ctx.last(YEAR_DAYS, "daily")
    active = daily["activityCount"] > 0
    run_id = (active != active.shift()).cumsum()
    gaps = daily[~active].groupby(run_id[~active]).size()
    breaks = int((gaps >= 14).sum())
    measured = daily
    if exclude_races:
        measured = daily[~daily.index.isin(race_window_days(ctx))]
    spike_share = float((measured["acwr"] > 1.5).mean()) if len(measured) else None
    weekly = daily["load"].resample("W-MON", label="left", closed="left").sum()
    if exclude_races:
        race_weeks = {d - pd.Timedelta(days=d.dayofweek) for d in race_window_days(ctx)}
        weekly = weekly[~weekly.index.isin(list(race_weeks))]
    cv = float(weekly.std() / weekly.mean()) if len(weekly) > 4 and weekly.mean() > 0 else None
    severity = _mean([
        ramp(breaks, *params["breaks_per_year"]),
        ramp(spike_share, *params["acwr_spike_share"]),
        ramp(cv, *params["weekly_load_cv"]),
    ])
    confidence = min(1.0, len(daily) / YEAR_DAYS)
    return Limiter(
        "load", "Load management and consistency", severity, round(confidence, 2),
        {"breaks_14d_plus": breaks, "acwr_spike_day_share": spike_share, "weekly_load_cv": cv},
        "Steadier weeks: avoid big jumps (ACWR > 1.5), plan deloads instead of forced breaks.",
    )


_UNSET = object()


def assess(ctx: Context, params=PARAMS, exclude_races: bool = False, riegel=_UNSET) -> dict[str, list[Limiter]]:
    """Limiters for every event; event-independent ones are computed once.
    Pass a precomputed `riegel` fit to skip its bootstrap (e.g. when re-scoring
    many perturbed parameter sets on the same data)."""
    if riegel is _UNSET:
        riegel = riegel_exponent(ctx.races)
    shared = [
        durability(ctx, riegel, params),
        speed(ctx, riegel, params),
        intensity(ctx, params),
        load_management(ctx, params, exclude_races),
    ]
    return {event: shared + [base(ctx, event, params)] for event in EVENTS}


def rank(limiters: list[Limiter], event: str, relevance=RELEVANCE) -> pd.DataFrame:
    rows = [{
        "limiter": l.label, "key": l.key, "severity": l.severity, "relevance": relevance[event][l.key],
        "score": None if l.severity is None else l.severity * relevance[event][l.key],
        "confidence": l.confidence,
    } for l in limiters]
    df = pd.DataFrame(rows)
    return df.sort_values("score", ascending=False, na_position="last").reset_index(drop=True)


def perturbed(rng: np.random.Generator, spread: float = 0.2):
    """PARAMS and RELEVANCE with every judgment call jittered.

    Ramp endpoints move by up to ±spread of their ramp's *width* (scaling the
    value itself would be meaningless for, say, a Riegel exponent of 1.06,
    and could flip a ramp's direction). Relevance weights scale by
    U(1−spread, 1+spread), capped at 1."""
    params = {}
    for k, (zero, one) in PARAMS.items():
        width = abs(one - zero)
        params[k] = (zero + rng.uniform(-spread, spread) * width, one + rng.uniform(-spread, spread) * width)
    relevance = {e: {k: min(1.0, w * rng.uniform(1 - spread, 1 + spread)) for k, w in ws.items()} for e, ws in RELEVANCE.items()}
    return params, relevance


def race_vdots(races: pd.DataFrame) -> pd.Series:
    return pd.Series([vdot(d, t) for d, t in zip(races["distance_m"], races["time_s"])], index=races.index)
