# Findings 1: Training load vs performance

> **Question:** Does my training load predict my performance, and on what timescale?
> How long does fitness from training last for me, and how long does fatigue take
> to clear?

**Short answer.** Training over the previous **two weeks** is clearly associated with
running efficiency: a heavy fortnight goes with running about 4–5% more efficiently
than a light one, roughly 13–18 s/km faster at the same heart rate. But that link
only modestly improves forecasts, and part of it is reverse causation: efficiency is
already falling *before* training breaks. The classic two-component
fitness–fatigue model doesn't fit this data better than a single load term, and its
personal time constants can't be pinned down. My data supports **"recent
consistency matters"**, not a precise individual fitness–fatigue curve.

Proposal: [01-training-load-vs-performance.md](../proposals/01-training-load-vs-performance.md) ·
Notebooks: [00 audit](../notebooks/00-data-audit.ipynb),
[01a performance](../notebooks/01a-performance-index.ipynb),
[01b model fit](../notebooks/01b-fitness-fatigue-fit.ipynb),
[01c dose–response](../notebooks/01c-dose-response.ipynb)

## Data

- **Athlete:** one recreational runner (HRmax 214, resting HR 46), Feb 2024 to Oct 2026.
- **Training:** 219 activities over 986 days, all with second-by-second streams.
  Daily load is Banister TRIMP; heart rate is recorded from April 2024.
- **Performance, submaximal:** efficiency factor (grade-adjusted speed ÷ heart rate)
  of 192 runs lasting 20 min to 4 h.
- **Performance, maximal:** VDOT of 15 road races (5 km to marathon), held out of
  every fit.
- **Exclusions:** trail and ultra races (VDOT assumes flat road racing), runs without
  heart rate, and Garmin data (13 days, no HRV).

## Method

1. **Data audit:** weekly-median efficiency turned out to be mostly noise
   (signal-to-noise 0.5–0.8), so each run became an observation instead of each week.
2. **Covariates first:** duration, intensity (fraction of heart-rate reserve) and a
   hilly-terrain flag explain 26% of per-run efficiency, before any load term.
3. **Individual fitness–fatigue model:** `EF = covariates + k₁·fitness(τ₁) −
   k₂·fatigue(τ₂)`. Time constants are grid-searched over τ₁ 2–90 days and τ₂ 1–30
   days, using only load from days *before* each run.
4. **Identifiability check:** a parametric bootstrap asking whether this much data
   could recover τ even if the model were exactly true.
5. **Out-of-sample evaluation:** 14 rolling 28-day forecast windows (112 held-out
   runs), against covariates-only, recent-form, CTL-only and textbook (42/7) models.
   Fold-level bootstrap intervals on the difference in forecast error.
6. **Dose–response and reverse causation:**
   - distributed-lag regression over 8 weekly load lags, with HAC (Newey–West) errors
   - the same with post-break runs excluded
   - weekly tests in both directions (efficiency → next week's load, and the reverse)
   - efficiency around the 10 training breaks of 14+ days

## Results

| Hypothesis | Result |
|---|---|
| **H1: a fitted model predicts held-out performance better than baselines** | **Weak.** Every load model cuts squared forecast error by 9–10% against covariates alone, but no 95% interval excludes zero, and a plain "recent form" baseline gets 8%. |
| **H2: my time constants differ from the 42 / 7-day defaults** | **Not supported.** Fitted constants forecast no better than textbook ones (skill 0.094 vs 0.101). The data can't tell them apart. |
| **H3: rising load is followed by efficiency gains** | **Supported, at a two-week lag, not 4–8 weeks.** +0.014 EF per 100 TRIMP over the prior fortnight (p = 0.009). |

Key findings:

- **One load effect, not two.** The two-component model collapses (τ₁ = 10, τ₂ = 9
  days). A single positive load term with τ = 13 days fits identically (R² 0.425
  against 0.263 for covariates alone). No separate fatigue effect is detectable, so
  the model gives no time-to-peak and no taper length.
- **Weakly identified.** The error surface is almost flat in τ₂: a true τ₂ of 9 days
  is recovered with a median of 2. Block-bootstrap τ₁ ranges from 2 to 28 days.
- **Practical size.** From a light fortnight (about 300 TRIMP, the 25th percentile)
  to a heavy one (about 740, the 75th) goes with about +5% efficiency, about 18 s/km
  at 150 bpm. Excluding post-break runs: about +4% (13 s/km). Treat both as upper
  bounds, given the reverse-causation evidence below.
- **Breaks drive part of it.** Excluding runs in the three weeks after a break shrinks
  the two-week effect by about a quarter (p = 0.06), though the lags stay jointly
  significant (p = 0.001).
- **Efficiency drops before breaks.** Runs in the six weeks *before* a break average
  −0.024 residual EF (± 0.012), and −0.036 (± 0.010) after. Something lowers
  efficiency before training stops.
- **Races agree, weakly.** Race VDOT correlates positively with race-day load state
  (ρ ≈ +0.2 to +0.3), but n = 15 gives intervals from −0.3 to +0.7.

## Interpretation

- **Two mechanisms fit the evidence together:**
  - a short-term training effect, where efficiency tracks the last fortnight's work
  - reverse causation, where illness, fatigue or life stress lowers efficiency
    before training stops, and breaks then cause detraining
- **Measurement artefact ruled out.** Shared heart-rate measurement would bias the
  link *negative* (a high-HR day raises TRIMP but lowers EF), so it can't explain a
  positive association.
- **Consistent with the literature.** The fitness–fatigue model's poor out-of-sample
  value and unstable parameters match Hellard et al. (2006). With one athlete and
  noisy submaximal performance data, separate fitness and fatigue components aren't
  identifiable.

**What it means in practice:**
- **Prioritise consistency.** Efficiency follows the last two weeks of training, so
  keeping consistent fortnights matters more than isolated big weeks.
- **Watch for efficiency dips.** An unexplained drop in efficiency over a couple of
  weeks has, in this history, tended to precede a break. That's worth noticing,
  though not proof of anything.
- **Don't trust textbook constants.** The app's 42/7-day fitness and fatigue lines
  are fine as descriptions, but this data doesn't support personal constants for
  predicting performance, or a model-derived taper length.

## Limitations

- **One athlete,** about 2.5 years and 15 qualifying races: within-person,
  exploratory associations only.
- **Submaximal performance measure.** Efficiency factor depends on heart rate, which
  varies with heat, hydration, sleep and sensor quality. The watch records no
  temperature, so heat is uncontrolled.
- **Uniform effect.** Race-day fatigue (e.g. the Pisa 10k 15 days after a 115 km
  backyard ultra) and changing goals (road racing to ultra training) aren't modelled
  separately.
- **Early load undercounted.** Heart rate starts in April 2024, so load in its
  first weeks is slightly undercounted.
- **No illness or injury record.** Breaks are detected from inactivity alone.

## What would make this stronger

- **Race titles with distance and official time** (e.g. "Pisa 10k (44:25)"), removing
  the GPS-based distance assumptions for 5 of the 15 races.
- **A note on why each break happened** (illness, injury, travel, rest), so the
  reverse-causation question can be tested directly.
- **RPE on every run,** giving a load measure that doesn't depend on heart rate.
- **A watch with overnight HRV,** for a recovery signal that's independent of training.
- **Time:** each additional year of data roughly doubles the races available for the
  out-of-sample check.

## Reproduce

See [research/README.md](../README.md#setup): take a snapshot, run the API against
it, then execute the notebooks in order. Model code lives in
`goalsplit_research/fitness_fatigue.py`, covered by `tests/`, which includes
recovering known time constants from synthetic data.

## References

- Banister, E. W., et al. (1975). A systems model of training for athletic performance. *Australian Journal of Sports Medicine*, 7, 57–61.
- Clarke, D. C., & Skiba, P. F. (2013). Rationale and resources for teaching the mathematical modeling of athletic training and performance. *Advances in Physiology Education*, 37(2), 134–152.
- Daniels, J., & Gilbert, J. (1979). *Oxygen Power: Performance Tables for Distance Runners.*
- Hellard, P., et al. (2006). Assessing the limitations of the Banister model in monitoring training. *Journal of Sports Sciences*, 24(5), 509–520.
- Künsch, H. R. (1989). The jackknife and the bootstrap for general stationary observations. *Annals of Statistics*, 17(3), 1217–1241.
- Newey, W. K., & West, K. D. (1987). A simple, positive semi-definite, heteroskedasticity and autocorrelation consistent covariance matrix. *Econometrica*, 55(3), 703–708.
