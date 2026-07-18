// Pure day-pager + day-strip helpers for the Log page's redesign (see Log.jsx): a single
// viewed day plus a compact strip timeline replace the old endless day-group list. No React,
// no domain knowledge beyond "days" (ISO YYYY-MM-DD strings) — trivially testable in isolation.

import { addDays, diffDays, enumerateDays } from "./series.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The pager's backward bound: the earliest day with any logged data (weight OR intake),
// across BOTH logs. Falls back to `today` when there's no data at all yet (a brand-new cat) —
// the pager always has a valid single-day [today, today] range to show, never an empty one.
export function earliestLoggedDay(weightItems, intakeItems, today) {
  let min = today;
  for (const e of weightItems || []) if (e?.date != null && e.date < min) min = e.date;
  for (const e of intakeItems || []) if (e?.date != null && e.date < min) min = e.date;
  return min;
}

// Clamp any candidate day into [minDate, maxDate] (maxDate is always `today` — no visiting
// the future).
export function clampDay(date, minDate, maxDate) {
  if (date < minDate) return minDate;
  if (date > maxDate) return maxDate;
  return date;
}

export const canGoPrev = (date, minDate) => date > minDate;
export const canGoNext = (date, maxDate) => date < maxDate;

// One step back/forward (delta = ±1), clamped to the navigable range — stepping past either
// end just holds at the boundary rather than wrapping or going out of range.
export function shiftDay(date, delta, minDate, maxDate) {
  return clampDay(addDays(date, delta), minDate, maxDate);
}

// The strip's day window: the last `maxDays` days ending today, but FEWER when there's less
// history than that (a brand-new cat's strip shouldn't pad 25 empty columns on the left of
// its 5 real days — see design brief). Always ends at `today`; length is
// min(maxDays, days-since-earliest-data + 1), never less than 1.
export function dayStripWindow(minDate, today, maxDays = 30) {
  const available = diffDays(minDate, today) + 1;
  const windowLen = Math.max(1, Math.min(maxDays, available));
  const start = addDays(today, -(windowLen - 1));
  return enumerateDays(start, today);
}

// A friendly header label: "Today", "Yesterday", or a short date ("Jul 14", with the year
// appended only when it differs from today's — matching TimelineChart's own date-label
// convention). Callers show the raw ISO date alongside this for days it doesn't already read
// as one (see DayPagerHeader in Log.jsx).
export function formatDayLabel(date, today) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  const t = new Date(`${date}T00:00:00Z`);
  const showYear = date.slice(0, 4) !== today.slice(0, 4);
  return `${MON[t.getUTCMonth()]} ${t.getUTCDate()}${showYear ? `, ${date.slice(0, 4)}` : ""}`;
}
