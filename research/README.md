# Research

Statistical and predictive questions about my own training, answered in Python
(pandas, scipy, statsmodels) against the same PostgreSQL database the app uses.

The app (`apps/`) computes descriptive metrics: load, efficiency, durability and so
on. This folder asks what those metrics *mean* for performance. Each question
starts as a written proposal, then becomes notebooks, then a short write-up of
the findings.

## Proposals

| # | Question | Status |
|---|---|---|
| 1 | [Training load vs performance](proposals/01-training-load-vs-performance.md): does my training load predict my performance, and on what timescale? | Proposed |
| 2 | [Bottleneck identifier](proposals/02-bottleneck-identifier.md): which part of my fitness is limiting performance right now? | Proposed |

Both start from the same **data audit** (step 0 below), which settles what's
feasible before either is chosen.

### Choosing between them

| | 1. Load vs performance | 2. Bottleneck identifier |
|---|---|---|
| Kind of study | Predictive: fit a model, test forecasts out of sample | Diagnostic: structured, explained scoring |
| Main data need | Many weeks of load + a performance measure | Near-maximal efforts across distances; long runs |
| Biggest risk | Model doesn't beat simple baselines (still a reportable result) | Reference points are judgment calls; hard to validate |
| Statistical depth | High: grid fit, bootstrap, rolling-origin CV, HAC errors | Moderate: curve fits, sensitivity analysis |
| Practical payoff | Personal time constants, taper timing | A clear "work on this next" |
| Decisions needed first | None | Target event (inferred vs a focus-event setting) |
| Shared groundwork | Performance index and best-effort curve, needed by both | |

Doing 1 first makes 2 stronger: its dose–response results can weight the
bottleneck ranking with evidence from this athlete's own data.

## Layout

Only `proposals/` exists so far; the rest is created as work starts.

```
research/
  proposals/      one .md per research question: question, method, validation, risks
  notebooks/      exploratory and analysis notebooks, numbered by question (01-…, 02-…)
  goalsplit_research/
                  shared Python: database access, dataset builders, model code
  findings/       write-ups of finished questions (question → method → results → limitations)
```

## Data access

- **Source of truth for metrics is the app.** TRIMP, GAP, efficiency factor, run
  class and so on are already defined and tested in `apps/api/src/lib/`. Research
  code reads them from the API, or from the tables the API fills
  (`activities`, `activity_metrics`, `garmin_days`), rather than reimplementing
  them. Two implementations would drift. Anything new, such as a performance
  index, is built here, and moves into the app only if it earns a place.
- **Work on a snapshot, not production.** Take a `pg_dump` of the Railway database
  into the local Docker Postgres and point `DATABASE_URL` at that. Analyses are then
  reproducible against a fixed dataset, and nothing here can write to the live
  database.
- Connection details go in `research/.env` (gitignored), never in a notebook.

## Setup

```sh
cd research
python -m venv .venv
.venv\Scripts\activate          # Windows; use `source .venv/bin/activate` elsewhere
pip install -r requirements.txt
copy .env.example .env          # then set DATABASE_URL to the local snapshot
jupyter lab
```

## Ground rules

- **One athlete.** Every result is a within-person association for one runner.
  Write-ups say so, and don't generalise.
- **Out-of-sample or it didn't happen.** Predictive claims are judged on forecasts
  for periods the model never saw, against simple baselines.
- **Report the null.** "The model doesn't beat a naive baseline" is a finding, and
  it gets written up like any other.
- **Time series aren't independent.** Weekly data is autocorrelated, so
  uncertainty comes from block bootstraps or HAC (Newey–West) errors, not textbook
  i.i.d. formulas.

## Step 0: data audit (shared by both proposals)

One notebook, `notebooks/00-data-audit.ipynb`, that answers:

1. How many weeks of history have stream coverage, and where are the gaps?
2. Which races exist (Strava workout type 1, plus manual PRs), at what distances?
3. How many hard best efforts exist per standard distance, and how many are
   genuine maximal efforts rather than segments of easy runs?
4. How noisy is weekly efficiency factor week to week (its signal-to-noise ratio)?
5. What does Garmin add? Currently only resting HR, sleep, stress and Body
   Battery, since a Forerunner 55 records no HRV.

Its answers decide which proposal is feasible, and at what resolution.
