// The single source of truth for "the daily kcal target", shared by the ration planner and
// the home summary so they never disagree. Formula target by default; when the energy basis
// is "measured" and there's enough data, the measured maintenance ± the safe deficit/surplus.

import { planWeightChange, autoDirection } from "./weightPlan.js";
import { round5 } from "./units.js";

export function resolveTarget({ t, expenditure, expSettings }) {
  const measured = expenditure.enoughData ? expenditure.kcal : null;
  const useMeasured = expSettings.energyBasis === "measured" && measured != null;
  if (!useMeasured) return { target: t.target, measured: false, dir: null, plan: null };
  const dir = expSettings.direction && expSettings.direction !== "auto" ? expSettings.direction : autoDirection(t.pctOver);
  const plan = planWeightChange({ direction: dir, maintenanceKcal: measured, currentKg: t.w, idealKg: t.idealWeight, pctPerWeek: expSettings.pctPerWeek });
  return { target: round5(plan.targetKcal), measured: true, dir, plan, maintenance: measured };
}
