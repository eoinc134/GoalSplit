#!/usr/bin/env python3
"""Non-interactive Garmin sync wrapper around garmy's SyncManager.

garmy's own CLI (garmy.localdb.cli) has two problems for unattended,
server-side use:

1. `cmd_sync`'s `get_credentials()` always prompts interactively via
   input()/getpass.getpass() — there's no env-var support anywhere in the
   package.
2. `SyncManager.initialize()` always performs a brand-new full OAuth/SSO
   login, even though garmy's own `AuthClient` already supports loading a
   previously saved session from disk and refreshing an expired access
   token without a full re-login (`is_authenticated`, `needs_refresh`,
   `refresh_tokens()` — see garmy/auth/client.py).

A background service doing a full login on every sync is exactly what
tripped Garmin's SSO rate limiting (429) in production. This script fixes
both by using garmy's public API directly instead of its CLI: cached session
first, a lightweight token refresh second, and a full email/password login
only as the last resort. No changes to garmy itself.
"""

import argparse
import os
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

from garmy import APIClient, AuthClient
from garmy.localdb.activities_iterator import ActivitiesIterator
from garmy.localdb.config import LocalDBConfig
from garmy.localdb.extractors import DataExtractor
from garmy.localdb.models import MetricType
from garmy.localdb.progress import ProgressReporter
from garmy.localdb.sync import SyncManager
from garmy.metrics.body_battery import BodyBattery
from garmy.metrics.sleep import SleepSummary


def patch_garmy_bugs() -> None:
    """Patch three confirmed garmy 2.0.0 bugs, found by reading the published
    source after they caused real sync failures in production. All three are
    missing-null-data-handling bugs in garmy's own parsing/extraction code,
    not anything in our integration — patched here rather than filed upstream
    since we need this working now, not on garmy's release schedule.
    """

    # 1. SleepSummary.total_sleep_duration_hours does `self.sleep_time_seconds
    # / 3600` with no null check, unlike its sibling properties (e.g.
    # deep_sleep_percentage) which do guard with `if ... > 0`. Crashes with
    # "unsupported operand type(s) for /: 'NoneType' and 'int'" on any day
    # with no detected sleep session — which was every single day in a real
    # 14-day sync, confirmed via garmy/metrics/sleep.py.
    def _safe_total_sleep_duration_hours(self) -> "float | None":
        seconds = self.sleep_time_seconds
        return seconds / 3600 if seconds else None

    SleepSummary.total_sleep_duration_hours = property(_safe_total_sleep_duration_hours)

    # 2. extract_timeseries_data doesn't filter out None values before
    # inserting into timeseries.value, which is NOT NULL — crashes on
    # sqlite3.IntegrityError the first time Garmin's raw per-minute
    # heart_rate/body_battery arrays contain a gap (e.g. watch off-wrist or
    # charging). Wrapping rather than reimplementing the per-metric-type
    # branching in garmy/localdb/extractors.py — just drop null readings
    # after the fact, whichever metric type produced them.
    original_extract_timeseries_data = DataExtractor.extract_timeseries_data

    def _extract_timeseries_data_no_nulls(self, data, metric_type):
        return [(ts, value, meta) for (ts, value, meta) in original_extract_timeseries_data(self, data, metric_type) if value is not None]

    DataExtractor.extract_timeseries_data = _extract_timeseries_data_no_nulls

    # 3. BodyBattery is a dataclass with body_battery_values_array as a
    # required (no-default) field, but Garmin's API sometimes omits that key
    # entirely for a given day — garmy/core/metrics.py constructs it via
    # `self.metric_class(**filtered_kwargs)`, so a missing key means a
    # missing kwarg, crashing with "BodyBattery.__init__() missing 1
    # required positional argument" before extraction even runs. Default it
    # to an empty list (same as "no readings", the correct interpretation
    # of the data simply being absent).
    original_body_battery_init = BodyBattery.__init__

    def _body_battery_init_with_default(self, *args, **kwargs):
        if "body_battery_values_array" not in kwargs and len(args) < 3:
            kwargs["body_battery_values_array"] = []
        original_body_battery_init(self, *args, **kwargs)

    BodyBattery.__init__ = _body_battery_init_with_default


def authenticate(token_dir: str, email: str, password: str) -> AuthClient:
    # AuthClient.__init__ auto-loads any tokens already on disk at token_dir.
    auth_client = AuthClient(token_dir=token_dir)

    if auth_client.is_authenticated:
        print("Using cached Garmin session (no login needed)")
        return auth_client

    if auth_client.needs_refresh:
        print("Cached session expired - refreshing token (no full login needed)")
        try:
            auth_client.refresh_tokens()
            return auth_client
        except Exception as e:  # noqa: BLE001 - any refresh failure falls back to login
            print(f"Token refresh failed ({e}), falling back to full login")

    print("No valid cached session - performing full login")
    auth_client.login(email, password)
    return auth_client

def main() -> int:
    patch_garmy_bugs()

    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--token-dir", required=True)
    parser.add_argument("--last-days", type=int, default=7)
    args = parser.parse_args()

    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if not email or not password:
        print("Error: GARMIN_EMAIL and GARMIN_PASSWORD must be set", file=sys.stderr)
        return 1

    try:
        auth_client = authenticate(args.token_dir, email, password)
    except Exception as e:  # noqa: BLE001 - surface any auth failure clearly, then exit
        print(f"Error: {e}", file=sys.stderr)
        return 1

    end_date = date.today()
    start_date = end_date - timedelta(days=args.last_days - 1)
    print(f"Syncing data from {start_date} to {end_date}")

    progress = ProgressReporter(use_tqdm=False)
    config = LocalDBConfig()
    manager = SyncManager(db_path=Path(args.db_path), config=config, progress_reporter=progress)

    # Mirrors SyncManager.initialize(), but with our already-authenticated
    # client instead of one that always performs a fresh login.
    try:
        api_client = APIClient(auth_client=auth_client)
        manager.api_client = api_client
        manager.activities_iterator = ActivitiesIterator(api_client, config.sync, progress)
        manager.activities_iterator.initialize()
    except Exception as e:  # noqa: BLE001 - mirrors SyncManager.initialize()'s own handling
        print(f"Failed to initialize: {e}", file=sys.stderr)
        return 1

    try:
        stats = manager.sync_range(
            user_id=1,
            start_date=start_date,
            end_date=end_date,
            metrics=list(MetricType),
        )
    except Exception as e:  # noqa: BLE001 - surface any sync failure clearly, then exit
        print(f"Error during sync: {e}", file=sys.stderr)
        return 1

    print("\nSync completed!")
    print(f"  Completed: {stats['completed']}")
    print(f"  Skipped: {stats['skipped']}")
    print(f"  Failed: {stats['failed']}")
    print(f"  Total tasks: {stats['total_tasks']}")

    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
