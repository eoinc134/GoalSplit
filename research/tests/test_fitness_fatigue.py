import numpy as np
import pandas as pd

from goalsplit_research.fitness_fatigue import (
    LoadTerms,
    Fit,
    fit_grid,
    impulse_series,
    moving_block_indices,
    predict,
)
from goalsplit_research.performance import vdot


def test_impulse_series_excludes_the_same_day_and_decays():
    f = impulse_series(np.array([10.0, 0.0, 0.0]), tau=1.0)
    assert f[0] == 0.0  # today's load never counts towards today
    assert np.isclose(f[1], 10 * np.exp(-1))
    assert np.isclose(f[2], 10 * np.exp(-2))


def test_grid_fit_recovers_known_time_constants():
    rng = np.random.default_rng(0)
    days = pd.date_range("2024-01-01", periods=600, freq="D")
    load = pd.Series(rng.gamma(2, 30, len(days)) * (rng.random(len(days)) < 0.7), index=days)
    terms = LoadTerms(load)
    run_idx = np.sort(rng.choice(np.arange(60, 600), size=250, replace=False))
    X = rng.normal(size=(250, 1))
    y = 1.0 + 0.05 * X[:, 0] + 0.002 * terms.at(30, run_idx) - 0.004 * terms.at(6, run_idx)
    y += rng.normal(scale=0.005, size=250)

    fit = fit_grid(terms, run_idx, X, y)

    assert abs(fit.tau1 - 30) <= 4
    assert abs(fit.tau2 - 6) <= 2
    assert np.allclose(predict(fit, terms, run_idx, X), y, atol=0.03)


def test_time_to_peak_matches_the_closed_form_and_handles_no_peak():
    fit = Fit(tau1=40, tau2=8, k1=1.0, k2=2.0, beta=np.array([0.0]), sse=0, n=1)
    expected = 40 * 8 / 32 * np.log(2 * 40 / 8)
    assert np.isclose(fit.time_to_peak(), expected)
    assert Fit(tau1=40, tau2=8, k1=1.0, k2=0.1, beta=np.array([0.0]), sse=0, n=1).time_to_peak() is None


def test_moving_block_bootstrap_keeps_blocks_contiguous():
    idx = moving_block_indices(20, 5, np.random.default_rng(1))
    assert len(idx) == 20
    assert all(np.diff(idx[:5]) == 1)


def test_vdot_matches_daniels_tables():
    assert round(vdot(5000, 20 * 60), 1) == 49.8
    assert round(vdot(42195, 3 * 3600), 1) == 53.5


def test_race_distance_prefers_the_title_over_gps():
    from goalsplit_research.datasets import race_distance, official_time_from_name

    assert race_distance("Pisa 10k", 10_672.7) == (10_000.0, "name")
    assert race_distance("Firenze Half Marathon", 21_137.3) == (21_097.5, "name")
    assert race_distance("Lucca Parkrun", 5_035.9) == (5_000.0, "name")
    assert race_distance("Pisa walls 7k", 7_562.1) == (7_000.0, "name")
    assert race_distance("Morning Run", 20_335.3) == (21_097.5, "nearest standard")
    assert race_distance("Wing for Life", 28_082.9) == (28_082.9, "GPS")
    assert official_time_from_name("Pisa 10 - Forgot to stop my watch (47:50)") == 47 * 60 + 50
    assert official_time_from_name("Venice Marathon (3:31:05)") == 3 * 3600 + 31 * 60 + 5
    assert official_time_from_name("Easy 10k") is None
