"""Builds notebooks/01a-performance-index.ipynb. Edit cells here, then run:

    .venv\\Scripts\\python notebooks\\build_01a_performance_index.py
    .venv\\Scripts\\jupyter nbconvert --to notebook --execute --inplace notebooks\\01a-performance-index.ipynb
"""

from pathlib import Path

import nbformat as nbf

md = nbf.v4.new_markdown_cell
code = nbf.v4.new_code_cell

cells = [
    md(
        """# 01a — Performance measures

Proposal 1 needs two performance measures (see the
[proposal](../proposals/01-training-load-vs-performance.md) and the
[data audit](00-data-audit.ipynb)):

- **Per-run efficiency factor (EF)**: dense — one value per run — but submaximal
  and noisy. The model's target.
- **Race VDOT**: sparse but maximal. Held out entirely, as an independent check.

This notebook builds both, and checks what drives EF before any load term is added."""
    ),
    code(
        """import sys
sys.path.insert(0, "..")

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import statsmodels.formula.api as smf

from goalsplit_research import data, datasets

pd.set_option("display.width", 140)
plt.rcParams.update({"figure.figsize": (11, 3.2), "axes.spines.top": False, "axes.spines.right": False})

ds = data.fetch_dataset()
acts = data.activities_frame(ds)
runs = datasets.run_table(ds, acts)
races = datasets.road_races(ds, acts)
print(f"{len(runs)} runs between 20 min and 4 h with an efficiency factor")
print(f"{len(races)} road races (tagged, not hilly, ≤ 43 km, average HR ≥ 80% of max)")"""
    ),
    md(
        """## Race VDOT

Distance comes from the race title when it states one, else the nearest standard
distance (if GPS is within ±6%), else GPS. Time is an official time written in
brackets in the title, else moving time. Rows where distance was *not* read from
the title rest on an assumption, flagged below."""
    ),
    code(
        """table = races.assign(
    km=(races["distance_m"] / 1000).round(2),
    time=pd.to_timedelta(races["time_s"], unit="s").astype(str).str[-8:],
    vdot=races["vdot"].round(1),
)
print(table[["localDate", "name", "km", "distance_source", "time", "time_source", "vdot"]].to_string(index=False))

assumed = table[table["distance_source"] != "name"]
print(f"\\nDistance assumed (not in title) for {len(assumed)} races:", ", ".join(
    f"{d:%d %b %Y} {n}" for d, n in zip(assumed["localDate"], assumed["name"])))"""
    ),
    code(
        """fig, ax = plt.subplots()
for label, group in races.groupby(pd.cut(races["distance_m"], [0, 7500, 15000, 30000, 50000],
                                           labels=["≤7.5 km", "10 km", "half / 20–30 km", "marathon"]), observed=True):
    ax.scatter(group["localDate"], group["vdot"], label=label, s=40)
ax.set_title("Race VDOT over time")
ax.set_ylabel("VDOT")
ax.legend(frameon=False)
plt.show()
print(f"VDOT range {races['vdot'].min():.1f}–{races['vdot'].max():.1f}, SD {races['vdot'].std():.1f}")"""
    ),
    md(
        """## What drives per-run EF (before any load term)

If EF mostly reflects *how* a run was done (duration, terrain, intensity), those
must be controlled for, or the load model will be fitting run mix rather than
fitness. Heteroskedasticity- and autocorrelation-robust (HAC) standard errors,
because consecutive runs aren't independent."""
    ),
    code(
        """base = smf.ols("ef ~ intensity + log_hours + hilly", data=runs).fit(cov_type="HAC", cov_kwds={"maxlags": 4})
print(base.summary().tables[1])
print(f"R² = {base.rsquared:.3f} · residual SD = {np.sqrt(base.scale):.4f} · EF SD = {runs['ef'].std():.4f}")

fig, axes = plt.subplots(1, 3, figsize=(11, 3))
for ax, col, label in zip(axes, ["log_hours", "intensity", "hilly"], ["log hours", "fraction of HR reserve", "hilly (0/1)"]):
    jitter = np.random.default_rng(0).normal(0, 0.03, len(runs)) if col == "hilly" else 0
    ax.scatter(runs[col] + jitter, runs["ef"], s=8, alpha=0.5)
    ax.set_xlabel(label)
axes[0].set_ylabel("EF")
plt.tight_layout()
plt.show()"""
    ),
    code(
        """# Residual EF over time: what's left for training load to explain.
runs["ef_resid"] = base.resid
roll = runs.set_index("localDate")["ef_resid"].rolling("56D").mean()
ax = runs.plot.scatter(x="localDate", y="ef_resid", s=8, alpha=0.4)
roll.plot(ax=ax, color="#d97706", label="8-week rolling mean")
ax.axhline(0, color="#a3a3a3", lw=1)
ax.set_title("EF after removing duration, intensity and terrain")
ax.set_xlabel(""); ax.legend(frameon=False)
plt.show()
print(f"SD of the 8-week rolling mean (slow-moving signal): {roll.std():.4f}")
print(f"Residual SD per run (noise):                       {runs['ef_resid'].std():.4f}")"""
    ),
    md(
        """## Conclusions

**Race VDOT.** 15 road races qualify, VDOT 40.9–52.6 (SD 3.2). The best are Pisa 10k
(Oct 2025, 52.6), Lucca Parkrun (Aug 2025, 50.8) and the Firenze Half (Mar 2026, 50.4).
Five races' distances are assumed rather than read from the title (two "Morning Run"
half-distance races, Pisa 10 2024, the Wedding Run and Wing for Life), so naming races
with their distance would remove that assumption.

**What drives per-run EF.** Duration dominates: efficiency drops about 0.08 per
log-hour. Hilly runs are about 0.11 less efficient *even after grade adjustment*,
which suggests Minetti GAP under-credits trail and technical terrain. Intensity has
no detectable effect once duration is controlled for. The three covariates explain
26% of EF variance.

**Enough signal remains for a load model.** After removing those effects, the slow
8-week trend has an SD of 0.049 against per-run noise of 0.075. Run-level modelling
can see a trend that weekly medians drowned in noise."""
    ),
]

nb = nbf.v4.new_notebook(cells=cells, metadata={"kernelspec": {"name": "python3", "display_name": "Python 3"}})
out = Path(__file__).with_name("01a-performance-index.ipynb")
nbf.write(nb, out)
print(f"wrote {out}")
