import { describe, it, expect } from "vitest";
import { decodePolyline, isValidRoute, buildActivityRoutes, type RoutePolylineRow } from "./polyline";

function makeRow(overrides: Partial<RoutePolylineRow> = {}): RoutePolylineRow {
  return {
    activity_id: "act-1",
    activity_name: "Morning Run",
    type: "Run",
    local_date: "2026-06-01",
    summary_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
    ...overrides,
  };
}

describe("decodePolyline", () => {
  it("decodes Google's own published test vector correctly", () => {
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toHaveLength(3);
    expect(points[0][0]).toBeCloseTo(38.5, 5);
    expect(points[0][1]).toBeCloseTo(-120.2, 5);
    expect(points[1][0]).toBeCloseTo(40.7, 5);
    expect(points[1][1]).toBeCloseTo(-120.95, 5);
    expect(points[2][0]).toBeCloseTo(43.252, 5);
    expect(points[2][1]).toBeCloseTo(-126.453, 5);
  });

  it("returns an empty array for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("does not throw or hang on a truncated/malformed string", () => {
    expect(() => decodePolyline("_p~iF~ps|U_ulL")).not.toThrow();
    expect(() => decodePolyline("???")).not.toThrow();
  });
});

describe("isValidRoute", () => {
  it("rejects fewer than 2 points", () => {
    expect(isValidRoute([])).toBe(false);
    expect(isValidRoute([[38.5, -120.2]])).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    expect(
      isValidRoute([
        [38.5, -120.2],
        [999, -120.2],
      ]),
    ).toBe(false);
    expect(
      isValidRoute([
        [38.5, -120.2],
        [38.5, 999],
      ]),
    ).toBe(false);
  });

  it("accepts a well-formed multi-point route", () => {
    expect(
      isValidRoute([
        [38.5, -120.2],
        [40.7, -120.95],
      ]),
    ).toBe(true);
  });
});

describe("buildActivityRoutes", () => {
  it("skips rows with a null or empty polyline", () => {
    const routes = buildActivityRoutes([makeRow({ summary_polyline: null }), makeRow({ activity_id: "act-2", summary_polyline: "" })]);
    expect(routes).toEqual([]);
  });

  it("skips a malformed encoding rather than throwing", () => {
    expect(() => buildActivityRoutes([makeRow({ summary_polyline: "???" })])).not.toThrow();
  });

  it("skips a polyline that decodes to a single point", () => {
    // A polyline encoding exactly one lat/lng pair, no delta beyond it.
    const routes = buildActivityRoutes([makeRow({ summary_polyline: "_p~iF~ps|U" })]);
    expect(routes).toEqual([]);
  });

  it("maps a valid row through correctly", () => {
    const routes = buildActivityRoutes([makeRow()]);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      activityId: "act-1",
      activityName: "Morning Run",
      type: "Run",
      localDate: "2026-06-01",
    });
    expect(routes[0].points).toHaveLength(3);
  });
});
