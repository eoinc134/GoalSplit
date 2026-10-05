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
from garmy.localdb.models import MetricType
from garmy.localdb.progress import ProgressReporter
from garmy.localdb.sync import SyncManager


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


def print_failure_reasons(db_path: str, start_date: date, end_date: date) -> None:
    # garmy's own ProgressReporter only ever logs "[date] metric (failed)" —
    # the actual exception, though it IS captured (SyncManager._sync_date
    # stores str(e) in sync_status.error_message), is never surfaced. Without
    # this, a systematic failure (e.g. every "sleep" task across two weeks)
    # looks identical in the log to a handful of unrelated one-off failures.
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT metric_type, error_message, COUNT(*)
            FROM sync_status
            WHERE status = 'failed' AND sync_date BETWEEN ? AND ?
            GROUP BY metric_type, error_message
            ORDER BY metric_type
            """,
            (start_date.isoformat(), end_date.isoformat()),
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return

    print("\nFailure reasons:")
    for metric_type, error_message, count in rows:
        print(f"  {metric_type} x{count}: {error_message}")


def main() -> int:
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

    if stats["failed"]:
        print_failure_reasons(args.db_path, start_date, end_date)

    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
