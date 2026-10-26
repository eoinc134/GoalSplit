# Proposal 2: Bottleneck identifier

**Status: complete.** Findings: [findings/02-bottleneck-identifier.md](../findings/02-bottleneck-identifier.md)

> **Question:** Which part of my fitness is most limiting my performance right now,
> relative to the event I'm training for?

## Decisions and pre-registration (26 Oct 2026, before any analysis)

- **Target event:** limiters are ranked for **several events side by side** (10K, half
  marathon, marathon, backyard ultra) in the research notebooks. No "focus event"
  setting is added to the app.
- **Athlete's pre-registered belief:** asked "which is your biggest limiter right now
  for your main road goal?" before seeing any result, the athlete answered **load
  management** (spikes, inconsistency and breaks interrupting training). The findings
  compare this with what the data says.

## Motivation

The app shows a dozen descriptive metrics side by side: durability, intensity
distribution, load, efficiency and more. It doesn't say which one *matters most*.
Coaches do this informally ("your speed is fine, you fall apart after two hours").
This project makes that judgment explicit and transparent. Each candidate limiter
gets a metric, a reference point and a confidence level, and they're ranked for a
target event.

It's deliberately **not** a black-box classifier. With one athlete and a handful
of races, there's nothing to train one on. The value is in a structured,
reproducible diagnostic whose every step can be inspected and argued with.

## Candidate limiters

| Limiter | Metric | Reference point | Source |
|---|---|---|---|
| **Aerobic durability** | Slope of decoupling and pace fade against run duration; fade on the longest runs | Decoupling under ~5% on steady efforts; slope near zero | Friel; Maunder et al. (2021) |
| **Speed vs endurance balance** | Personal Riegel exponent *b*, from best efforts across distances (`time ∝ distance^b`) | *b* ≈ 1.06 typical. Higher = endurance-limited, lower = speed-limited | Riegel (1981) |
| **Speed ceiling** | Critical speed (CS) and D′, fitted to maximal efforts of 3–20 min (`distance = CS·t + D′`) | Own history, and CS relative to race pace | Jones et al. (2010) |
| **Aerobic base** | CTL against own peak; consistency (weeks below the phase mean, gaps); weekly volume | Own best block | — |
| **Long-run specificity** | Frequency and length of long runs against the event's duration | Event-specific (e.g. regular 2.5 h+ runs for ultra) | — |
| **Intensity distribution** | Share of time in the Z3 "grey zone"; polarization index | Roughly 75–80% low intensity in endurance athletes | Seiler (2010); Treff et al. (2019) |
| **Load management** | Weeks with ACWR > 1.5, monotony > 2, and load spikes followed by forced breaks (change points to near-zero load) | Few or none | Gabbett (2016); Foster (1998) |

Every reference point is a heuristic, and the write-up labels it as one. Several are
relative to the athlete's *own* history rather than population norms, since
norms for one recreational ultra runner are a weak anchor.

## Method

### 1. Score each limiter

For limiter *i*:

- **Severity** sᵢ ∈ [0, 1]: distance from the reference point, scaled so 0 = no
  concern and 1 = clearly limiting. The scaling function is written down for each
  limiter (e.g. a logistic on the Riegel exponent around 1.06).
- **Confidence** cᵢ ∈ [0, 1]: from data sufficiency, such as the number of
  maximal efforts behind the Riegel fit, streams coverage, and weeks of history.
  A limiter with almost no evidence is shown as "unknown", not "fine".

### 2. Weight by the target event

An explicit relevance matrix (limiter × event type) captures that durability
matters far more for a backyard ultra than for a 5 km race. Ranking score:
`rᵢ = relevanceᵢ(event) × sᵢ`, shown alongside cᵢ. The matrix is a documented
judgment call, kept in one file and easy to change.

### 3. Explain every result

Each limiter's output includes the number behind it, the reference it was compared
with, the chart that shows it, and a one-line "what would move this" suggestion.
For example: "Durability: decoupling rises 3.1% per extra hour; on 2 h+ runs median
fade is +6%. Most-cited lever: more, and longer, steady long runs."

## Validation

There's no ground-truth label for "your real bottleneck", so validation is
deliberately multi-pronged:

1. **Pre-registered self-assessment:** before seeing any output, I write down what I
   believe my limiters are, ranked. Agreement or disagreement is reported. A
   disagreement is interesting rather than a failure, as long as the evidence
   behind it holds up.
2. **Retrospective case studies:** for each past race, compute the ranking from the
   preceding block only, then check it against how the race went. For example, a
   large late-race fade should coincide with durability ranking high. With few
   races, these are qualitative case studies, not statistics.
3. **Sensitivity analysis:** perturb each reference point and scaling (±20%) and
   report how often the top-ranked limiter changes. A ranking that flips under
   small perturbations isn't reported as a conclusion.
4. **Stability over time:** recompute the ranking every week. It should change when
   training changes (a block with more long runs should lower durability
   severity), not jump around for no reason.
5. **Optional link to Proposal 1:** if the dose–response analysis shows which
   training inputs actually moved *my* efficiency, those coefficients can inform
   the relevance weights. That gives the diagnostic a data-driven component.

## Data

Everything in the table above already exists in the app, except the **best-effort
curve** and the **performance index**. Those are the same building blocks as
Proposal 1's notebook `01a`, so whichever proposal comes second gets them for free.
The data audit decides two things:

- whether there are enough near-maximal efforts at 3–20 minutes to fit CS / D′; if
  not, that limiter is reported as "unknown"
- whether the Riegel fit has enough distinct distances to be stable

## Target event (decided above; options considered)

A bottleneck only exists relative to an event. Options:

- **Inferred:** use the event type I've raced most recently or most often (e.g.
  backyard ultra). Nothing to configure, but it guesses.
- **A single "focus event" setting** (event type + distance, no date or target
  time). This is the smallest possible goal-like input. It sits close to the
  goal-setting removed in the 2026-09 cleanup, so it needs an explicit yes.

## Threats to validity

- **Heuristic reference points:** mitigated by sensitivity analysis and by
  labelling, but they remain judgment calls.
- **Best efforts aren't always maximal:** Strava's best efforts include segments of
  easy runs. Efforts are filtered to near-maximal ones, and CS / D′ is fitted only
  where enough genuine maximal efforts exist.
- **Correlated limiters:** low base volume causes poor durability, so a ranking can
  double-count one root cause. The write-up groups limiters by likely root cause.
- **One athlete:** the output is a structured second opinion, not a diagnosis.

## Deliverables

1. `notebooks/02a-best-effort-curve.ipynb`: Riegel exponent and CS / D′ fits, with confidence intervals.
2. `notebooks/02b-limiter-scores.ipynb`: severity, confidence, relevance and ranking.
3. `notebooks/02c-validation.ipynb`: self-assessment comparison, race case studies, sensitivity, stability.
4. `findings/02-bottleneck-identifier.md`: the write-up.
5. **Optional app integration:** a "Limiters" card on the Training page showing the
   ranking, each with its evidence and confidence.

## What "done" looks like

A ranked, explained list of limiters for the target event, where the top result
holds up under sensitivity analysis. The write-up states clearly where the data
was too thin to judge.

## References

- Foster, C. (1998). Monitoring training in athletes with reference to overtraining syndrome. *Medicine & Science in Sports & Exercise*, 30(7), 1164–1168.
- Gabbett, T. J. (2016). The training–injury prevention paradox. *British Journal of Sports Medicine*, 50(5), 273–280.
- Jones, A. M., Vanhatalo, A., Burnley, M., Morton, R. H., & Poole, D. C. (2010). Critical power: implications for determination of V̇O₂max and exercise tolerance. *Medicine & Science in Sports & Exercise*, 42(10), 1876–1890.
- Maunder, E., Seiler, S., Mildenhall, M. J., Kilding, A. E., & Plews, D. J. (2021). The importance of 'durability' in the physiological profiling of endurance athletes. *Sports Medicine*, 51(8), 1619–1628.
- Riegel, P. S. (1981). Athletic records and human endurance. *American Scientist*, 69(3), 285–290.
- Seiler, S. (2010). What is best practice for training intensity and duration distribution in endurance athletes? *International Journal of Sports Physiology and Performance*, 5(3), 276–291.
- Treff, G., et al. (2019). The polarization-index: a simple calculation to distinguish polarized from non-polarized training intensity distributions. *Frontiers in Physiology*, 10, 707.
