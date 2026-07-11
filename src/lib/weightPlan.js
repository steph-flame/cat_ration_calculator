// Safe weight-loss prescription. Turns a maintenance-energy number (from EITHER the vet
// formula or the measured expenditure estimate) into a daily Calorie target that loses fat
// at a vet-safe rate.
//
// Safety (AAHA / APOP): cats should lose ~0.5–2% of body weight per week — the conservative
// end for cats, which are prone to hepatic lipidosis if slimmed too fast. Starting target is
// ~0.8 × RER at ideal weight; below that needs veterinary supervision. Sources in README.

import { RER } from "./nutrition.js";
import { KCAL_PER_KG } from "./expenditure.js";

export const RATE = { min: 0.5, max: 2, default: 1 }; // % body weight lost per week
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// maintenanceKcal: intake that holds current weight (measured or formula-derived).
// currentKg / idealKg: from the profile. pctPerWeek: desired loss rate (% of body wt / week).
export function planWeightLoss({ maintenanceKcal, currentKg, idealKg, pctPerWeek = RATE.default, rho = KCAL_PER_KG }) {
  const overweight = currentKg > idealKg + 0.01;
  const requested = pctPerWeek;
  const rate = clamp(pctPerWeek, RATE.min, RATE.max);

  const weeklyLossKg = (currentKg * rate) / 100;
  const dailyDeficit = (rho * weeklyLossKg) / 7;
  const floorKcal = 0.8 * RER(idealKg);          // supervised lower bound
  const rawTarget = maintenanceKcal - dailyDeficit;
  const belowFloor = rawTarget < floorKcal;
  const targetKcal = Math.max(rawTarget, floorKcal);

  // The rate the *final* target actually delivers. If the floor bound, this is slower than
  // requested — surface it so the UI never implies a rate it isn't feeding for.
  const resultingRatePctPerWeek = rateForTarget({ maintenanceKcal, targetKcal, currentKg, rho });
  const resultingWeeklyLossKg = (currentKg * resultingRatePctPerWeek) / 100;
  const excessKg = Math.max(0, currentKg - idealKg);
  const weeksToIdeal = resultingWeeklyLossKg > 0 ? excessKg / resultingWeeklyLossKg : null;

  const warnings = [];
  if (!overweight) warnings.push("At or below ideal weight — no deficit needed. This plan applies to overweight cats.");
  if (requested > RATE.max) warnings.push(`${requested}%/week is faster than the safe ceiling — capped at ${RATE.max}%. Faster loss risks hepatic lipidosis.`);
  if (requested < RATE.min && requested > 0) warnings.push(`${requested}%/week is very slow — floored at ${RATE.min}%.`);
  if (belowFloor) warnings.push(`That maintenance estimate would push the target below ~0.8 × RER at ideal weight (${Math.round(floorKcal)} kcal). Held at the floor; go lower only under veterinary supervision.`);

  return {
    overweight, rate, requested, weeklyLossKg, dailyDeficit,
    targetKcal, floorKcal, belowFloor, weeksToIdeal, warnings,
    resultingRatePctPerWeek, resultingWeeklyLossKg,
  };
}

// Inverse: the loss rate (%/week) a given daily deficit produces — for showing the effect of
// a manually chosen target.
export function rateForTarget({ maintenanceKcal, targetKcal, currentKg, rho = KCAL_PER_KG }) {
  const dailyDeficit = maintenanceKcal - targetKcal;
  const weeklyLossKg = (dailyDeficit * 7) / rho;
  return currentKg > 0 ? (weeklyLossKg / currentKg) * 100 : 0;
}
