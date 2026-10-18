"""Connection settings, read from research/.env (gitignored)."""

import os
from pathlib import Path

from dotenv import load_dotenv

RESEARCH_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = RESEARCH_DIR / "data"  # gitignored: cached dataset snapshots

load_dotenv(RESEARCH_DIR / ".env")


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set — copy research/.env.example to research/.env")
    if "rlwy.net" in url or "railway" in url:
        raise RuntimeError("DATABASE_URL points at Railway — research runs on the local snapshot only")
    return url


def api_url() -> str:
    return os.environ.get("GOALSPLIT_API_URL", "http://localhost:3002/api")
