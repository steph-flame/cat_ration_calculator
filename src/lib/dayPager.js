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
// min(maxDays, days-since-earliest-data + 1), never less than 1. Default is unbounded (every
// logged day) — the strip now renders its ENTIRE history as a horizontally-scrollable strip
// (see stripColumnWidth below) rather than a fixed recent slice; callers that still want a
// capped recent window (there are none left in this app, but the helper stays general) pass
// an explicit maxDays.
export function dayStripWindow(minDate, today, maxDays = Infinity) {
  const available = diffDays(minDate, today) + 1;
  const windowLen = Math.max(1, Math.min(maxDays, available));
  const start = addDays(today, -(windowLen - 1));
  return enumerateDays(start, today);
}

// The strip's range pills — same pattern as the expenditure timeline's RangeRow (see
// TimelineChart.jsx / lib/timeline.js's RANGES), reimplemented locally here rather than
// imported since the strip's zoom semantics differ (a range here sets how many days' worth of
// width each column gets, not a data-clipping window — see stripColumnWidth). Deliberately
// coarser than the timeline's five ranges: a log scrubber has no use for 1Y granularity, and
// "all" already covers the long view.
export const STRIP_RANGES = [
  { key: "2w", days: 14, label: "2W" },
  { key: "1m", days: 30, label: "1M" },
  { key: "3m", days: 90, label: "3M" },
  { key: "all", days: null, label: "All" },
];
export const DEFAULT_STRIP_RANGE = "1m";

// The strip's zoom sub-window for a given range: the most recent `range.days` entries of an
// already-built (ascending, today-ending) days array — or every entry for "all"/an
// unrecognized key. Pure array slicing (no date arithmetic) since the caller already has the
// full list in hand; used to scope the peak-intake label to what the current zoom level is
// actually showing, not the cat's entire history.
export function stripRangeWindow(days, rangeKey) {
  const range = STRIP_RANGES.find((r) => r.key === rangeKey);
  const n = range?.days ?? days.length;
  return days.slice(-Math.max(0, Math.min(n, days.length)));
}

// Per-day column width (css px) for the strip's horizontally-scrollable history: the range IS
// the zoom level — `range.days` columns fill the container exactly, so scrolling left at that
// width reveals earlier history one column-width at a time (see design brief point 5). "all"
// (or an unrecognized key) instead sizes EVERY rendered day to fit inside the container with
// no scrolling at all. Returns 0 for a not-yet-measured container or an empty day list, so
// callers can treat 0 as "nothing to draw yet" rather than dividing by zero.
export function stripColumnWidth(rangeKey, totalDays, containerWidth) {
  if (!containerWidth || containerWidth <= 0 || totalDays <= 0) return 0;
  const range = STRIP_RANGES.find((r) => r.key === rangeKey);
  const windowSize = range?.days ?? totalDays;
  return containerWidth / Math.max(1, Math.min(windowSize, totalDays));
}

// Peak (max) intake kcal across a set of days, reading from the same { [date]: { kcal } } map
// Log.jsx builds for the strip. 0 when nothing in range has logged intake — callers should
// treat 0 as "nothing to show" rather than a real peak.
export function stripPeakKcal(days, data) {
  let peak = 0;
  for (const d of days) {
    const k = data?.[d]?.kcal;
    if (k != null && k > peak) peak = k;
  }
  return peak;
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
