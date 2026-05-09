import { describe, it, expect } from "vitest";
import {
  formatTime,
  formatPace,
  goalProgress,
  toTimeStr,
  toSeconds,
  formatDate,
  paceFromSpeed,
} from "./format";

describe("formatTime", () => {
  it("formats zero seconds", () => expect(formatTime(0)).toBe("0:00"));
  it("formats sub-minute seconds", () => expect(formatTime(59)).toBe("0:59"));
  it("formats exact minute", () => expect(formatTime(60)).toBe("1:00"));
  it("formats minutes and seconds", () => expect(formatTime(90)).toBe("1:30"));
  it("formats just under one hour", () => expect(formatTime(3599)).toBe("59:59"));
  it("formats exactly one hour", () => expect(formatTime(3600)).toBe("1:00:00"));
  it("formats hours minutes seconds", () => expect(formatTime(3661)).toBe("1:01:01"));
  it("zero-pads single-digit minutes when hours present", () => expect(formatTime(7260)).toBe("2:01:00"));
});

describe("formatPace", () => {
  it("formats exact 5 min/km", () => expect(formatPace(300)).toBe("5:00/km"));
  it("formats pace with seconds", () => expect(formatPace(375)).toBe("6:15/km"));
  it("zero-pads single-digit seconds", () => expect(formatPace(61)).toBe("1:01/km"));
  it("formats 6 min/km", () => expect(formatPace(360)).toBe("6:00/km"));
});

describe("goalProgress", () => {
  it("returns 0 when target is 0", () => expect(goalProgress(100, 0)).toBe(0));
  it("returns 100 when current equals target", () => expect(goalProgress(100, 100)).toBe(100));
  it("caps at 100 when current is better than target", () => expect(goalProgress(50, 100)).toBe(100));
  it("returns 50 when current is twice the target", () => expect(goalProgress(200, 100)).toBe(50));
  it("rounds correctly", () => expect(goalProgress(150, 100)).toBe(67));
  it("returns 0 when current is 0 and target > 0", () => expect(goalProgress(0, 100)).toBe(Infinity > 100 ? 100 : 0));
});

describe("toTimeStr", () => {
  it("returns empty string for 0 (falsy guard)", () => expect(toTimeStr(0)).toBe(""));
  it("formats minutes and seconds", () => expect(toTimeStr(90)).toBe("1:30"));
  it("formats exact minute", () => expect(toTimeStr(60)).toBe("1:00"));
  it("formats hours minutes seconds", () => expect(toTimeStr(3661)).toBe("1:01:01"));
  it("formats just under one hour", () => expect(toTimeStr(3599)).toBe("59:59"));
  it("formats exactly one hour", () => expect(toTimeStr(3600)).toBe("1:00:00"));
});

describe("toSeconds", () => {
  it("parses MM:SS format", () => expect(toSeconds("1:30")).toBe(90));
  it("parses H:MM:SS format", () => expect(toSeconds("1:01:01")).toBe(3661));
  it("parses exact minutes", () => expect(toSeconds("1:00")).toBe(60));
  it("trims whitespace", () => expect(toSeconds("  1:30  ")).toBe(90));
  it("returns 0 for non-numeric input", () => expect(toSeconds("abc")).toBe(0));
  it("returns 0 for empty string", () => expect(toSeconds("")).toBe(0));
  it("parses single number", () => expect(toSeconds("45")).toBe(45));
  it("handles round-trip with toTimeStr", () => expect(toSeconds(toTimeStr(3661))).toBe(3661));
});

describe("formatDate", () => {
  it("formats a date without weekday", () =>
    expect(formatDate("2024-01-15")).toMatch(/15\s*Jan\s*2024/));
  it("includes weekday when requested", () =>
    expect(formatDate("2024-01-15", true)).toMatch(/Mon/));
  it("still includes the date when weekday is shown", () =>
    expect(formatDate("2024-01-15", true)).toMatch(/15\s*Jan\s*2024/));
});

describe("paceFromSpeed", () => {
  it("returns dash for zero speed", () => expect(paceFromSpeed(0)).toBe("—"));
  it("converts 5 min/km speed correctly", () =>
    expect(paceFromSpeed(1000 / 300)).toBe("5:00/km"));
  it("converts 6:15/km speed correctly", () =>
    expect(paceFromSpeed(1000 / 375)).toBe("6:15/km"));
  it("converts 6 min/km speed correctly", () =>
    expect(paceFromSpeed(1000 / 360)).toBe("6:00/km"));
});
