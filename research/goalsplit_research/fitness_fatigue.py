"""Individual fitness–fatigue (Banister impulse-response) model, fitted per run.

    performance_i = covariates_i·β + k1·F(t_i; τ1) − k2·F(t_i; τ2) + ε_i

F(t; τ) = Σ_{s<t} load_s · e^{−(t−s)/τ} is an exponentially decaying sum of past
daily load, using only days *before* the run so the run's own heart rate never
feeds its own load term. For fixed (τ1, τ2) the model is linear, so τ is found
by grid search with bounded least squares (k1, k2 ≥ 0) at each grid point —
no nonlinear optimiser, no local minima (Clarke & Skiba, 2013).
"""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import lsq_linear

# Wide enough that a best fit on the edge would be a real finding, not a
# search-range artefact (an earlier 10–90 day grid put τ₁ on its lower edge).
TAU1_GRID = np.arange(2, 91, 2, dtype=float)  # fitness: 2–90 days
TAU2_GRID = np.arange(1, 31, 1, dtype=float)  # fatigue: 1–30 days


def impulse_series(load: np.ndarray, tau: float) -> np.ndarray:
    """F[t] = Σ_{s<t} load[s]·e^{−(t−s)/τ} for each day t."""
    decay = np.exp(-1.0 / tau)
    out = np.empty(len(load))
    acc = 0.0
    for t, w in enumerate(load):
        out[t] = acc
        acc = (acc + w) * decay
    return out


@dataclass
class Fit:
    tau1: float
    tau2: float
    k1: float
    k2: float
    beta: np.ndarray  # intercept first, then covariates in column order
    sse: float
    n: int
    surface: pd.DataFrame | None = field(default=None, repr=False)  # SSE over the (τ1, τ2) grid

    def time_to_peak(self) -> float | None:
        """Days from a training bout to its peak net positive effect:
        τ1τ2/(τ1−τ2)·ln(k2τ1 / (k1τ2)). None when the model implies no peak
        (fatigue too small to ever dominate, or k1 = 0)."""
        if self.k1 <= 0 or self.k2 <= 0 or self.tau1 <= self.tau2:
            return None
        ratio = (self.k2 * self.tau1) / (self.k1 * self.tau2)
        if ratio <= 1:
            return None
        return self.tau1 * self.tau2 / (self.tau1 - self.tau2) * np.log(ratio)


class LoadTerms:
    """Caches F(t; τ) per τ so grid searches and bootstraps don't recompute it."""

    def __init__(self, daily_load: pd.Series):
        self.dates = daily_load.index
        self.load = daily_load.to_numpy(dtype=float)
        self._cache: dict[float, np.ndarray] = {}

    def series(self, tau: float) -> np.ndarray:
        if tau not in self._cache:
            self._cache[tau] = impulse_series(self.load, tau)
        return self._cache[tau]

    def at(self, tau: float, day_idx: np.ndarray) -> np.ndarray:
        return self.series(tau)[day_idx]

    def day_index(self, dates: pd.Series) -> np.ndarray:
        return self.dates.get_indexer(pd.to_datetime(dates).dt.normalize())


def _solve(X: np.ndarray, f1: np.ndarray, f2: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, float]:
    """Bounded least squares on [1, X, F1, −F2] with the last two coefficients ≥ 0."""
    A = np.column_stack([np.ones(len(y)), X, f1, -f2])
    lower = np.full(A.shape[1], -np.inf)
    lower[-2:] = 0.0
    res = lsq_linear(A, y, bounds=(lower, np.full(A.shape[1], np.inf)), method="bvls")
    resid = y - A @ res.x
    return res.x, float(resid @ resid)


def fit_fixed(terms: LoadTerms, day_idx, X, y, tau1: float, tau2: float) -> Fit:
    coef, sse = _solve(X, terms.at(tau1, day_idx), terms.at(tau2, day_idx), y)
    return Fit(tau1, tau2, coef[-2], coef[-1], coef[:-2], sse, len(y))


def fit_grid(terms: LoadTerms, day_idx, X, y, tau1_grid=TAU1_GRID, tau2_grid=TAU2_GRID, keep_surface=False) -> Fit:
    best: Fit | None = None
    rows = []
    for t1 in tau1_grid:
        for t2 in tau2_grid:
            if t2 >= t1:
                continue
            fit = fit_fixed(terms, day_idx, X, y, t1, t2)
            if keep_surface:
                rows.append((t1, t2, fit.sse))
            if best is None or fit.sse < best.sse:
                best = fit
    assert best is not None
    if keep_surface:
        best.surface = pd.DataFrame(rows, columns=["tau1", "tau2", "sse"])
    return best


def predict(fit: Fit, terms: LoadTerms, day_idx, X) -> np.ndarray:
    A = np.column_stack([np.ones(len(day_idx)), X])
    return A @ fit.beta + fit.k1 * terms.at(fit.tau1, day_idx) - fit.k2 * terms.at(fit.tau2, day_idx)


def ols_predict(X_train, y_train, X_test) -> np.ndarray:
    """Plain least squares with an intercept — the covariates-only baseline."""
    A = np.column_stack([np.ones(len(y_train)), X_train])
    coef, *_ = np.linalg.lstsq(A, y_train, rcond=None)
    return np.column_stack([np.ones(len(X_test)), X_test]) @ coef


def moving_block_indices(n: int, block: int, rng: np.random.Generator) -> np.ndarray:
    """Künsch (1989) moving-block bootstrap: concatenate random contiguous
    blocks until n observations, preserving short-range autocorrelation."""
    starts = rng.integers(0, n - block + 1, size=int(np.ceil(n / block)))
    return np.concatenate([np.arange(s, s + block) for s in starts])[:n]
