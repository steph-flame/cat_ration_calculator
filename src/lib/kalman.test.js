import { describe, it, expect } from "vitest";
import { kalmanEstimateExpenditure, dailyWeightWithVariance } from "./expenditure.js";
import { addDays } from "./series.js";

// Generate weights that are exactly consistent with a known expenditure schedule and
// constant intake (via the same energy balance the filter assumes). Clean data → the
// filter must recover the true E. `E` may be a constant or a function of the day index.
function synth({ days = 45, intake = 200, E = 250, rho = 8000, w0 = 5.0, start = "2026-01-01", method = "petScale" }) {
  const eAt = typeof E === "function" ? E : () => E;
  const weightEntries = [], intakeEntries = [];
  let w = w0;
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    weightEntries.push({ date, value: w, method });
    intakeEntries.push({ date, value: intake });
    w = w + (intake - eAt(d)) / rho;
  }
  return { weightEntries, intakeEntries };
}

describe("dailyWeightWithVariance", () => {
  it("inverse-variance weights a mixed-method day toward the tighter reading", () => {
    const out = dailyWeightWithVariance([
      { date: "2026-01-01", value: 5.00, method: "petScale" },   // sigma 0.01
      { date: "2026-01-01", value: 5.40, method: "difference" }, // sigma 0.15 (loose)
    ]);
    // weighted mean sits far closer to the precise pet-scale reading than the midpoint
    expect(out[0].z).toBeLessThan(5.05);
    expect(out[0].R).toBeLessThan(0.01 * 0.01 * 1.01); // R ≈ tightest reading's variance
  });
  it("gates a gross same-day outlier off the median", () => {
    const out = dailyWeightWithVariance([
      { date: "2026-01-01", value: 5.0, method: "petScale" },
      { date: "2026-01-01", value: 5.0, method: "petScale" },
      { date: "2026-01-01", value: 6.5, method: "petScale" }, // dropped
    ]);
    expect(out[0].z).toBeCloseTo(5.0, 6);
  });
});

describe("kalmanEstimateExpenditure recovers true maintenance", () => {
  it("climbs from a wrong prior (200) to the true 250 on clean loss data", () => {
    const { weightEntries, intakeEntries } = synth({ E: 250, intake: 200, days: 60 });
    const r = kalmanEstimateExpenditure(weightEntries, intakeEntries, { priorKcal: 200 });
    expect(r.enoughData).toBe(true);
    expect(r.kcal).toBeGreaterThan(244);
    expect(r.kcal).toBeLessThan(256);
    expect(r.rateKgPerWeek).toBeLessThan(0);
  });
  it("weight-stable data → expenditure ≈ intake", () => {
    const { weightEntries, intakeEntries } = synth({ E: 220, intake: 220, days: 60 });
    const r = kalmanEstimateExpenditure(weightEntries, intakeEntries, { priorKcal: 200 });
    expect(r.kcal).toBeGreaterThan(214);
    expect(r.kcal).toBeLessThan(226);
  });
});

describe("confidence band and adaptation", () => {
  it("tightens with more data", () => {
    const short = synth({ E: 250, intake: 200, days: 14 });
    const long = synth({ E: 250, intake: 200, days: 60 });
    const sdShort = kalmanEstimateExpenditure(short.weightEntries, short.intakeEntries).sd;
    const sdLong = kalmanEstimateExpenditure(long.weightEntries, long.intakeEntries).sd;
    expect(sdLong).toBeLessThan(sdShort);
  });
  it("tracks a genuine step change in expenditure", () => {
    // maintenance drops from 260 to 220 at day 30
    const { weightEntries, intakeEntries } = synth({ E: (d) => (d < 30 ? 260 : 220), intake: 240, days: 70 });
    const r = kalmanEstimateExpenditure(weightEntries, intakeEntries, { priorKcal: 260 });
    expect(Math.abs(r.kcal - 220)).toBeLessThan(Math.abs(r.kcal - 260)); // moved toward the new level
    expect(r.kcal).toBeLessThan(240);
  });
  it("looser weigh-in method → wider confidence band", () => {
    const precise = synth({ E: 250, intake: 200, days: 45, method: "petScale" });
    const loose = synth({ E: 250, intake: 200, days: 45, method: "difference" });
    const sdPrecise = kalmanEstimateExpenditure(precise.weightEntries, precise.intakeEntries).sd;
    const sdLoose = kalmanEstimateExpenditure(loose.weightEntries, loose.intakeEntries).sd;
    expect(sdLoose).toBeGreaterThan(sdPrecise);
  });
});

describe("robustness", () => {
  it("rejects a single spurious weigh-in (partial-entry spike)", () => {
    const { weightEntries, intakeEntries } = synth({ E: 250, intake: 200, days: 60 });
    const clean = kalmanEstimateExpenditure(weightEntries, intakeEntries, { priorKcal: 200 }).kcal;
    const corrupted = weightEntries.map((e, i) => (i === 30 ? { ...e, value: e.value + 1.0 } : e));
    const withSpike = kalmanEstimateExpenditure(corrupted, intakeEntries, { priorKcal: 200 }).kcal;
    expect(Math.abs(withSpike - clean)).toBeLessThan(3); // barely moves
  });
  it("empty log → not enough data", () => {
    expect(kalmanEstimateExpenditure([], []).enoughData).toBe(false);
  });
});
