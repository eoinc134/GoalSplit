# GoalSplit

A training analytics project built on my own running data: two-plus years of Strava
activities with second-by-second heart rate, pace and elevation, plus daily Garmin
recovery data. It applies established endurance-science models to answer practical
questions:

- **How much am I training, and is it building or wearing me down?** (load, fitness, fatigue, form)
- **How hard is that training?** (intensity distribution, polarization)
- **Am I getting fitter?** (aerobic efficiency, pace at a fixed heart rate)
- **How well do I hold up over distance?** (long-run drift, fade, durability)

Every metric is defined, with its formula, assumptions and references, in
**[docs/METHODS.md](docs/METHODS.md)**.

## What it measures

| Area | Metrics | Model |
|---|---|---|
| Training load | TRIMP per session; fitness (CTL), fatigue (ATL) and form (TSB); acute:chronic workload ratio | Banister TRIMP and fitness–fatigue model; EWMA ACWR (Williams 2017) |
| Load pattern | Weekly monotony and strain | Foster (1998) |
| Intensity | Time in 5 HR zones; weekly low / moderate / high split; polarization index | Karvonen HR reserve; Seiler 3-zone; Treff (2019) |
| Aerobic fitness | Efficiency factor trend; grade-adjusted pace inside Z2 | Friel EF; Minetti (2002) GAP |
| Durability | Decoupling, pace fade and HR rise on long runs, binned by duration | Friel Pa:HR |
| Recovery | Resting HR, HRV, sleep, Garmin training readiness | Garmin |
| Records | Best efforts per distance, Strava-derived plus manual corrections | — |

## Key terms

- **TRIMP (training impulse):** load of one session, from duration and heart rate,
  weighted exponentially so hard minutes count far more than easy ones.
- **CTL / ATL / TSB:** fitness (42-day weighted average of daily load), fatigue (7-day
  average) and form (fitness minus fatigue). Negative form means you're carrying fatigue.
- **ACWR:** recent load ÷ longer-term load. It shows how quickly training is ramping up.
- **Monotony / strain:** how little daily load varies across a week, and weekly load
  scaled by that. High strain with little variation is an overtraining warning sign.
- **HR zones:** five bands of heart-rate reserve (resting to max), from Z1 recovery to Z5 max.
- **Polarization index:** a single number for how much training sits at the easy and
  hard ends rather than the middle.
- **GAP (grade-adjusted pace):** pace converted to its flat-ground equivalent effort,
  so hilly and flat runs compare fairly.
- **Efficiency factor (EF):** grade-adjusted speed per heartbeat. Rising EF on easy runs = improving aerobic fitness.
- **Aerobic decoupling:** how much heart rate drifts up against pace from the first half of a run to the second.
- **Durability:** how drift and pace fade grow as runs get longer.

## Accounting for confounders

Pace and heart rate respond to more than fitness. The analysis controls for the main
confounders explicitly:

- **Terrain:** all pace and efficiency figures are grade-adjusted.
- **Session type:** each run is classified (easy, long, workout, recovery, race), using
  your own Strava tags first. Fitness trends only compare aerobic runs.
- **Heat:** a regression of efficiency on time and temperature estimates how much heat
  costs, and gives a temperature-adjusted trend line.
- **Data quality:** every view reports how much of the data actually had HR streams, so
  a gap in the data isn't mistaken for a change in fitness.

## Data pipeline

Activities sync from the Strava API and Garmin metrics from Garmin Connect. Raw payloads
are stored unchanged. Each activity's streams are reduced once to an HR histogram and
quarter splits, and all analysis runs on those summaries. The training log is also
exposed to Claude through an MCP server, for AI-assisted coaching conversations.

Built with Next.js, Express, PostgreSQL and TypeScript. To run it, deploy it or set up
syncing, see **[docs/SETUP.md](docs/SETUP.md)**.

## Future additions

- **Training-block comparison:** define blocks (e.g. a marathon build), then compare
  volume ramp, intensity distribution, long-run progression and efficiency change
  between them. Which kind of block led to the best race?
- **Recovery ↔ load modelling:** relate HRV, resting HR and sleep to form and the
  previous days' load. For example, does a low-HRV morning predict worse efficiency or
  more decoupling that day? Includes lagged correlations, and a home-built readiness
  score checked against Garmin's.
- **Weather context:** historical temperature and humidity for each run's time and
  place, replacing the watch's skin-warmed temperature sensor in the heat adjustment.
- **Race prediction:** critical speed and D′ fitted to best efforts across durations,
  tracked over time.
- **Change-point detection:** flag statistically meaningful shifts in efficiency or load,
  rather than relying on eyeballing the trend lines.
