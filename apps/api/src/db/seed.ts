import type postgres from "postgres";

type Sql = postgres.Sql;

interface GoalSeedRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  type: string;
  target_value: number;
  current_value: number;
  unit: string;
  target_date: string | null;
  status: string;
  prioritized: boolean;
}

interface PbSeedRow {
  id: string;
  distance: number;
  distance_label: string;
  time: number;
  pace: number;
  goal_time: number | null;
  goal_pace: number | null;
  date: string;
}

// prettier-ignore
const GOAL_SEED: GoalSeedRow[] = [
  // ── Running ──────────────────────────────────────────────────────────────
  { id: "g-beer-mile",   name: "Beer Mile",                         description: null, category: "running",   type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-sub6-mile",   name: "Sub 6 Minute Mile",                 description: null, category: "running",   type: "time",       target_value: 360,   current_value: 355,  unit: "seconds",    target_date: null, status: "completed", prioritized: false },
  { id: "g-sub20-5k",    name: "Sub 20 Minute 5K",                  description: null, category: "running",   type: "time",       target_value: 1200,  current_value: 1186, unit: "seconds",    target_date: null, status: "completed", prioritized: false },
  { id: "g-sub40-10k",   name: "Sub 40 Minute 10K",                 description: null, category: "running",   type: "time",       target_value: 2400,  current_value: 2382, unit: "seconds",    target_date: null, status: "completed", prioritized: false },
  { id: "g-sub130-hm",   name: "Sub 1:30 Half Marathon",            description: null, category: "running",   type: "time",       target_value: 5400,  current_value: 5436, unit: "seconds",    target_date: null, status: "active",    prioritized: true  },
  { id: "g-sub330-mara", name: "Sub 3:30 Marathon",                 description: null, category: "running",   type: "time",       target_value: 12600, current_value: 12730, unit: "seconds",   target_date: null, status: "active",    prioritized: true  },
  { id: "g-sub300-mara", name: "Sub 3:00 Marathon",                 description: null, category: "running",   type: "time",       target_value: 10800, current_value: 12730, unit: "seconds",   target_date: null, status: "active",    prioritized: false },
  { id: "g-mara-7cont",  name: "Marathon on Every Continent",       description: null, category: "running",   type: "completion", target_value: 7,     current_value: 0,    unit: "continents", target_date: null, status: "active",    prioritized: false },
  { id: "g-wings35k",    name: "35K Wings for Life Run (5:09/km)",  description: null, category: "running",   type: "distance",   target_value: 35,    current_value: 0,    unit: "km",         target_date: null, status: "active",    prioritized: false },

  // ── Triathlon & Multi-Sport ───────────────────────────────────────────────
  { id: "g-tri-complete", name: "Complete a Triathlon",             description: null, category: "triathlon", type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-oly-tri",      name: "Sub 3 Hour Olympic Triathlon",     description: null, category: "triathlon", type: "time",       target_value: 10800, current_value: 0,    unit: "seconds",    target_date: null, status: "active",    prioritized: false },
  { id: "g-half-iron",    name: "Sub 6 Hour Half-Ironman",          description: null, category: "triathlon", type: "time",       target_value: 21600, current_value: 0,    unit: "seconds",    target_date: null, status: "active",    prioritized: false },
  { id: "g-ironman",      name: "Sub 13 Hour Ironman",              description: null, category: "triathlon", type: "time",       target_value: 46800, current_value: 0,    unit: "seconds",    target_date: null, status: "active",    prioritized: false },

  // ── Ultra Endurance ───────────────────────────────────────────────────────
  { id: "g-backyard",    name: "Backyard Ultra (24 Loops)",         description: null, category: "ultra",     type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-50k",         name: "Complete 50K Trail Ultra",          description: null, category: "ultra",     type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-100k",        name: "Complete 100K Trail Ultra",         description: null, category: "ultra",     type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-100m",        name: "Complete 100M Trail Ultra",         description: null, category: "ultra",     type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-utmb",        name: "Complete a UTMB Event",             description: null, category: "ultra",     type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },

  // ── Adventure ─────────────────────────────────────────────────────────────
  { id: "g-swim-3k",     name: "Open Water 3K Swim",                description: null, category: "adventure", type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-climb4k",     name: "Climb 4000m+",                      description: null, category: "adventure", type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-kili",        name: "Climb Kilimanjaro",                  description: null, category: "adventure", type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },

  // ── Fitness ───────────────────────────────────────────────────────────────
  { id: "g-mud-run",     name: "Complete a Mud Run",                 description: null, category: "fitness",   type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-murph",       name: "Complete a Murph",                   description: null, category: "fitness",   type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-hyrox",       name: "Sub 1:15 Hyrox",                     description: null, category: "fitness",   type: "time",       target_value: 4500,  current_value: 0,    unit: "seconds",    target_date: null, status: "active",    prioritized: true  },
  { id: "g-deadlift",    name: "Deadlift 2x Bodyweight",             description: null, category: "fitness",   type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
  { id: "g-bench",       name: "Bench Press Bodyweight",             description: null, category: "fitness",   type: "completion", target_value: 1,     current_value: 0,    unit: "completion", target_date: null, status: "active",    prioritized: false },
];

const PB_SEED: PbSeedRow[] = [
  { id: "pb-5k",   distance: 5,       distance_label: "5K",           time: 1186,  pace: 237, goal_time: 1140,  goal_pace: 225, date: "2024-09-15" },
  { id: "pb-10k",  distance: 10,      distance_label: "10K",          time: 2382,  pace: 238, goal_time: 2340,  goal_pace: 234, date: "2024-10-20" },
  { id: "pb-hm",   distance: 21.0975, distance_label: "Half Marathon", time: 5436,  pace: 257, goal_time: 5100,  goal_pace: 242, date: "2024-11-03" },
  { id: "pb-mara", distance: 42.195,  distance_label: "Marathon",      time: 12730, pace: 301, goal_time: 12000, goal_pace: 284, date: "2025-04-06" },
];

export async function seedIfEmpty(sql: Sql): Promise<void> {
  const [{ count: goalCount }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::INTEGER AS count FROM goals
  `;
  if (goalCount === 0) {
    await sql`INSERT INTO goals ${sql(GOAL_SEED)}`;
    console.log(`Seeded ${GOAL_SEED.length} goals`);
  }

  const [{ count: pbCount }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::INTEGER AS count FROM personal_bests
  `;
  if (pbCount === 0) {
    await sql`INSERT INTO personal_bests ${sql(PB_SEED)}`;
    console.log(`Seeded ${PB_SEED.length} personal bests`);
  }
}
