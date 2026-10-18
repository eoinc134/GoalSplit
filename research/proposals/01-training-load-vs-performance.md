# Proposal 1: Training load vs performance

> **Question:** Does my training load predict my performance, and on what timescale?
> How long does fitness from training last for me, and how long does fatigue take
> to clear?

## Motivation

The app already applies the fitness–fatigue model with *textbook* settings: fitness
(CTL) decays over 42 days and fatigue (ATL) over 7. Those are population
conventions. The model behind them (Banister et al., 1975) was designed to be
**fitted to the individual**: given a person's training and performance history,
estimate *their* time constants and gains. Doing that turns a dashboard
convention into a testable claim about one athlete, and gives practical answers:

- How long after a hard block does my performance peak?
- Does ramping load actually move my aerobic efficiency, and with what lag?
- How much of my week-to-week performance variation is explained by load at all?

## Design changes after the data audit

[`notebooks/00-data-audit.ipynb`](../notebooks/00-data-audit.ipynb) changed three
things in the plan below:

- **Runs, not weeks, are the unit of analysis.** Weekly median EF turned out to be
  mostly noise (signal-to-noise 0.5–0.8). The model is instead fitted with each of
  the 216 runs as an observation, `EF_run = p₀ + k₁·fitness − k₂·fatigue + β·intensity
  + γ·duration + δ·hilly + ε`, with intensity as average %HRR. It stays linear for
  fixed (τ₁, τ₂), so the grid-search estimation is unchanged. Rolling-origin
  evaluation forecasts the next 4 weeks of runs.
- **Races are validation, not training data.** No run was tagged as a race; about 12
  genuine races were identified and need tagging on Strava. The model's predicted
  fitness on race days is compared with race VDOT (road races up to the marathon;
  trail and ultra events excluded).
- **Garmin is out of scope.** There are 13 days of data and no HRV.

## Hypotheses

- **H1:** A fitted fitness–fatigue model predicts held-out weekly performance better
  than simple baselines.
- **H2:** My fitted time constants differ meaningfully from the 42 / 7-day defaults.
- **H3:** Increases in chronic load (CTL) are followed by gains in aerobic efficiency
  within 4–8 weeks.

Each can fail. A failure is reported as a finding, not buried.

## Data

| Input | Source | Notes |
|---|---|---|
| Daily training load | TRIMP per activity (`activity_metrics` HR histograms, or average HR) | Rest days count as zero |
| Submaximal performance | Efficiency factor (EF) of each run, with intensity and duration as covariates | 216 runs; see "Design changes" above |
| Maximal performance | Performance index from races and hard best efforts (see below) | Sparse, but measures actual race fitness |
| Context covariates | Run class, GAP, terrain (hilly flag), Garmin resting HR | For controls and sensitivity checks |

**Performance index (new, built for this project).** Each race, and each hard best
effort of at least 3 km, is converted to a distance-independent score: Daniels'
VDOT from distance and time. A 10 km and a half marathon then sit on one scale.
Efforts are filtered to near-maximal ones: the athlete's race tag, high average
HR relative to HRmax, or the activity's own best effort at that distance. The data
audit decides how many such points exist. That number decides whether maximal
performance can be modelled at all, or only used for validation.

## Method

### 1. Fit the individual fitness–fatigue model

```
p(t) = p₀ + k₁ · Σ w(s) · e^(−(t−s)/τ₁)  −  k₂ · Σ w(s) · e^(−(t−s)/τ₂)
                fitness                          fatigue
```

`w(s)` is daily TRIMP and `p(t)` is the performance measure.

- **Estimation:** for fixed (τ₁, τ₂) the model is *linear* in (p₀, k₁, k₂). So the
  search is a grid over τ₁ ∈ 15–60 days and τ₂ ∈ 2–20 days (with τ₁ > τ₂), with
  non-negative least squares for the gains at each grid point, keeping the best
  fit. This avoids the local minima that plague nonlinear fitting of this model
  (Clarke & Skiba, 2013).
- **Outputs:**
  - The fitted time constants, and the full error surface over (τ₁, τ₂). A flat
    surface means the data can't pin them down, and the write-up says so.
  - The **time to peak response** after a training bout:
    `t* = τ₁τ₂ / (τ₁ − τ₂) · ln(k₂τ₁ / (k₁τ₂))`. This is the basis for taper length.
  - The share of performance variance the model explains.

### 2. Lagged dose–response (H3)

Regress the change in 4-week-median EF on the CTL change over the preceding
*L* weeks, for *L* = 2…10. Controls: intensity distribution (low-intensity share),
and long-run volume. Uncertainty comes from HAC (Newey–West) standard errors,
because weekly series are autocorrelated. Reported as an effect-by-lag chart with
confidence intervals.

### 3. Validation (H1, H2)

- **Rolling-origin evaluation:** fit on weeks 1…*n*, forecast weeks *n*+1…*n*+4, step
  forward, repeat. The model never sees the period it's scored on.
- **Baselines it must beat:**
  - Persistence: next week = this week.
  - The 4-week rolling mean.
  - A model using textbook CTL alone.
  - The fitness–fatigue model with *default* constants (42 / 7).

  Beating the default-constant model is the real test of H2.
- **Parameter uncertainty:** a moving-block bootstrap over weeks (Künsch, 1989) gives
  confidence intervals for τ₁, τ₂ and t*.

## Threats to validity

- **Shared measurement:** EF and TRIMP both come from heart rate. A day when HR reads
  high (heat, poor sleep, sensor error) raises load *and* lowers EF, which can
  manufacture a correlation. Mitigations: run the analysis with the maximal
  performance index (time-based, not HR-based) as a check, and lag the load window
  so it never includes the measurement day.
- **Known model weaknesses:** Banister models often fit well in-sample and forecast
  poorly, with unstable parameters (Hellard et al., 2006). That's exactly why
  out-of-sample evaluation against baselines is the headline result, not the
  in-sample R².
- **Confounding by schedule:** races follow tapers, and illness causes both low load
  and low performance. Breaks found by the change-point detector are flagged, and
  the analysis is run with and without them.
- **Small n:** about 2.5 years, ~130 weeks, one athlete. Effects need to be large
  to be detectable. The write-up reports which effect sizes the data could detect
  at all, not just whether p < 0.05.

## Deliverables

1. `notebooks/01a-performance-index.ipynb`: builds and sanity-checks the VDOT index.
2. `notebooks/01b-fitness-fatigue-fit.ipynb`: grid fit, error surface, bootstrap, rolling-origin evaluation.
3. `notebooks/01c-dose-response.ipynb`: lagged regression with HAC errors.
4. `findings/01-training-load-vs-performance.md`: the write-up.
5. **Optional app integration:** if the fitted constants beat the defaults out of
   sample, the Training page can use them, labelled "fitted to you".

## What "done" looks like

A defensible answer to "do my fitted time constants predict better than the
defaults?", in either direction, with forecast-error tables against every
baseline and honest uncertainty on τ₁, τ₂ and t*.

## References

- Banister, E. W., Calvert, T. W., Savage, M. V., & Bach, T. (1975). A systems model of training for athletic performance. *Australian Journal of Sports Medicine*, 7, 57–61.
- Clarke, D. C., & Skiba, P. F. (2013). Rationale and resources for teaching the mathematical modeling of athletic training and performance. *Advances in Physiology Education*, 37(2), 134–152.
- Daniels, J., & Gilbert, J. (1979). *Oxygen Power: Performance Tables for Distance Runners.*
- Hellard, P., et al. (2006). Assessing the limitations of the Banister model in monitoring training. *Journal of Sports Sciences*, 24(5), 509–520.
- Künsch, H. R. (1989). The jackknife and the bootstrap for general stationary observations. *Annals of Statistics*, 17(3), 1217–1241.
- Newey, W. K., & West, K. D. (1987). A simple, positive semi-definite, heteroskedasticity and autocorrelation consistent covariance matrix. *Econometrica*, 55(3), 703–708.
