// Assemble the per-day frame the timeline chart draws: weight + intake + expenditure,
// aligned by date and clipped to a selected range. Pure — no SVG, no React.

import { dailyReduce, addDays, diffDays, ewma } from "./series.js";

export const RANGES = [
  { key: "1w", days: 7, label: "1W" },
  { key: "1m", days: 30, label: "1M" },
  { key: "3m", days: 90, label: "3M" },
  { key: "6m", days: 180, label: "6M" },
  { key: "1y", days: 365, label: "1Y" },
];

// trend: [{ date, kg, e?, sd? }] over the full history (from an estimator).
// intakeEntries: [{ date, value: kcal }] (summed per day here).
// rangeDays: clip to the last N days ending at the most recent trend date.
// → [{ date, w, kin, e, sd }] one per day in range (kin/e/sd may be null).
export function buildDailyFrame(trend, intakeEntries, rangeDays) {
  if (!trend || trend.length === 0) return [];
  const intakeByDay = new Map(dailyReduce(intakeEntries, (v) => v.reduce((a, b) => a + b, 0)).map((d) => [d.date, d.value]));
  const last = trend[trend.length - 1].date;
  const cutoff = rangeDays ? addDays(last, -(rangeDays - 1)) : trend[0].date;
  return trend
    .filter((p) => p.date >= cutoff)
    .map((p) => ({
      date: p.date,
      w: p.kg ?? null,
      e: p.e ?? null,
      sd: p.sd ?? null,
      kin: intakeByDay.has(p.date) ? intakeByDay.get(p.date) : null,
    }));
}

// How many days of history exist (for enabling/disabling range buttons).
export const historySpanDays = (trend) =>
  trend && trend.length ? diffDays(trend[0].date, trend[trend.length - 1].date) + 1 : 0;

// Smoothed weight-change rate from a per-day frame ([{ w }]): the derivative of the (already
// de-noised) trend weight, EWMA-smoothed. Returns per-point { kgPerWeek, pctPerWeek } aligned
// to the frame; the first point is null (no prior day to difference against).
export function weightChangeRate(frame, alpha = 0.3) {
  const diffs = frame.map((p, i) => (i === 0 || p.w == null || frame[i - 1].w == null ? 0 : p.w - frame[i - 1].w));
  const smooth = ewma(diffs, alpha); // kg/day, smoothed
  return frame.map((p, i) => {
    if (i === 0 || p.w == null) return { kgPerWeek: null, pctPerWeek: null };
    const kgPerWeek = smooth[i] * 7;
    return { kgPerWeek, pctPerWeek: p.w > 0 ? (kgPerWeek / p.w) * 100 : 0 };
  });
}
