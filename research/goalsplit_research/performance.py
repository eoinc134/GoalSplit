"""Performance measures."""

import numpy as np


def vdot(distance_m: float, time_s: float) -> float:
    """Daniels & Gilbert (1979) VDOT: the VO2max implied by a race performance.

    VO2 demand of the pace, divided by the fraction of VO2max sustainable for
    that duration — so a 10 km and a half marathon land on one scale.
    """
    t = time_s / 60  # minutes
    v = distance_m / t  # metres per minute
    vo2 = -4.60 + 0.182258 * v + 0.000104 * v**2
    pct_max = 0.8 + 0.1894393 * np.exp(-0.012778 * t) + 0.2989558 * np.exp(-0.1932605 * t)
    return vo2 / pct_max


def robust_noise_sd(values) -> float:
    """Week-to-week noise from first differences (MAD-based) — the same
    estimator the app's change-point detection uses."""
    x = np.asarray(values, dtype=float)
    x = x[~np.isnan(x)]
    if len(x) < 3:
        return float("nan")
    d = np.diff(x)
    mad = np.median(np.abs(d - np.median(d)))
    return mad / 0.6745 / np.sqrt(2)
