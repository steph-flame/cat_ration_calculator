import { describe, it, expect } from "vitest";
import { estimateExpenditure, floorSdKcal, WEIGH_METHODS, DEFAULT_METHOD } from "./expenditure.js";
import { addDays } from "./series.js";

// Build a synthetic history: constant daily intake, weight moving at the exact rate that
// intake vs. a KNOWN true maintenance implies. The estimator should recover that maintenance.
function history({ days = 28, intake = 200, maintenance = 250, rho = 8000, w0 = 5.0, start = "2026-01-01" }) {
  const ratePerDay = (intake - maintenance) / rho; // kg/day (negative => losing)
  const weightEntries = [];
  const intakeEntries = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    weightEntries.push({ date, value: w0 + ratePerDay * d });
    intakeEntries.push({ date, value: intake });
  }
  return { weightEntries, intakeEntries, rho };
}

describe("estimateExpenditure recovers true maintenance", () => {
  it("weight loss case: intake 200, true maintenance 250 → ~250", () => {
    const { weightEntries, intakeEntries, rho } = history({ intake: 200, maintenance: 250 });
    const r = estimateExpenditure(weightEntries, intakeEntries, { rho });
    expect(r.enoughData).toBe(true);
    expect(r.kcal).toBeCloseTo(250, 4);
    expect(r.rateKgPerWeek).toBeLessThan(0); // losing
  });
  it("weight gain case: intake 300, true maintenance 240 → ~240", () => {
    const { weightEntries, intakeEntries, rho } = history({ intake: 300, maintenance: 240 });
    const r = estimateExpenditure(weightEntries, intakeEntries, { rho });
    expect(r.kcal).toBeCloseTo(240, 4);
    expect(r.rateKgPerWeek).toBeGreaterThan(0);
  });
  it("weight-stable case: expenditure ≈ intake", () => {
    const { weightEntries, intakeEntries, rho } = history({ intake: 220, maintenance: 220 });
    const r = estimateExpenditure(weightEntries, intakeEntries, { rho });
    expect(r.kcal).toBeCloseTo(220, 4);
    expect(Math.abs(r.rateKgPerWeek)).toBeLessThan(1e-6);
  });
});

describe("robustness", () => {
  it("medians away symmetric intra-day weigh-in noise", () => {
    const { weightEntries, intakeEntries, rho } = history({ intake: 200, maintenance: 250 });
    // add two extra readings each day, symmetric around the true trend → median unchanged
    const noisy = weightEntries.flatMap((e) => [e, { date: e.date, value: e.value - 0.08 }, { date: e.date, value: e.value + 0.08 }]);
    const r = estimateExpenditure(noisy, intakeEntries, { rho });
    expect(r.kcal).toBeCloseTo(250, 3);
  });
  it("tolerates some missing intake days (fills from the logged mean)", () => {
    const { weightEntries, intakeEntries, rho } = history({ intake: 200, maintenance: 250 });
    const sparse = intakeEntries.filter((_, i) => i % 3 !== 0); // drop ~1/3 of days
    const r = estimateExpenditure(weightEntries, sparse, { rho });
    expect(r.enoughData).toBe(true);
    expect(r.kcal).toBeCloseTo(250, 2);
    expect(r.missingIntake).toBeGreaterThan(0);
  });
  it("reports not-enough-data below the minimum span", () => {
    const { weightEntries, intakeEntries, rho } = history({ days: 4 });
    const r = estimateExpenditure(weightEntries, intakeEntries, { rho, minDays: 10 });
    expect(r.enoughData).toBe(false);
  });
  it("handles an empty log without throwing", () => {
    const r = estimateExpenditure([], []);
    expect(r.enoughData).toBe(false);
    expect(r.kcal).toBeNull();
  });
  it("does NOT report a ±0 band from two sparse weigh-ins (false-precision guard)", () => {
    const w = [{ date: "2026-01-01", value: 5.0 }, { date: "2026-01-21", value: 4.7 }];
    const i = Array.from({ length: 21 }, (_, d) => ({ date: addDays("2026-01-01", d), value: 200 }));
    const r = estimateExpenditure(w, i, { minDays: 10 });
    expect(r.sd).toBeGreaterThan(5); // a real band, not ~0
  });
});

describe("floorSdKcal (displayed-uncertainty floor, day-zero honesty)", () => {
  it("is wide at zero logged days — a real ±15% band on the prior, not ±0", () => {
    const sd = floorSdKcal(0, 250);
    expect(sd).toBeCloseTo((0.15 * 250) / 1.96, 6);
    expect(1.96 * sd).toBeCloseTo(0.15 * 250, 6); // 95% band is ± 15% of the prior
  });
  it("decays monotonically as more days are logged", () => {
    const sds = [0, 2, 4, 6, 8].map((n) => floorSdKcal(n, 250));
    for (let i = 1; i < sds.length; i++) expect(sds[i]).toBeLessThan(sds[i - 1]);
  });
  it("is inactive (0) at and after the enoughData threshold", () => {
    expect(floorSdKcal(10, 250)).toBe(0);
    expect(floorSdKcal(11, 250)).toBe(0);
    expect(floorSdKcal(1000, 250)).toBe(0);
  });
  it("respects a custom threshold/floorPct", () => {
    expect(floorSdKcal(7, 250, { threshold: 7 })).toBe(0);
    const wider = floorSdKcal(0, 250, { floorPct: 0.3 });
    expect(wider).toBeCloseTo((0.3 * 250) / 1.96, 6);
  });
  it("never widens the ALREADY-enoughData band (callers use max(filterSd, floor), and floor is 0 there)", () => {
    // sanity: at the threshold the floor can't out-compete any nonnegative filter sd
    expect(Math.max(5, floorSdKcal(10, 250))).toBe(5);
  });
  it("degrades safely on bad inputs", () => {
    expect(floorSdKcal(0, null)).toBe(0);
    expect(floorSdKcal(0, 0)).toBe(0);
    expect(floorSdKcal(-3, 250)).toBeCloseTo(floorSdKcal(0, 250), 6); // negative days clamps to 0
  });
});

describe("weigh-method metadata (contract for precision-weighting later)", () => {
  it("every method carries a label and a positive per-reading sigma", () => {
    for (const m of Object.values(WEIGH_METHODS)) {
      expect(typeof m.label).toBe("string");
      expect(m.sigmaKg).toBeGreaterThan(0);
    }
  });
  it("the subtraction method is the noisiest, the pet scale the tightest", () => {
    expect(WEIGH_METHODS.difference.sigmaKg).toBeGreaterThan(WEIGH_METHODS.litterRobot.sigmaKg);
    expect(WEIGH_METHODS.petScale.sigmaKg).toBeLessThan(WEIGH_METHODS.litterRobot.sigmaKg);
  });
  it("the default method exists", () => {
    expect(WEIGH_METHODS[DEFAULT_METHOD]).toBeTruthy();
  });
});
