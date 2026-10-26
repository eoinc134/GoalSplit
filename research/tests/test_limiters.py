import numpy as np
import pandas as pd

from goalsplit_research.limiters import (
    EVENTS,
    PARAMS,
    Context,
    assess,
    critical_speed,
    perturbed,
    ramp,
    rank,
    riegel_exponent,
)


def test_ramp_handles_both_directions_and_clips():
    assert ramp(7.5, 5, 10) == 0.5
    assert ramp(20, 5, 10) == 1.0
    assert abs(ramp(0.7, 0.8, 0.6) - 0.5) < 1e-9  # falling ramp: lower is worse
    assert ramp(None, 0, 1) is None


def races_with_exponent(b: float) -> pd.DataFrame:
    dists = np.array([5000, 10000, 21097.5, 42195, 5000, 10000])
    base_t = 1200 * (dists / 5000) ** b
    return pd.DataFrame({
        "localDate": pd.to_datetime(["2025-03-01", "2025-04-01", "2025-05-01", "2025-06-01", "2025-07-01", "2025-08-01"]),
        "distance_m": dists,
        "time_s": base_t,
    })


def test_riegel_recovers_a_known_exponent():
    fit = riegel_exponent(races_with_exponent(1.10), n_boot=200)
    assert abs(fit["b"] - 1.10) < 1e-6
    assert fit["ci_low"] <= fit["b"] <= fit["ci_high"]


def test_riegel_needs_enough_distinct_distances():
    r = races_with_exponent(1.06)
    assert riegel_exponent(r[r["distance_m"] == 5000]) is None


def test_critical_speed_fits_the_linear_distance_time_model():
    cs, dprime = 4.0, 200.0
    efforts = pd.DataFrame({
        "effort": ["1K", "1 mile", "2 mile", "5K"],
        "distance_m": [1000.0, 1609.0, 3219.0, 5000.0],
        "local_date": pd.to_datetime(["2026-06-01"] * 4),
    })
    efforts["elapsed_s"] = (efforts["distance_m"] - dprime) / cs
    fit = critical_speed(efforts, "2026-10-01")
    assert abs(fit["cs_m_s"] - cs) < 1e-6
    assert abs(fit["d_prime_m"] - dprime) < 1e-4


def test_perturbation_keeps_every_ramp_pointing_the_same_way():
    rng = np.random.default_rng(1)
    for _ in range(200):
        params, relevance = perturbed(rng)
        for k, (zero, one) in params.items():
            z0, o0 = PARAMS[k]
            assert np.sign(one - zero) == np.sign(o0 - z0), k
        assert all(0 <= w <= 1 for ws in relevance.values() for w in ws.values())


def synthetic_context(consistent: bool) -> Context:
    days = pd.date_range("2025-10-01", "2026-09-30", freq="D")
    rng = np.random.default_rng(0)
    load = np.where(rng.random(len(days)) < 0.6, 80.0, 0.0)
    if not consistent:
        load[60:90] = 0  # a month-long break
        load[200:230] = 0
        load[150:160] = 400  # a spike
    daily = pd.DataFrame({"load": load, "activityCount": (load > 0).astype(int), "acwr": 1.0}, index=days)
    if not consistent:
        daily.iloc[150:160, daily.columns.get_loc("acwr")] = 2.0
    runs = []
    for d, l in zip(days, load):
        if l > 0:
            runs.append({
                "localDate": d, "type": "Run", "movingTimeS": 3600 * (2 if d.dayofweek == 6 else 1),
                "decouplingPct": 4.0 if d.dayofweek == 6 else None,
                "zoneMinutes": [{"zone": z, "minutes": m} for z, m in zip(range(1, 6), [40, 30, 10, 5, 0])],
            })
    acts = pd.DataFrame(runs)
    acts["week"] = acts["localDate"].dt.to_period("W-SUN").dt.start_time
    return Context.at("2026-09-30", acts, daily, races_with_exponent(1.06))


def test_load_management_flags_breaks_and_spikes():
    steady = {l.key: l for l in assess(synthetic_context(True))["Marathon"]}
    bumpy = {l.key: l for l in assess(synthetic_context(False))["Marathon"]}
    assert bumpy["load"].severity > steady["load"].severity + 0.3
    assert bumpy["load"].evidence["breaks_14d_plus"] >= 2


def test_ranking_weights_by_event_relevance():
    limiters = assess(synthetic_context(False))
    assert set(limiters) == set(EVENTS)
    table = rank(limiters["Marathon"], "Marathon")
    assert list(table.columns[:4]) == ["limiter", "key", "severity", "relevance"]
    scored = table.dropna(subset=["score"])
    assert (scored["score"].diff().dropna() <= 1e-12).all()  # sorted, highest first
