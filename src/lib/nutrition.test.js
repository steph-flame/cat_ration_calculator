import { describe, it, expect } from "vitest";
import { RER, computeTargets, bcsToPct, pctToBcs, defaultFactors, ageMonthsFromDob, effectiveAgeMonths, ADULT_DEFAULT_AGE_MONTHS } from "./nutrition.js";

// A minimal profile; override per test.
const profile = (over = {}) => ({
  weightKg: 5, ageMonths: 24, neutered: true,
  bcMode: "pct", pctOver: 0, bcs: 5, goal: "maintain",
  customTarget: "", gentleBasis: "current",
  factors: { ...defaultFactors }, ...over,
});

describe("RER", () => {
  it("is 70 * kg^0.75", () => {
    expect(RER(5)).toBeCloseTo(70 * Math.pow(5, 0.75), 6);
  });
});

describe("maintain uses the adult factor, never the growth factor", () => {
  // The 424-kcal regression: maintenance must multiply RER by the adult status
  // factor at *any* age — it must not borrow the (much larger) kitten growth factor.
  it("adult neutered: maintain = RER * 1.2", () => {
    const t = computeTargets(profile({ ageMonths: 24 }));
    expect(t.refs.maintain).toBeCloseTo(t.rerCur * 1.2, 6);
  });
  it("kitten: maintain still uses the adult factor and stays below growth", () => {
    const t = computeTargets(profile({ ageMonths: 6 }));
    expect(t.refs.maintain).toBeCloseTo(t.rerCur * 1.2, 6); // adult factor, not growthFactor
    expect(t.refs.maintain).toBeLessThan(t.refs.grow);       // growth funds more than maintenance
  });
});

describe("growth factor taper", () => {
  const gf = (ageMonths) => computeTargets(profile({ ageMonths, neutered: true })).growthFactor;
  it("holds at the kitten peak (2.5) through 4 months", () => {
    expect(gf(2)).toBeCloseTo(2.5, 6);
    expect(gf(4)).toBeCloseTo(2.5, 6);
  });
  it("lands on the adult factor (1.2) by 12 months", () => {
    expect(gf(12)).toBeCloseTo(1.2, 6);
  });
  it("is ~1.52 at 10 months (linear taper between the two)", () => {
    expect(gf(10)).toBeCloseTo(1.525, 3);
  });
});

describe("BCS <-> % round-trips", () => {
  it("BCS 7 -> 20% -> BCS 7", () => {
    expect(bcsToPct(7)).toBe(20);
    expect(pctToBcs(20)).toBe(7);
  });
  it("every integer BCS survives the round trip", () => {
    for (let bcs = 1; bcs <= 9; bcs++) {
      expect(pctToBcs(bcsToPct(bcs))).toBe(bcs);
    }
  });
  it("clamps out-of-range percentages into 1-9", () => {
    expect(pctToBcs(200)).toBe(9);
    expect(pctToBcs(-200)).toBe(1);
  });
});

describe("ageMonthsFromDob (age derives from birthday, so it never goes stale)", () => {
  it("counts months between dob and the as-of date", () => {
    // exactly one (average) month later
    expect(ageMonthsFromDob("2026-01-01", "2026-01-31")).toBeCloseTo(30 / 30.4375, 3);
    // ~10 months
    expect(ageMonthsFromDob("2025-09-12", "2026-07-12")).toBeCloseTo(303 / 30.4375, 2);
  });
  it("advances as the as-of date advances (same dob, later day → older)", () => {
    const a = ageMonthsFromDob("2025-01-01", "2026-01-01");
    const b = ageMonthsFromDob("2025-01-01", "2026-07-01");
    expect(b).toBeGreaterThan(a);
  });
  it("returns null for missing, invalid, or future dob so callers fall back to a stored age", () => {
    expect(ageMonthsFromDob("", "2026-07-12")).toBeNull();
    expect(ageMonthsFromDob("2026-07-12", "")).toBeNull();
    expect(ageMonthsFromDob("not-a-date", "2026-07-12")).toBeNull();
    expect(ageMonthsFromDob("2027-01-01", "2026-07-12")).toBeNull(); // dob in the future
  });
});

describe("effectiveAgeMonths (a missing dob is never a fabricated newborn)", () => {
  it("returns the real age when dob is set", () => {
    expect(effectiveAgeMonths("2025-09-12", "2026-07-12")).toBeCloseTo(303 / 30.4375, 2);
  });
  it("returns the adult default when dob is missing, invalid, or future", () => {
    expect(effectiveAgeMonths("", "2026-07-12")).toBe(ADULT_DEFAULT_AGE_MONTHS);
    expect(effectiveAgeMonths(undefined, "2026-07-12")).toBe(ADULT_DEFAULT_AGE_MONTHS);
    expect(effectiveAgeMonths("2027-01-01", "2026-07-12")).toBe(ADULT_DEFAULT_AGE_MONTHS); // future dob
  });
  it("the adult default is well clear of the kitten cutoff (12 months)", () => {
    expect(ADULT_DEFAULT_AGE_MONTHS).toBeGreaterThanOrEqual(12);
  });
});

describe("computeTargets with a missing dob: the silent-overfeed regression", () => {
  // Before the fix, a missing dob fell through to age 0 -> "young kitten" stage,
  // the 2.5x kitten-peak factor, and "maintain" dropped from the goal list (silently
  // falling back to "grow", ~2x overfeeding an adult cat). This locks in the fix:
  // missing dob must resolve to an adult stage/factor with "maintain" preserved.
  it("missing dob -> adult stage, adult MER factor, maintain available and kept as the goal", () => {
    const age = effectiveAgeMonths(undefined, "2026-07-12");
    const t = computeTargets(profile({ ageMonths: age, goal: "maintain" }));
    expect(t.stage).toBe("adult");
    expect(t.growthFactor).toBeCloseTo(defaultFactors.neutered, 6); // no kitten taper
    expect(t.goalId).toBe("maintain"); // not silently dropped to "grow"
    expect(t.target).toBeCloseTo(t.rerCur * defaultFactors.neutered, 6);
  });
});

describe("computeTargets runs on the weight it's handed (current weight from the log)", () => {
  it("uses the passed-in weightKg, not any other source", () => {
    const t = computeTargets(profile({ weightKg: 6 }));
    expect(t.w).toBe(6);
    expect(t.rerCur).toBeCloseTo(RER(6), 6);
  });
});

describe("ideal weight backs out the excess", () => {
  it("20% over at 4.38 kg implies ~3.65 kg ideal", () => {
    const t = computeTargets(profile({ weightKg: 4.38, pctOver: 20 }));
    expect(t.idealWeight).toBeCloseTo(4.38 / 1.2, 4);
  });
  it("clamps ideal weight to a physiological band for a wild % (no runaway target)", () => {
    const t = computeTargets(profile({ weightKg: 5, pctOver: -95 }));
    expect(t.idealWeight).toBeLessThanOrEqual(2.5 * 5); // clamped, not w/0.05 = 100 kg
    expect(t.idealWeight).toBeGreaterThanOrEqual(0.4 * 5);
  });
});
