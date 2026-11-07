# Proposal 3: Before and after the training plan

**Status: baseline frozen 7 Nov 2026. Study window 9 Nov 2026 to 7 Feb 2027. Follow-up
due after 7 Feb 2027.**

> **Question:** If I follow a consistent plan for 13 weeks, what changes in how my
> training load relates to my performance, and in what limits me?

## The plan being tested

- Build mileage, with proper 80/20 easy-to-hard training, good quality workouts and
  consistent weekend long runs.
- Build up through races: 5K, then 10K, then half marathon (eventually a full).
- Deload weeks that are genuine deloads, not a full drop-off.

## Why this needs a design, not just a re-run

Running the notebooks again in February would be misleading in four ways, each found
while preparing this study:

1. **The 12-month window flatters any result.** The load score looks back a year, so
   the 39-day break from 18 Nov to 26 Dec 2025 leaves the window by February whatever
   happens. A projection with a four-week break in the middle of the plan *still*
   improves the score (0.79 → 0.74). The primary measure therefore uses 13-week
   windows, and the 12-month score is judged against a projected floor.
2. **Being first doesn't mean being a problem.** Even with the plan followed exactly,
   the 12-month load score only reaches about 0.47, and nothing else is flagged for a
   10K or half marathon, so load will probably stay "first" for those events. That
   wouldn't be a failure. The severity is what matters.
3. **Last winter isn't a seasonal control.** It held a long break, so its efficiency
   drop (−0.065) is mostly a load drop (−0.052 predicted). Used as a seasonal baseline,
   it would credit the plan with an improvement it didn't earn. The comparison is
   instead what the load change *doesn't* explain.
4. **Success reduces the signal.** Steady training narrows the range of fortnightly
   load, so the dose–response estimate gains little from a well-followed plan.

## What's frozen

`baselines/2026-11-07.json`, committed to git before the study starts so the commit
timestamps it. Scoring code is `goalsplit_research/study.py`, which reuses the limiter
thresholds and weights unchanged.

| Frozen | Value |
|---|---|
| Data | 229 activities to 7 Nov 2026; dataset hash in the baseline file |
| Efficiency models | Five, fitted on 201 runs: covariates only, recent form, one load term (τ = 13), fitness–fatigue 42/7, fitness–fatigue fitted (τ₁ = 10, τ₂ = 9) |
| Two-week effect | +0.0142 EF per 100 TRIMP (95% CI 0.0036 to 0.0248, p = 0.009); excluding post-break runs +0.0106 (p = 0.062) |
| Physiology | HRmax 214, resting HR 48, TRIMP coefficient 1.92, Z2 148–163 bpm |
| Bottleneck | Load first for all four events; severity 0.79 (2 breaks, 10.1% spike days, CV 0.82) |
| Scores | 10K and half: load 0.63. Marathon and backyard ultra: load 0.71, base 0.43 |

Published findings ([1](../findings/01-training-load-vs-performance.md),
[2](../findings/02-bottleneck-identifier.md)) remain the reference write-ups. They used
data to 18 and 26 Oct; the frozen numbers reproduce them with the extra weeks added.

### Comparison windows

| Window | Dates | Purpose |
|---|---|---|
| **Study** | 9 Nov 2026 to 7 Feb 2027 | The plan |
| **Before** | 3 Aug to 1 Nov 2026 | The block immediately before; includes the 115 km backyard ultra |
| **Same weeks last year** | 10 Nov 2025 to 8 Feb 2026 | Season; includes the 39-day break |
| **All earlier blocks** | 10 non-overlapping 13-week blocks | What's normal for me |

The week of 2–8 Nov falls between Before and Study and belongs to neither.

## Did I follow the plan?

Defined now, from the training data. Followed means **at least 6 of 7, and no break**.

| Criterion | Before block | Best of 10 earlier blocks |
|---|---|---|
| No 14+ day break | Met | 4 of 10 blocks met it |
| No week under 50% of the previous 3 weeks' km | 2 such weeks | 2 |
| At least 2 deload weeks (50–85% of the previous 3 weeks' km) | 3 | 4 |
| Weekend 75+ min run in at least 10 of 13 weeks | **5** | 7 |
| Quality session in at least 9 of 13 weeks | 11 | 11 |
| At least 80% of heart-rate time in Z1–2 | 85% | 85% |
| Best later 4 weeks at least 10% above the first 4 (km) | Met | 8 of 10 blocks met it |

No earlier block qualifies; the best is 5 of 7. Weekend long runs are the biggest
change the plan asks for. If the plan isn't followed, the study reports what was done
instead, and draws no conclusion about the plan.

## Outcomes and how they'll be judged

### Question 1: training load vs performance

| Test | Pre-registered expectation | How it's read |
|---|---|---|
| **Frozen forecasts** on all new runs, no refitting. This is the first truly prospective test of Proposal 1. | **Null.** No load model beats covariates alone. | A claim needs a skill above 0 and a 95% interval on the error difference excluding 0 |
| **Efficiency change vs load prediction:** Study minus Before, net of duration, intensity and terrain | **Positive and small,** about +0.00 to +0.03 at 400–500 TRIMP a week | Consistent if the prediction lies inside the interval. Before already averages 776 TRIMP a fortnight, inflated by the ultra |
| **Unexplained by load, against last year** | Interval includes 0 | Above 0 is the only evidence of a gain beyond what load explains; last year's estimate is −0.013 (−0.052 to +0.027), with only 16 winter runs |
| **Two-week effect, refitted** | Stays inside the frozen interval, 0.0036 to 0.0248 | Outside it means Proposal 1's effect was unstable |
| **Time constants, refitted** | τ₁ and τ₂ stay close together, still not separately identifiable | Clearly separated values would be new information |

**Detection limit.** In the rehearsals, this change has an interval of roughly ±0.03 to
±0.05, about 3–4% of efficiency. **A flat result can't rule out a real gain of that
size,** and the expected effect is smaller. So Question 1 could easily end
inconclusive, and that would be reported as such.

### Question 2: the bottleneck

| Test | Pre-registered expectation | How it's read |
|---|---|---|
| **13-week load severity (primary)** | **Below 0.33,** lower than all 10 earlier blocks | Before is 0.33 with races and 0.12 without. Both are reported, because the ultra sits in Before |
| **12-month load severity** | **At or below 0.55,** from 0.79 | Projected 0.47 if the plan is followed, 0.74 with a four-week break. Only the part below 0.74 is credit to the training |
| **Ranking for 10K and half** | Load stays first, at about 0.37 | Not a failure: nothing else is flagged |
| **Ranking for marathon and ultra** | Base and long runs overtakes load **if** there are fewer than about two 150+ minute runs in the last 12 weeks | The plan's half-marathon build may not include these, so a flip here would be expected, and would show the method moving when training moves |
| **Robustness** | Any change of first place is reported with its share of 1,000 perturbations | A new leader under 90% is called unsettled |

### Secondary, descriptive only

- **Races:** VDOT, fade and drift for each race, against the frozen race list. Few races
  and different distances, so no statistics. The half marathon falls after the window (May
  2027), so Proposal 2's blind spot, race-pace durability, stays largely untested here.
- **Z2 pace, median long-run drift, resting HR, sleep and stress,** against Before and
  the same weeks last year. Sleep was rarely recorded before autumn 2026, so last
  year's sleep comparison is unavailable.

### Athlete's prediction

Recorded 7 Nov 2026, before the study window and before any outcome existed, like the
guess recorded for Proposal 2:

- **First for a half marathon in February:** load management.
- **Efficiency:** a slight real improvement, too small for the study to confirm.
- **Race goal for the block:** personal bests at 5K and 10K by 7 Feb 2027: under 19:39
  and under 39:34. The half marathon is in May 2027, after the study, so it isn't part
  of this test.

## Threats to validity

- **No control and one athlete.** Anything else that changes over these weeks is
  mixed in with the plan.
- **Season.** Winter temperatures may raise efficiency on their own, and the watch
  records no reliable temperature. Last year's windows are a weak proxy, resting on 16
  runs.
- **Recovery from the ultra.** The recent efficiency level may be depressed, so some
  gain could be recovery rather than the plan.
- **The plan has already started.** Weeks since 5 Oct have been steady (360, 336, 303,
  456 and 347 TRIMP), which understates the contrast. The ultra in Before overstates
  it. These two biases work in opposite directions, which is why 13-week severity is
  also reported without race weeks and against all earlier blocks.
- **Unblinded.** I see these metrics in the app, and could train to them. That's why
  the notebook withholds outcomes until the end, though the app doesn't.
- **Metric drift.** A change to HRmax or resting HR changes TRIMP and zones throughout
  history. Resting HR comes from Garmin automatically. The follow-up recomputes the
  Before block, and reports any difference from the frozen values.
- **Missing heart rate.** A run with no heart rate counts as zero load: the 17 km
  workout on 22 Oct 2026 did. Those runs are counted, and more than 5% of the window
  would be flagged.
- **Regression to the mean.** Before includes an unusually large spike, so some
  improvement against it is expected anyway.

## During the study

- Check in any time with `notebooks/03-before-after.ipynb`: it reports adherence and
  withholds outcomes until the window ends.
- Keep tagging races, long runs and workouts on Strava, and title races with distance
  and official time, e.g. "Pisa 10k (44:25)".
- Don't change HRmax or the thresholds. A change made for a good reason gets recorded
  here, with its date.
- If training stops for 14+ days, note why (illness, injury, travel, rest). Proposal 1
  couldn't test reverse causation without this.

## Follow-up procedure

After 7 Feb 2027:

1. Refresh the snapshot, and start the API against it ([setup](../README.md#setup)).
2. Build and execute `notebooks/03-before-after.ipynb`. It reads the frozen baseline,
   and refuses to write outcomes until the window is complete.
3. Write `findings/03-plan-before-after.md`, reporting every test above, including the
   ones that come out against expectations.

## Rehearsal

The pipeline was run on two past periods, as if each date were "now".

| | Winter 2025–26 (negative control) | 2026 ultra build |
|---|---|---|
| Criteria met | 2 of 7, with a 39-day break | 3 of 7 |
| 13-week load severity, before → during | 0.44 → 0.92 | 0.53 → 0.45 |
| Best frozen forecast vs covariates only | +0.07 skill, interval includes 0 | No model better; down to −0.25 |
| Efficiency change, observed vs load-predicted | −0.057 vs −0.081 | +0.015 vs +0.042 |
| Marathon first place, before → after | Load → base (89.5%) | Load → load (100%) |

The scorecard catches a collapse, the ranking moves when training moves, and frozen
load models show no forecasting edge. That last result is why the null is the
pre-registered expectation.

## Deliverables

1. `baselines/2026-11-07.json`: the frozen baseline (done).
2. `goalsplit_research/study.py` and `tests/test_study.py`: scoring and tests (done).
3. `notebooks/03-before-after.ipynb`: baseline, adherence, outcomes, rehearsal (done).
4. `findings/03-plan-before-after.md`: the write-up, after the study.
