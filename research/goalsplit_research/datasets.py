"""Analysis tables shared by the Proposal 1 notebooks.

The race rules here (distance and time from the title, road-race filter) are
mirrored in apps/api/src/lib/race-prediction.ts, which powers the Records
page predictions. Change both together.
"""

import re

import numpy as np
import pandas as pd

from .performance import vdot

STANDARD_RACE_M = {"5K": 5000.0, "10K": 10000.0, "Half-Marathon": 21097.5, "Marathon": 42195.0}
RACE_DISTANCE_TOLERANCE = 0.06  # GPS within ±6% of a standard distance counts as that race
MIN_RUN_S = 20 * 60  # shorter runs give a noisy efficiency factor
MAX_RUN_S = 4 * 3600  # ultra-length efforts mix in walking
MAX_ROAD_RACE_M = 43_000
RACE_EFFORT_HR_FRACTION = 0.80  # a race run below 80% of HRmax wasn't raced


def run_table(dataset: dict, activities: pd.DataFrame) -> pd.DataFrame:
    """One row per run usable for the efficiency model, with its covariates."""
    p = dataset["physiology"]
    r = activities[(activities["type"] == "Run") & activities["ef"].notna()].copy()
    r = r[(r["movingTimeS"] >= MIN_RUN_S) & (r["movingTimeS"] <= MAX_RUN_S)]
    r["intensity"] = (r["avgHr"] - p["hrRest"]) / (p["hrMax"] - p["hrRest"])  # fraction of HR reserve
    r["log_hours"] = np.log(r["movingTimeS"] / 3600)
    r["hilly"] = r["hilly"].astype(float)
    return r.reset_index(drop=True)


def distance_from_name(name: str) -> float | None:
    """The race distance the athlete wrote in the title, in metres, if any.
    More reliable than GPS, which routinely reads courses a few percent long."""
    n = name.lower()
    if re.search(r"half|mezza", n):
        return 21097.5
    if re.search(r"marathon|maratona", n):
        return 42195.0
    if re.search(r"park\s?run", n):
        return 5000.0
    m = re.search(r"\b(\d+(?:\.\d+)?)\s?k\b", n)
    return float(m.group(1)) * 1000 if m else None


def official_time_from_name(name: str) -> float | None:
    """An official time written in brackets in the title — "(47:50)" or
    "(1:30:47)" — in seconds. Covers a watch left running after the finish."""
    m = re.search(r"\((\d{1,2}):(\d{2})(?::(\d{2}))?\)", name)
    if not m:
        return None
    a, b, c = int(m.group(1)), int(m.group(2)), m.group(3)
    return a * 3600 + b * 60 + int(c) if c is not None else a * 60 + b


def race_distance(name: str, gps_m: float) -> tuple[float, str]:
    """(metres, source): from the title, else the standard distance GPS is
    within ±6% of, else GPS itself."""
    named = distance_from_name(name)
    if named is not None:
        return named, "name"
    for metres in STANDARD_RACE_M.values():
        if abs(gps_m - metres) / metres <= RACE_DISTANCE_TOLERANCE:
            return metres, "nearest standard"
    return gps_m, "GPS"


def road_races(dataset: dict, activities: pd.DataFrame) -> pd.DataFrame:
    """Tagged road races run at a genuine effort, with a distance, time and VDOT each."""
    hr_max = dataset["physiology"]["hrMax"]
    races = activities[(activities["type"] == "Run") & (activities["workoutType"] == 1)].copy()
    effort_ok = races["avgHr"].isna() | (races["avgHr"] >= RACE_EFFORT_HR_FRACTION * hr_max)
    races = races[~races["hilly"].astype(bool) & (races["distanceM"] <= MAX_ROAD_RACE_M) & effort_ok]

    rows = []
    for _, race in races.iterrows():
        distance, distance_source = race_distance(race["name"], race["distanceM"])
        official = official_time_from_name(race["name"])
        time = official if official is not None else float(race["movingTimeS"])
        rows.append(
            {
                "id": race["id"],
                "localDate": race["localDate"],
                "name": race["name"],
                "distance_m": distance,
                "distance_source": distance_source,
                "time_s": time,
                "time_source": "title" if official is not None else "moving time",
                "vdot": vdot(distance, time),
            }
        )
    return pd.DataFrame(rows).sort_values("localDate").reset_index(drop=True)
