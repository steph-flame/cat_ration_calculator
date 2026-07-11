import { describe, it, expect } from "vitest";
import { planWeightLoss, rateForTarget, RATE } from "./weightPlan.js";
import { RER } from "./nutrition.js";

describe("planWeightLoss deficit math", () => {
  it("1%/week of a 5 kg cat at 250 kcal maintenance → ~193 kcal target", () => {
    const p = planWeightLoss({ maintenanceKcal: 250, currentKg: 5, idealKg: 4, pctPerWeek: 1, rho: 8000 });
    expect(p.weeklyLossKg).toBeCloseTo(0.05, 6);           // 1% of 5 kg
    expect(p.dailyDeficit).toBeCloseTo((8000 * 0.05) / 7, 4); // ≈ 57.1
    expect(p.targetKcal).toBeCloseTo(250 - (8000 * 0.05) / 7, 4); // ≈ 192.9
  });
  it("projects weeks to reach ideal weight", () => {
    const p = planWeightLoss({ maintenanceKcal: 250, currentKg: 5, idealKg: 4.5, pctPerWeek: 1, rho: 8000 });
    expect(p.weeksToIdeal).toBeCloseTo(0.5 / 0.05, 4); // 0.5 kg excess / 0.05 kg per week = 10 wk
  });
});

describe("safety clamps", () => {
  it("caps a too-fast requested rate at the ceiling and warns", () => {
    const p = planWeightLoss({ maintenanceKcal: 300, currentKg: 6, idealKg: 4, pctPerWeek: 5, rho: 8000 });
    expect(p.rate).toBe(RATE.max);
    expect(p.warnings.some((w) => /hepatic lipidosis/i.test(w))).toBe(true);
  });
  it("floors the target at ~0.8×RER(ideal) and flags vet supervision", () => {
    // Tiny maintenance forces the raw target below the floor.
    const idealKg = 4;
    const p = planWeightLoss({ maintenanceKcal: 120, currentKg: 5, idealKg, pctPerWeek: 2, rho: 8000 });
    expect(p.belowFloor).toBe(true);
    expect(p.targetKcal).toBeCloseTo(0.8 * RER(idealKg), 6);
    expect(p.warnings.some((w) => /veterinary supervision/i.test(w))).toBe(true);
    // Floored → the plan actually loses SLOWER than the (capped) requested rate; report it honestly.
    expect(p.resultingRatePctPerWeek).toBeLessThan(p.rate);
  });
  it("resulting rate equals the requested rate when the floor doesn't bind", () => {
    const p = planWeightLoss({ maintenanceKcal: 260, currentKg: 5, idealKg: 4, pctPerWeek: 1, rho: 8000 });
    expect(p.belowFloor).toBe(false);
    expect(p.resultingRatePctPerWeek).toBeCloseTo(1, 6);
  });
  it("warns when the cat isn't overweight", () => {
    const p = planWeightLoss({ maintenanceKcal: 250, currentKg: 4, idealKg: 4, pctPerWeek: 1 });
    expect(p.overweight).toBe(false);
    expect(p.warnings.some((w) => /no deficit needed/i.test(w))).toBe(true);
  });
});

describe("rateForTarget is the inverse of the deficit", () => {
  it("a 57 kcal deficit on a 5 kg cat ≈ 1%/week", () => {
    expect(rateForTarget({ maintenanceKcal: 250, targetKcal: 250 - (8000 * 0.05) / 7, currentKg: 5, rho: 8000 })).toBeCloseTo(1, 6);
  });
});
