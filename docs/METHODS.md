# Methods

How every metric in GoalSplit is calculated, what it assumes, and where it can mislead.
The models are established ones from the sports-science literature (references at the
end), applied to one athlete's Strava and Garmin data. Implementation lives in
[`apps/api/src/lib/`](../apps/api/src/lib/).

- [Data and preprocessing](#data-and-preprocessing)
- [Heart-rate zones](#heart-rate-zones)
- [Grade-adjusted pace](#grade-adjusted-pace)
- [Training load](#training-load)
- [Volume](#volume)
- [Intensity distribution](#intensity-distribution)
- [Aerobic efficiency](#aerobic-efficiency)
- [Long runs](#long-runs)
- [Run classification](#run-classification)
- [Context and confounders](#context-and-confounders)
- [Known limitations](#known-limitations)
- [References](#references)

---

## Data and preprocessing

| Source | What it provides |
|---|---|
| Strava activity summaries | Date, duration, distance, elevation gain, average/max HR, the athlete's own workout tag (race / long run / workout) |
| Strava streams | Second-by-second time, distance, heart rate, grade, altitude, moving flag, device temperature |
| Garmin Connect | Daily resting HR, all-day max HR, HRV, sleep, stress, Body Battery, training readiness |

Each activity's streams are reduced once to a compact summary, which every analysis
below reads instead of the raw streams:

- **HR histogram:** for each whole bpm, the seconds spent there (including stops), plus
  moving seconds, distance and grade-adjusted distance at that bpm.
- **Quarter splits:** the run cut into four equal slices of moving time, each with
  moving time, distance, grade-adjusted distance and time-weighted average HR.

Cleaning rules:

- Gaps of more than 30 s between samples are treated as auto-pause or recording gaps and dropped.
- HR samples outside 30–230 bpm are treated as sensor dropouts and ignored.
- Stopped time (Strava's `moving` flag) counts towards HR load, because HR stays up at a
  traffic light. It doesn't count towards pace.
- Indoor runs with no distance stream get the summary distance spread evenly over moving time.

## Heart-rate zones

**HRmax** is the highest heart rate ever recorded, across Strava activities and Garmin
all-day monitoring. It's a field estimate, not a lab test, and a single sensor spike
would inflate it.

**HRrest** is the median Garmin resting HR over the 90 days up to the latest reading.
The median keeps one bad night from shifting every zone. Without Garmin data it
defaults to 60 bpm, and the app says so.

Five zones, at floors of 0 / 60 / 70 / 80 / 90 % of intensity:

| Zone | Label | Intensity |
|---|---|---|
| Z1 | Recovery | < 60 % |
| Z2 | Aerobic | 60–70 % |
| Z3 | Tempo | 70–80 % |
| Z4 | Threshold | 80–90 % |
| Z5 | Max | ≥ 90 % |

With a Garmin resting HR, intensity is **% of heart-rate reserve (Karvonen)**:
`HR = HRrest + pct × (HRmax − HRrest)`. Without one, it's **% of HRmax**. Karvonen is
more individual because it accounts for the athlete's resting HR, not just their peak.

These are generic bands, not zones anchored to measured lactate or ventilatory thresholds.

## Grade-adjusted pace

**GAP** expresses a run's pace as the equivalent effort on flat ground. Each metre is
weighted by the metabolic cost of running at that gradient, relative to running on the
flat. The cost curve comes from Minetti et al. (2002), in J/kg/m for gradient *i*
(rise ÷ run):

```
C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6
GAP distance = distance × C(i) / C(0)
```

A 10 % climb counts about 1.66 flat metres per metre. A gentle descent counts less than
one. Grades are clamped to ±45 %, the range the curve was fit on.

The grade comes from Strava's smoothed grade stream, or else from altitude over a
roughly 10-sample window. GAP only applies to runs. Strava's own GAP uses a different
model, calibrated on HR data and flatter on descents, so the two numbers won't match exactly.

## Training load

### TRIMP (Banister)

The **training impulse** is the load of one session, from heart rate and duration.
It's summed per second from the HR histogram:

```
TRIMP = Σ minutes × HRr × a·e^(k·HRr)      HRr = (HR − HRrest) / (HRmax − HRrest)
```

| | a | k |
|---|---|---|
| Men (and the default when sex is unknown) | 0.64 | 1.92 |
| Women | 0.86 | 1.67 |

The exponential reflects blood lactate rising steeply with intensity, so ten minutes
near max counts far more than ten easy minutes. Sex comes from the Strava athlete profile.

Activities with only a summary average HR (no streams) use the same formula on that
average. That underestimates interval sessions, so the app reports how many days were
scored this way. Activities with no HR at all score zero and count against **HR coverage**.

### Fitness, fatigue and form (ATL / CTL / TSB)

This is Banister's fitness–fatigue impulse-response model, in the form popularised by
Coggan. Daily TRIMP (rest days included as zero) feeds two exponentially weighted averages:

| Term | Meaning | Time constant |
|---|---|---|
| **CTL**, chronic training load ("fitness") | Long-run average daily load | 42 days |
| **ATL**, acute training load ("fatigue") | Recent daily load | 7 days |
| **TSB**, training stress balance ("form") | Yesterday's CTL − yesterday's ATL | — |

```
CTL_t = CTL_{t−1} + (load_t − CTL_{t−1}) × (1 − e^(−1/42))
```

ATL uses the same update with 7 days. The model runs over the full history, so values
inside the display window start from the right place. The first ~42 days after the
first activity are flagged as warm-up.

Reading form:
- Positive: fresh, typically a taper or rest.
- −10 to −30: a productive training load.
- Persistently below −30: accumulating fatigue.

**Ramp rate** is the change in CTL over the last 7 days.

### Acute:chronic workload ratio (EWMA)

**ACWR** = acute load ÷ chronic load, using the exponentially weighted version
(Williams et al., 2017) with λ = 2/(N+1), N = 7 and 28 days. Unlike the older
rolling-average version, the acute window isn't contained in the chronic one, so the
two aren't mathematically coupled, and recent days carry more weight.

Bands (Gabbett, 2016):

| Band | ACWR |
|---|---|
| Undertraining | < 0.8 |
| Sweet spot | 0.8–1.3 |
| Caution | 1.3–1.5 |
| High risk | > 1.5 |

The link between ACWR and injury is contested (Impellizzeri et al., 2020). Treat it as
a description of how fast load is changing, not as an injury predictor.

### Monotony and strain (Foster)

```
Monotony = mean daily load ÷ SD of daily load   (over a Mon–Sun week, rest days as zero)
Strain   = weekly load × monotony
```

Monotony rises when every day looks the same. Foster (1998) found that high load
combined with monotony above about 2 preceded illness and overtraining. Monotony is
undefined (shown as —) when every day is identical, for example a full rest week.

## Volume

Weekly distance and time by activity type, and the raw average run pace. Raw pace
mixes easy days, workouts and hilly routes, so it mostly tracks *what kind* of running
was done. Use [aerobic efficiency](#aerobic-efficiency) for a like-for-like fitness trend.

## Intensity distribution

This shows how training time splits across intensities. The five HR zones collapse
into Seiler's three-zone model:

| 3-zone | 5-zone | Rough meaning |
|---|---|---|
| Low | Z1 + Z2 | Below the first threshold — conversational |
| Moderate | Z3 | Between thresholds — "comfortably hard" |
| High | Z4 + Z5 | Above the second threshold |

Seiler's zones are defined by ventilatory or lactate thresholds, which this data
doesn't include, so the mapping is an approximation.

**Polarization index** (Treff et al., 2019), with each zone as a fraction of total time:

```
PI = log10( (low / moderate) × high × 100 )
```

PI is undefined when moderate or high time is zero. Each week gets a profile:

| Profile | Rule |
|---|---|
| Polarized | PI > 2 and low > high > moderate |
| Pyramidal | Low is the largest share, but not polarized |
| Threshold-heavy | Moderate is the largest share |
| High-intensity dominant | High is the largest share |

Weeks with under 30 minutes of HR data aren't labelled. The chart is 100 % stacked, so
weeks of different volume compare on distribution alone.

## Aerobic efficiency

### Efficiency factor

```
EF = grade-adjusted speed (m/min) ÷ average HR (bpm)
```

EF measures how much speed each heartbeat buys (after Friel). Rising EF at the same
kind of effort is the clearest sign of improving aerobic fitness that doesn't need a
race. The trend uses **aerobic runs only** (easy, recovery and long; see
[run classification](#run-classification)) of 20+ minutes, shown as a 28-day rolling
median. Single runs vary with terrain, weather, sleep and fatigue; the median smooths
that out. The headline compares the median of the last 28 days with the 28 days before.

### Pace at fixed heart rate

This is grade-adjusted pace for all the time HR sat inside Z2, pooled per week across
every run. It answers "how fast is my easy effort?" without needing whole runs to be
easy. Weeks with under 10 minutes in the band are left blank.

### Aerobic decoupling (Pa:HR)

```
Decoupling = (EF_first half − EF_second half) / EF_first half × 100
```

Halves are by moving time, on grade-adjusted pace. A positive value means HR drifted
up, or pace dropped, relative to the first half. Under about 5 % is well coupled (Friel).
Over about 10 % means the effort outran current aerobic fitness, or heat or dehydration
played a part. It's computed for runs of 20+ minutes.

## Long runs

**Long run definition:** 90+ minutes, *or* any run the athlete tagged *Long Run* on
Strava, *or* the week's longest run if it's 60+ minutes and not a workout. The last
condition stops a tempo run in a light week from skewing the durability figures. For
each one:

| Metric | Definition |
|---|---|
| Drift | Aerobic decoupling, as above |
| Fade | Last-quarter GAP pace vs first-quarter, %. Positive = slowed down |
| HR rise | Last-quarter average HR minus first-quarter, bpm |
| Week % | The run's share of that week's run distance |
| Temp | Mean device temperature |

**Durability** bins the long runs by duration (60–90, 90–120, 120–150, 150+ min) and
takes the median drift and fade in each bin. Rising medians across bins show where
aerobic durability currently runs out, which is the limiter for marathon-distance racing.

## Run classification

Each run gets a class so the trends compare like with like. The athlete's own Strava
tag always wins. Otherwise:

1. **Long:** 90+ minutes.
2. **Workout:** at least 15 % of HR time in Z4 or above (intervals), *or* at least half
   of it in Z3 or above (tempo and progression runs).
3. **Long:** the week's longest run, if it's 60+ minutes and not a workout.
4. **Recovery:** average HR below Z2 and under 50 minutes.
5. **Easy:** any other run with HR data.
6. **Unknown:** no HR data. Without HR, a workout can't be ruled out, so the week's
   longest 60+ minute run still counts as long.

Runs with at least 15 m of climbing per km are also flagged **hilly**.

## Context and confounders

- **Terrain:** handled by GAP in every pace and efficiency figure.
- **Session type:** handled by run classification. Efficiency trends exclude workouts and races.
- **Temperature:** heat raises HR at a given pace (cardiovascular drift), which would
  make summer EF look like lost fitness. Over aerobic runs with a temperature reading,
  an ordinary-least-squares model is fitted:

  ```
  EF = b0 + b1·days + b2·temperature
  ```

  The time term absorbs genuine fitness change, so the seasons can't masquerade as a
  temperature effect. `b2` is reported as % of mean EF per °C, and a
  temperature-adjusted EF line puts every run at the sample's median temperature. The
  model is only fitted with 15+ runs and at least 2 °C of spread. Its R² is shown so a
  weak fit is visible.

  The temperature comes from the watch's sensor, which reads warm from body heat, so it
  works as a *relative* measure. Historical weather data for each run's time and place
  would be better. That's listed under future additions.

## Known limitations

- HRmax and HRrest are field estimates. Every HR-based metric shifts if they're off.
- Wrist optical HR lags and can lock onto cadence. A bad HR trace distorts that run's
  TRIMP, zones and decoupling.
- Without Garmin, HRrest is a 60 bpm default and zones are %-of-max.
- The fitness–fatigue time constants (7 and 42 days) are population conventions, not
  fitted to this athlete.
- Treat ACWR bands and Foster's monotony threshold as descriptive, not predictive.
- Everything is one athlete's data: these are within-person trends, not generalisable findings.

## References

- Banister, E. W. (1991). Modeling elite athletic performance. In *Physiological Testing of Elite Athletes*. Human Kinetics.
- Foster, C. (1998). Monitoring training in athletes with reference to overtraining syndrome. *Medicine & Science in Sports & Exercise*, 30(7), 1164–1168.
- Friel, J. *The Triathlete's Training Bible* / TrainingPeaks articles on efficiency factor and aerobic decoupling.
- Gabbett, T. J. (2016). The training–injury prevention paradox. *British Journal of Sports Medicine*, 50(5), 273–280.
- Impellizzeri, F. M., et al. (2020). Acute:chronic workload ratio: conceptual issues and fundamental pitfalls. *International Journal of Sports Physiology and Performance*, 15(6), 907–913.
- Karvonen, M. J., Kentala, E., & Mustala, O. (1957). The effects of training on heart rate. *Annales Medicinae Experimentalis et Biologiae Fenniae*, 35(3), 307–315.
- Minetti, A. E., et al. (2002). Energy cost of walking and running at extreme uphill and downhill slopes. *Journal of Applied Physiology*, 93(3), 1039–1046.
- Seiler, S., & Kjerland, G. Ø. (2006). Quantifying training intensity distribution in elite endurance athletes. *Scandinavian Journal of Medicine & Science in Sports*, 16(1), 49–56.
- Treff, G., et al. (2019). The polarization-index: a simple calculation to distinguish polarized from non-polarized training intensity distributions. *Frontiers in Physiology*, 10, 707.
- Williams, S., et al. (2017). Better way to determine the acute:chronic workload ratio? *British Journal of Sports Medicine*, 51(3), 209–210.
