# Findings 2: Bottleneck identifier

> **Question:** Which part of my fitness is most limiting my performance right now,
> relative to the event I'm training for?

**Short answer.** **Load management and consistency.** It ranks first for every event
analysed (10K, half marathon, marathon, backyard ultra): breaks in training, spikes in
load, and very uneven weeks. That matches what the athlete pre-registered before any
analysis ran, and it survives every robustness check. For longer events the runner-up
is **aerobic base and long runs**. The method's one clear blind spot is **race-pace
durability**: it missed the late fade in the athlete's only road marathon.

Proposal: [02-bottleneck-identifier.md](../proposals/02-bottleneck-identifier.md) ·
Notebooks: [02a speed–endurance](../notebooks/02a-speed-endurance.ipynb),
[02b limiter scores](../notebooks/02b-limiter-scores.ipynb),
[02c validation](../notebooks/02c-validation.ipynb)

## Design

- **No target-event setting.** Limiters are ranked for four events side by side, so
  nothing goal-like is added to the app.
- **Pre-registration (26 Oct 2026):** before any score existed, the athlete named
  **load management** as their biggest limiter.
- **Five candidate limiters:**
  - aerobic durability
  - speed vs endurance balance
  - aerobic base and long runs
  - intensity distribution
  - load management
- **Scoring:** each limiter's severity (0–1) comes from linear ramps between
  documented reference points, its confidence from data sufficiency, and its ranking
  score from severity × an event-relevance weight. All thresholds and weights live in
  one place (`goalsplit_research/limiters.py`), so they can be checked and perturbed.

## Results (as of 26 Oct 2026)

| Event | 1st | 2nd |
|---|---|---|
| 10K | Load management (0.66) | Durability (0.06) |
| Half marathon | Load management (0.66) | Base and long runs (0.20) |
| Marathon | Load management (0.74) | Base and long runs (0.37) |
| Backyard ultra | Load management (0.74) | Base and long runs (0.37) |

**The evidence behind each limiter:**
- **Load management (severity 0.82):** two training breaks of 14+ days in the last
  year, an EWMA ACWR above 1.5 on 10.7% of days, and weekly TRIMP varying by 88%
  (coefficient of variation).
- **Base and long runs:** recent volume is 91% of the athlete's best 12-week block,
  but only 4 of the last 12 weeks had a 150+ minute run (6 of 12 had a 90+ minute run).
- **Not limiting now:**
  - Intensity distribution: the last 12 weeks were 84% low-intensity.
  - Training-run durability: median drift 3.4% across 23 long runs.
  - Speed relative to endurance: the personal Riegel exponent is 1.084, CI 1.044–1.119.

**Speed–endurance profile:**
- **Up to the half:** race VDOT is roughly level (medians about 45–46).
- **Marathon:** the one road marathon (Venice, 3:33:46) fell well short of even the
  personal exponent's prediction from the half (3:12).
- **Speed ceiling:** critical speed is 4:05/km, but D′ is only 82 m, so the short
  "best efforts" weren't maximal and the athlete's speed ceiling is effectively
  unmeasured.

## Validation

1. **Agrees with the athlete's own read** for all four events.
2. **Robust to the judgment calls.** Load management stays on top in 99.8–100% of
   1,000 perturbations of every threshold (±20% of each ramp's width) and every
   relevance weight (±20%).
3. **Robust to racing.** Races are deliberate load spikes, so load management was
   re-scored without race days, the week after each race, or race weeks. Severity
   drops from 0.82 to 0.65 (spike days 10.7% → 5.9%), but weekly unevenness and the
   breaks remain, and it still ranks first everywhere.
4. **Moves when training moves.** Replayed month by month over the last year, the
   marathon ranking had **aerobic base** on top from December 2025 to July 2026. The
   backyard-ultra block then fixed base (1.00 → 0.27) and intensity distribution
   (0.60 → 0.00). Load management stayed at 0.68–0.86 throughout: a persistent
   pattern, not a passing state.
5. **Race case studies, including one clear miss:**
   - **Venice Marathon:** a classic late fade (drift +12.1%, last-quarter pace
     +15.9%), but the day before, durability scored only 0.07. The durability measure
     uses *training* long runs, which are slow and showed little drift, so it can't
     see durability at race pace.
   - **Firenze Half and Pisa 10k:** the athlete's best races (VDOT 50.4 and 52.6),
     finished faster than they started. They happened despite load management being
     flagged, consistent with it limiting the *rate of progress* rather than any one
     race.

## What it means in practice

- **Fix consistency before anything else.** Fewer forced breaks, smaller week-to-week
  swings, and planned deload weeks instead of collapses. This also matches
  [Findings 1](01-training-load-vs-performance.md): efficiency tracks the last two
  weeks of training and dips *before* breaks.
- **For the marathon, build the long run, and make some of it race pace.** Base and
  long runs are the runner-up limiter, and Venice suggests a race-pace durability gap
  that easy long runs alone don't expose.
- **Test speed directly.** A 1-mile or 3 km time trial would give a real speed
  ceiling and a credible D′.

## Limitations

- **Heuristic reference points.** The sensitivity analysis shows the conclusion
  doesn't depend on them, but they're still judgment calls, not fitted values.
- **Durability blind spot.** Durability is measured at training intensity. A
  race-pace durability measure (drift or fade on long runs with race-pace segments) is
  the obvious next improvement.
- **Overlapping limiters.** Load management and base partly overlap (breaks reduce
  base), so a ranking can double-count one root cause.
- **One athlete and few races:** 15 road races, and one marathon. The case studies
  are illustrations, not statistics.

## Reproduce

Run the snapshot, start the API against it, then execute notebooks 02a–02c (see
[research/README.md](../README.md#setup)). Scoring code is in
`goalsplit_research/limiters.py`, covered by `tests/test_limiters.py`, which includes
recovering known Riegel and critical-speed parameters from synthetic data and checking
that perturbation never flips a ramp.

## References

- Foster, C. (1998). Monitoring training in athletes with reference to overtraining syndrome. *Medicine & Science in Sports & Exercise*, 30(7), 1164–1168.
- Gabbett, T. J. (2016). The training–injury prevention paradox. *British Journal of Sports Medicine*, 50(5), 273–280.
- Jones, A. M., Vanhatalo, A., Burnley, M., Morton, R. H., & Poole, D. C. (2010). Critical power: implications for determination of V̇O₂max and exercise tolerance. *Medicine & Science in Sports & Exercise*, 42(10), 1876–1890.
- Maunder, E., et al. (2021). The importance of 'durability' in the physiological profiling of endurance athletes. *Sports Medicine*, 51(8), 1619–1628.
- Riegel, P. S. (1981). Athletic records and human endurance. *American Scientist*, 69(3), 285–290.
- Seiler, S. (2010). What is best practice for training intensity and duration distribution in endurance athletes? *International Journal of Sports Physiology and Performance*, 5(3), 276–291.
- Williams, S., et al. (2017). Better way to determine the acute:chronic workload ratio? *British Journal of Sports Medicine*, 51(3), 209–210.
