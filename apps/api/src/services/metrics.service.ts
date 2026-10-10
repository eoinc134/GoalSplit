import type postgres from "postgres";
import { sql } from "../db/index.js";
import { computeActivityMetrics, METRICS_VERSION } from "../lib/activity-metrics.js";

const BATCH_SIZE = 20;
// A first run over a long history can take a while; stop after this and let
// the next request carry on, rather than holding one request open for minutes.
const TIME_BUDGET_MS = 20_000;

export interface EnsureMetricsResult {
  computed: number;
  pending: number; // activities with streams still waiting to be processed
}

let inflight: Promise<EnsureMetricsResult> | null = null;

// Fills activity_metrics for every activity whose streams dump hasn't been
// processed at the current METRICS_VERSION. The training page fires several
// endpoints in parallel, so concurrent callers share one in-flight run.
export function ensureActivityMetrics(userId: string): Promise<EnsureMetricsResult> {
  inflight ??= run(userId).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function pendingIds(userId: string, limit: number | null): Promise<{ id: string; type: string; distance: number }[]> {
  return sql<{ id: string; type: string; distance: number }[]>`
    SELECT a.id, a.type, a.distance
    FROM activities a
    WHERE a.user_id = ${userId}
      AND EXISTS (SELECT 1 FROM activity_dumps d WHERE d.activity_id = a.id AND d.source = 'streams')
      AND NOT EXISTS (SELECT 1 FROM activity_metrics m WHERE m.activity_id = a.id AND m.version = ${METRICS_VERSION})
    ORDER BY a.start_date DESC
    ${limit !== null ? sql`LIMIT ${limit}` : sql``}
  `;
}

async function run(userId: string): Promise<EnsureMetricsResult> {
  const started = Date.now();
  let computed = 0;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const batch = await pendingIds(userId, BATCH_SIZE);
    if (batch.length === 0) return { computed, pending: 0 };

    // Only the arrays the metrics need — skips latlng/velocity/cadence/watts,
    // which are most of a streams payload's size.
    const streamRows = await sql<{ activity_id: string; streams: Record<string, unknown> }[]>`
      SELECT DISTINCT ON (activity_id) activity_id,
        jsonb_build_object(
          'time', payload -> 'time',
          'distance', payload -> 'distance',
          'heartrate', payload -> 'heartrate',
          'grade_smooth', payload -> 'grade_smooth',
          'altitude', payload -> 'altitude',
          'moving', payload -> 'moving',
          'temp', payload -> 'temp'
        ) AS streams
      FROM activity_dumps
      WHERE activity_id = ANY(${batch.map((b) => b.id)}) AND source = 'streams'
      ORDER BY activity_id, fetched_at DESC
    `;
    const streamsById = new Map(streamRows.map((r) => [r.activity_id, r.streams]));

    for (const act of batch) {
      const streams = streamsById.get(act.id);
      const metrics = streams
        ? computeActivityMetrics(streams, { isRun: act.type === "Run", summaryDistanceM: act.distance })
        : null;
      await sql`
        INSERT INTO activity_metrics (activity_id, version, metrics, computed_at)
        VALUES (${act.id}, ${METRICS_VERSION}, ${metrics ? sql.json(metrics as unknown as postgres.JSONValue) : null}, NOW())
        ON CONFLICT (activity_id) DO UPDATE SET
          version = EXCLUDED.version, metrics = EXCLUDED.metrics, computed_at = EXCLUDED.computed_at
      `;
      computed++;
    }
  }

  const remaining = await pendingIds(userId, null);
  return { computed, pending: remaining.length };
}
