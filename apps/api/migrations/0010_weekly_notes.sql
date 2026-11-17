-- Coaching notes Claude writes in Claude Desktop and saves through the MCP
-- `save_weekly_note` tool (apps/mcp-trainer), one per reviewed week, shown on
-- the dashboard. Saving again for the same week replaces the note.

-- Up Migration

CREATE TABLE IF NOT EXISTS weekly_notes (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  source      TEXT NOT NULL DEFAULT 'claude',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, week_start)
);

-- Down Migration

DROP TABLE IF EXISTS weekly_notes;
