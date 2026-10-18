"""Loading the research dataset.

Derived metrics (TRIMP, efficiency factor, GAP, run class, ...) come from the
app's /api/research/dataset endpoint, so they're computed by the same tested
code as the app. Raw data with no derived form (Strava best efforts, manual
PRs, Garmin days) is read straight from the snapshot database.
"""

import json
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from sqlalchemy import create_engine, text

from .config import DATA_DIR, api_url, database_url


def fetch_dataset(refresh: bool = False) -> dict:
    """The API's research dataset, cached per day in research/data/ so a
    notebook re-run analyses exactly the same numbers."""
    DATA_DIR.mkdir(exist_ok=True)
    cache = DATA_DIR / f"dataset-{date.today().isoformat()}.json"
    if cache.exists() and not refresh:
        return json.loads(cache.read_text(encoding="utf-8"))
    res = requests.get(f"{api_url()}/research/dataset", timeout=120)
    res.raise_for_status()
    dataset = res.json()["data"]
    cache.write_text(json.dumps(dataset), encoding="utf-8")
    return dataset


def load_cached_dataset(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def activities_frame(dataset: dict) -> pd.DataFrame:
    df = pd.json_normalize(dataset["activities"], max_level=0)
    df["localDate"] = pd.to_datetime(df["localDate"])
    df["week"] = df["localDate"].dt.to_period("W-SUN").dt.start_time
    return df.sort_values("localDate").reset_index(drop=True)


def daily_frame(dataset: dict) -> pd.DataFrame:
    df = pd.DataFrame(dataset["daily"])
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")


def _engine():
    return create_engine(database_url().replace("postgresql://", "postgresql+psycopg://", 1))


def best_efforts() -> pd.DataFrame:
    """Every Strava best effort (400m, 1K, 5K, ...) from each activity's latest
    detail dump — one row per (activity, distance)."""
    query = text(
        """
        WITH detail AS (
          SELECT DISTINCT ON (activity_id) activity_id, payload
          FROM activity_dumps WHERE source = 'detail'
          ORDER BY activity_id, fetched_at DESC
        )
        SELECT a.id AS activity_id, a.name AS activity_name,
               (a.start_date_local AT TIME ZONE 'UTC')::date AS local_date,
               a.distance AS activity_distance_m, a.moving_time AS activity_moving_s,
               a.average_heartrate AS activity_avg_hr,
               be ->> 'name' AS effort, (be ->> 'distance')::float AS distance_m,
               (be ->> 'elapsed_time')::int AS elapsed_s
        FROM detail d
        JOIN activities a ON a.id = d.activity_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.payload -> 'best_efforts', '[]'::jsonb)) be
        WHERE a.type = 'Run'
        """
    )
    with _engine().connect() as conn:
        df = pd.read_sql(query, conn)
    df["local_date"] = pd.to_datetime(df["local_date"])
    return df


def manual_prs() -> pd.DataFrame:
    with _engine().connect() as conn:
        return pd.read_sql(
            text("SELECT distance_label, time_seconds, achieved_date, source_activity_id FROM manual_prs"), conn
        )


def garmin_days() -> pd.DataFrame:
    with _engine().connect() as conn:
        df = pd.read_sql(text("SELECT * FROM garmin_days ORDER BY day"), conn)
    df["day"] = pd.to_datetime(df["day"])
    return df
