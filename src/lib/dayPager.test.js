import { describe, it, expect } from "vitest";
import {
  earliestLoggedDay, clampDay, canGoPrev, canGoNext, shiftDay, dayStripWindow, formatDayLabel,
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
