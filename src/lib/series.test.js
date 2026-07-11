import { describe, it, expect } from "vitest";
import { median, mean, addDays, diffDays, enumerateDays, dailyReduce, fillDaily, ewma, linreg } from "./series.js";

describe("median / mean", () => {
  it("median of odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it("mean", () => expect(mean([2, 4, 6])).toBe(4));
});

describe("day arithmetic", () => {
  it("adds and diffs days across a month/DST boundary (UTC)", () => {
    expect(addDays("2026-03-08", 3)).toBe("2026-03-11");
    expect(diffDays("2026-02-27", "2026-03-02")).toBe(3);
    expect(enumerateDays("2026-01-01", "2026-01-04")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  });
});

describe("dailyReduce", () => {
  it("medians multiple same-day weigh-ins and sorts by day", () => {
    const out = dailyReduce([
      { date: "2026-01-02", value: 5.0 },
      { date: "2026-01-01", value: 4.9 },
      { date: "2026-01-02", value: 5.2 },
      { date: "2026-01-02", value: 5.1 },
    ], median);
    expect(out).toEqual([{ date: "2026-01-01", value: 4.9 }, { date: "2026-01-02", value: 5.1 }]);
  });
  it("sums intake per day and skips junk entries", () => {
    const out = dailyReduce([
      { date: "2026-01-01", value: 60 },
      { date: "2026-01-01", value: 40 },
      { date: "2026-01-01", value: NaN },
      { date: null, value: 10 },
    ], (v) => v.reduce((a, b) => a + b, 0));
    expect(out).toEqual([{ date: "2026-01-01", value: 100 }]);
  });
});

describe("fillDaily", () => {
  it("linearly interpolates gaps", () => {
    const out = fillDaily([{ date: "2026-01-01", value: 10 }, { date: "2026-01-03", value: 20 }], "interp");
    expect(out.map((d) => d.value)).toEqual([10, 15, 20]);
    expect(out[1].filled).toBe(true);
  });
  it("holds previous value when asked", () => {
    const out = fillDaily([{ date: "2026-01-01", value: 10 }, { date: "2026-01-03", value: 20 }], "hold");
    expect(out.map((d) => d.value)).toEqual([10, 10, 20]);
  });
});

describe("linreg", () => {
  it("recovers slope and intercept of a clean line", () => {
    const { slope, intercept, slopeSE } = linreg([2, 4, 6, 8]); // y = 2 + 2x
    expect(slope).toBeCloseTo(2, 9);
    expect(intercept).toBeCloseTo(2, 9);
    expect(slopeSE).toBeCloseTo(0, 9);
  });
});

describe("ewma", () => {
  it("seeds on the first value and tracks a constant", () => {
    expect(ewma([5, 5, 5], 0.3)).toEqual([5, 5, 5]);
  });
});
