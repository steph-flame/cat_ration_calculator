import { describe, it, expect } from "vitest";
import {
  earliestLoggedDay, clampDay, canGoPrev, canGoNext, shiftDay, dayStripWindow, formatDayLabel,
  STRIP_RANGES, stripRangeWindow, stripColumnWidth, stripPeakKcal,
} from "./dayPager.js";
import { manualWeighInStamp, localDateOf } from "./series.js";

describe("earliestLoggedDay", () => {
  it("falls back to today when neither log has any entries", () => {
    expect(earliestLoggedDay([], [], "2026-07-14")).toBe("2026-07-14");
  });

  it("finds the earliest date across both logs", () => {
    const weight = [{ date: "2026-07-10" }, { date: "2026-07-05" }];
    const intake = [{ date: "2026-07-08" }, { date: "2026-07-01" }];
    expect(earliestLoggedDay(weight, intake, "2026-07-14")).toBe("2026-07-01");
  });

  it("ignores entries without a date", () => {
    const weight = [{ date: null }, { date: "2026-07-12" }];
    expect(earliestLoggedDay(weight, [], "2026-07-14")).toBe("2026-07-12");
  });

  it("only one log populated still works", () => {
    expect(earliestLoggedDay([], [{ date: "2026-06-20" }], "2026-07-14")).toBe("2026-06-20");
  });
});

describe("clampDay / canGoPrev / canGoNext", () => {
  it("clamps below the min and above the max", () => {
    expect(clampDay("2026-06-01", "2026-06-10", "2026-07-14")).toBe("2026-06-10");
    expect(clampDay("2026-08-01", "2026-06-10", "2026-07-14")).toBe("2026-07-14");
    expect(clampDay("2026-07-01", "2026-06-10", "2026-07-14")).toBe("2026-07-01");
  });

  it("canGoPrev is false exactly at the min bound", () => {
    expect(canGoPrev("2026-06-10", "2026-06-10")).toBe(false);
    expect(canGoPrev("2026-06-11", "2026-06-10")).toBe(true);
  });

  it("canGoNext is false exactly at today (the max bound)", () => {
    expect(canGoNext("2026-07-14", "2026-07-14")).toBe(false);
    expect(canGoNext("2026-07-13", "2026-07-14")).toBe(true);
  });
});

describe("shiftDay", () => {
  const min = "2026-07-01", max = "2026-07-14";
  it("steps forward and backward within range", () => {
    expect(shiftDay("2026-07-05", 1, min, max)).toBe("2026-07-06");
    expect(shiftDay("2026-07-05", -1, min, max)).toBe("2026-07-04");
  });
  it("holds at the max bound instead of going past today", () => {
    expect(shiftDay("2026-07-14", 1, min, max)).toBe("2026-07-14");
  });
  it("holds at the min bound instead of going before the earliest data", () => {
    expect(shiftDay("2026-07-01", -1, min, max)).toBe("2026-07-01");
  });
});

describe("dayStripWindow", () => {
  it("shows fewer than maxDays when history is shorter (no empty left-padding)", () => {
    const out = dayStripWindow("2026-07-10", "2026-07-14", 30);
    expect(out).toEqual(["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"]);
  });

  it("caps at maxDays when history is longer, always ending today", () => {
    const out = dayStripWindow("2026-01-01", "2026-07-14", 30);
    expect(out).toHaveLength(30);
    expect(out[out.length - 1]).toBe("2026-07-14");
    expect(out[0]).toBe("2026-06-15");
  });

  it("returns a single day when min equals today (brand-new cat, no data)", () => {
    expect(dayStripWindow("2026-07-14", "2026-07-14", 30)).toEqual(["2026-07-14"]);
  });

  it("defaults to unbounded — every day since minDate — when maxDays is omitted", () => {
    const out = dayStripWindow("2026-07-01", "2026-07-14");
    expect(out).toHaveLength(14);
    expect(out[0]).toBe("2026-07-01");
    expect(out[out.length - 1]).toBe("2026-07-14");
  });
});

describe("stripRangeWindow", () => {
  const days = ["2026-06-01", "2026-06-15", "2026-06-30", "2026-07-10", "2026-07-14"];

  it("slices the most recent N entries for a fixed range", () => {
    expect(stripRangeWindow(days, "2w")).toEqual(days.slice(-14));
    const range = STRIP_RANGES.find((r) => r.key === "2w");
    expect(stripRangeWindow(days.concat(Array.from({ length: 20 }, (_, i) => `x${i}`)), "2w"))
      .toHaveLength(range.days);
  });

  it("returns every day for the 'all' range", () => {
    expect(stripRangeWindow(days, "all")).toEqual(days);
  });

  it("returns every day for an unrecognized range key", () => {
    expect(stripRangeWindow(days, "bogus")).toEqual(days);
  });

  it("never returns more days than it was given", () => {
    expect(stripRangeWindow(days, "3m")).toEqual(days); // only 5 days exist, well under 90
  });
});

describe("stripColumnWidth", () => {
  it("fixed ranges size columns so `range.days` of them fill the container", () => {
    expect(stripColumnWidth("2w", 200, 700)).toBeCloseTo(700 / 14);
    expect(stripColumnWidth("1m", 200, 700)).toBeCloseTo(700 / 30);
  });

  it("'all' fits every rendered day into the container with no scrolling", () => {
    expect(stripColumnWidth("all", 50, 700)).toBeCloseTo(700 / 50);
  });

  it("a fixed range still fits-to-container when history is shorter than the range window", () => {
    // only 5 days logged, well under 2w's 14-day window — same fit-exactly behavior as "all"
    expect(stripColumnWidth("2w", 5, 700)).toBeCloseTo(700 / 5);
  });

  it("returns 0 for a not-yet-measured container or empty history", () => {
    expect(stripColumnWidth("1m", 10, 0)).toBe(0);
    expect(stripColumnWidth("1m", 0, 700)).toBe(0);
  });
});

describe("stripPeakKcal", () => {
  it("finds the max kcal across the given days, ignoring nulls", () => {
    const data = { a: { kcal: 100 }, b: { kcal: null }, c: { kcal: 262 }, d: { kcal: 50 } };
    expect(stripPeakKcal(["a", "b", "c", "d"], data)).toBe(262);
  });

  it("returns 0 when nothing in range has logged intake", () => {
    expect(stripPeakKcal(["a", "b"], { a: { kcal: null }, b: {} })).toBe(0);
    expect(stripPeakKcal([], {})).toBe(0);
  });
});

describe("formatDayLabel", () => {
  const today = "2026-07-14";
  it("labels today and yesterday specially", () => {
    expect(formatDayLabel("2026-07-14", today)).toBe("Today");
    expect(formatDayLabel("2026-07-13", today)).toBe("Yesterday");
  });
  it("formats an older same-year date without a year suffix", () => {
    expect(formatDayLabel("2026-06-01", today)).toBe("Jun 1");
  });
  it("appends the year when it differs from today's", () => {
    expect(formatDayLabel("2025-12-25", today)).toBe("Dec 25, 2025");
  });
});

// Confirms the viewed-day flow (pager → manualWeighInStamp) still honors the "ts only when
// the viewed day IS today" rule now that the picked date comes from paging, not a date input.
describe("viewed-day integration with manualWeighInStamp", () => {
  it("stamps a real ts when paging lands back on today", () => {
    const now = new Date(2026, 6, 14, 9, 0, 0).getTime();
    const today = localDateOf(now);
    const viewed = shiftDay(shiftDay(today, -1, "2026-06-01", today), 1, "2026-06-01", today); // back then forward → today
    expect(viewed).toBe(today);
    expect(manualWeighInStamp(viewed, now)).toEqual({ date: today, ts: now });
  });

  it("omits ts once paged back to a prior (backfill) day", () => {
    const now = new Date(2026, 6, 14, 9, 0, 0).getTime();
    const today = localDateOf(now);
    const viewed = shiftDay(today, -1, "2026-06-01", today);
    expect(manualWeighInStamp(viewed, now)).toEqual({ date: viewed });
  });
});
