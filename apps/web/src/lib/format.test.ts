import { describe, it, expect } from "vitest";
import {
  formatTime,
  formatPace,
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
