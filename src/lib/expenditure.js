// Adaptive energy-expenditure estimate — "MacroFactor for cats".
//
// Energy balance: over a window, expenditure ≈ mean intake − ρ·(rate of weight change).
// We log what's *dispensed* (a constant grazing-leftover bias cancels out — see README),
// smooth the weight trend, and back-calculate the maintenance requirement the vet formula
// can only guess at.
//
// This is the v1 estimator: EWMA trend weight + OLS rate over a trailing window. The return
// shape (kcal + confidence band + enoughData) is stable, so a v2 Kalman / v3 unobserved-
// components model can replace the internals without touching callers. See README "The science".

import { median, mean, dailyReduce, fillDaily, ewma, linreg, addDays, diffDays, enumerateDays } from "./series.js";

// Energy density of feline weight change. A cat in weight management moves mostly fat, so this
// skews higher than the human ~7700 kcal/kg (3500/lb) blended figure. Tunable.
export const KCAL_PER_KG = 8000;

export const DEFAULTS = { rho: KCAL_PER_KG, windowDays: 28, minDays: 10, alpha: 0.25, maxMissing: 0.5 };

// How a weigh-in was measured. `sigmaKg` is the rough per-reading measurement noise —
// captured now, and reserved for precision-weighting (WLS) in the v2 filter. Mixing
// methods risks a systematic between-method offset that looks like a weight jump, so the
// UI nudges toward picking one.
export const WEIGH_METHODS = {
  petScale:    { label: "Pet scale",     hint: "dedicated pet / baby scale",  sigmaKg: 0.01 },
  litterRobot: { label: "Litter-Robot",  hint: "read from the Whisker app",   sigmaKg: 0.03 },
  difference:  { label: "Scale − you",   hint: "you, then you + cat, subtract", sigmaKg: 0.15 },
  other:       { label: "Other",         hint: "",                            sigmaKg: 0.05 },
};
export const DEFAULT_METHOD = "petScale";

// How the reading got into the app.
export const WEIGH_SOURCES = { manual: "manual", litterRobot: "litter-robot" };

// weightEntries: [{ date, value: kg }]   intakeEntries: [{ date, value: kcal }]
// (multiple per day are fine — weight is median-reduced, intake summed.)
export function estimateExpenditure(weightEntries = [], intakeEntries = [], opts = {}) {
  const { rho, windowDays, minDays, alpha, maxMissing } = { ...DEFAULTS, ...opts };

  const dailyW = dailyReduce(weightEntries, median);
  const dailyI = dailyReduce(intakeEntries, (v) => v.reduce((a, b) => a + b, 0));

  const empty = { enoughData: false, kcal: null, sd: null, low: null, high: null,
    trendWeightKg: dailyW.length ? dailyW[dailyW.length - 1].value : null,
    rateKgPerWeek: null, ratePctPerWeek: null, nDays: dailyW.length, missingIntake: null, trend: [] };
  if (dailyW.length < 2) return empty;

  const last = dailyW[dailyW.length - 1].date;
  const span = diffDays(dailyW[0].date, last) + 1;
  const winStart = addDays(last, -(Math.min(windowDays, span) - 1));

  // Weight: fill to a daily grid over the window and fit a line for the rate (kg/day).
  const wWin = dailyW.filter((d) => d.date >= winStart);
  if (wWin.length < 2) return { ...empty, trendWeightKg: dailyW[dailyW.length - 1].value };
  const wFilled = fillDaily(wWin, "interp");
  const ys = wFilled.map((d) => d.value);
  const { slope, slopeSE } = linreg(ys);            // kg per day (negative = losing)
  const trendSeries = ewma(ys, alpha);
  const trendWeightKg = trendSeries[trendSeries.length - 1];

  // Intake: mean over the days we actually logged in the window; track how sparse it was.
  const winDays = enumerateDays(winStart, last);
  const iByDay = new Map(dailyI.map((d) => [d.date, d.value]));
  const present = winDays.filter((d) => iByDay.has(d));
  const missingIntake = 1 - present.length / winDays.length;
  const meanIntake = mean(present.map((d) => iByDay.get(d)));

  const kcal = meanIntake - rho * slope;            // − because slope<0 during loss raises expenditure
  const sd = rho * (Number.isFinite(slopeSE) ? slopeSE : 0); // rate uncertainty dominates the band
  const rateKgPerWeek = slope * 7;
  const ratePctPerWeek = trendWeightKg > 0 ? (rateKgPerWeek / trendWeightKg) * 100 : 0;

  const enoughData = span >= minDays && present.length >= 2 && missingIntake <= maxMissing;

  return {
    enoughData, kcal, sd, low: kcal - 1.96 * sd, high: kcal + 1.96 * sd,
    trendWeightKg, rateKgPerWeek, ratePctPerWeek, nDays: span, missingIntake,
    trend: wFilled.map((d, i) => ({ date: d.date, kg: trendSeries[i] })),
  };
}
