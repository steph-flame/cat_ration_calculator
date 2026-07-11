import { describe, it, expect } from "vitest";
import { ucEstimateExpenditure, kalmanEstimateExpenditure } from "./expenditure.js";
import { addDays } from "./series.js";

// Seeded RNG so the "with noise" tests are deterministic (mirrors research/v3_expenditure.py).
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

// Synthetic history: true slow weight (energy balance) + AR(1) gut-fill transient + sensor noise.
function synth(seed, { days = 70, intake = 210, E = 260, rho = 8000, w0 = 6.0, readsPerDay = 3,
  phiT = 0.5, sigmaT = 0.05, sigmaSensor = 0.02, method = "litterRobot" } = {}) {
  const r = mulberry32(seed);
  const eAt = typeof E === "function" ? E : () => E;
  const weightEntries = [], intakeEntries = [];
  let w = w0, T = 0;
  for (let d = 0; d < days; d++) {
    const date = addDays("2026-06-01", d);
    T = phiT * T + sigmaT * gauss(r);
    for (let i = 0; i < readsPerDay; i++) weightEntries.push({ date, value: w + T + sigmaSensor * gauss(r), method });
    intakeEntries.push({ date, value: intake });
    w += (intake - eAt(d)) / rho;
  }
  return { weightEntries, intakeEntries };
}

const eSeries = (res) => res.trend.map((t) => t.e);
const wobble = (es, tail = 21) => {
  const t = es.slice(-tail), diffs = t.slice(1).map((v, i) => v - t[i]);
  const m = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.sqrt(diffs.reduce((a, b) => a + (b - m) ** 2, 0) / diffs.length);
};

describe("v3 recovers true maintenance through the noise", () => {
  it("lands near the true 260 despite gut-fill transient + sensor noise", () => {
    const errs = [1, 2, 3, 4, 5].map((s) => Math.abs(ucEstimateExpenditure(...Object.values(synth(s)), { priorKcal: 250 }).kcal - 260));
    const meanErr = errs.reduce((a, b) => a + b, 0) / errs.length;
    expect(meanErr).toBeLessThan(6); // Python bench: tail MAE ~3 kcal
  });
});

describe("v3 vs v2: more stable under transients", () => {
  it("v3's expenditure estimate wobbles less than v2's on the same noisy data", () => {
    let v2sum = 0, v3sum = 0;
    for (const s of [11, 22, 33, 44, 55]) {
      const { weightEntries, intakeEntries } = synth(s);
      v2sum += wobble(eSeries(kalmanEstimateExpenditure(weightEntries, intakeEntries, { priorKcal: 250 })));
      v3sum += wobble(eSeries(ucEstimateExpenditure(weightEntries, intakeEntries, { priorKcal: 250 })));
    }
    expect(v3sum).toBeLessThan(v2sum); // the whole point of the transient state
  });
});

describe("v3 doesn't hurt on clean data and stays robust", () => {
  it("recovers maintenance when there is no transient at all", () => {
    const { weightEntries, intakeEntries } = synth(7, { sigmaT: 0, sigmaSensor: 0.005 });
    const r = ucEstimateExpenditure(weightEntries, intakeEntries, { priorKcal: 240 });
    expect(Math.abs(r.kcal - 260)).toBeLessThan(5);
    expect(r.enoughData).toBe(true);
  });
  it("eventually tracks a genuine step change in expenditure", () => {
    const { weightEntries, intakeEntries } = synth(3, { days: 90, intake: 250, E: (d) => (d < 40 ? 270 : 230) });
    const r = ucEstimateExpenditure(weightEntries, intakeEntries, { priorKcal: 270 });
    expect(Math.abs(r.kcal - 230)).toBeLessThan(Math.abs(r.kcal - 270)); // moved to the new level
  });
  it("empty log → not enough data", () => {
    expect(ucEstimateExpenditure([], []).enoughData).toBe(false);
  });
});
