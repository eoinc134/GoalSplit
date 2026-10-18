import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/user.service.js", () => ({ getCurrentUserId: vi.fn() }));

vi.mock("../services/analytics-data.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/analytics-data.service.js")>()),
  getPhysiology: vi.fn(),
  loadAnalyticsActivities: vi.fn(),
}));

import { app } from "../app.js";
import { getCurrentUserId } from "../services/user.service.js";
import { getPhysiology, loadAnalyticsActivities, physiologyFrom } from "../services/analytics-data.service.js";
import type { AnalyticsActivity } from "../lib/analytics-activity.js";

function race(id: string, name: string, localDate: string, distanceM: number, movingTimeS: number): AnalyticsActivity {
  return {
    id,
    name,
    type: "Run",
    localDate,
    movingTimeS,
    distanceM,
    elevationGainM: 10,
    averageHeartrate: 190,
    workoutType: 1,
    isWeekLongest: false,
    metrics: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/prs/predictions", () => {
  it("returns no predictions when no athlete is connected", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    const res = await request(app).get("/api/prs/predictions");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ level: null, predictions: [], backtest: [] });
  });

  it("predicts all four standard distances from recent road races", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue("user-1");
    vi.mocked(getPhysiology).mockResolvedValue(
      physiologyFrom({ activityMaxHr: 214, garminMaxHr: null, restingMedian: 46, sex: null }),
    );
    vi.mocked(loadAnalyticsActivities).mockResolvedValue({
      today: "2026-10-18",
      firstActivityDate: "2026-01-01",
      metricsPending: 0,
      activities: [
        race("r1", "Lucca Parkrun", "2026-06-01", 5036, 1250),
        race("r2", "Pisa 10k", "2026-10-11", 10_672, 2665),
      ],
    });

    const res = await request(app).get("/api/prs/predictions");

    expect(res.body.data.level.stale).toBe(false);
    expect(res.body.data.predictions.map((p: { label: string }) => p.label)).toEqual([
      "5K",
      "10K",
      "Half marathon",
      "Marathon",
    ]);
    expect(res.body.data.races).toHaveLength(2);
    expect(res.body.data.backtest).toHaveLength(1); // the 10k, predicted from the parkrun
    expect(loadAnalyticsActivities).toHaveBeenCalledWith("user-1", { runsOnly: true });
  });
});
