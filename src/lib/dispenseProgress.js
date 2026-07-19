// Pure helpers for Home's "tonight's bowl" progress bar — how much of the target has
// actually been dispensed today, as opposed to just the target number itself (see
// resolveTarget in lib/targeting.js, which this deliberately does NOT touch — today's intake
// stays excluded from the expenditure estimate; this is display-only).

import { clamp, r0 } from "./util.js";

// Today's total dispensed kcal — sum of every intake entry logged on `today` (the owner's
// local day, see AppState.jsx's `today`). An explicit 0-kcal "nothing eaten" entry (see
// Log.jsx's addNothingEaten) sums to 0 same as a day with no entries at all — both are a real
// "nothing dispensed" day, not a missing-data one, so callers should treat 0 as "empty bar",
// never as "no data yet".
export function dispensedToday(intakeItems, today) {
  let sum = 0;
  for (const e of intakeItems || []) if (e?.date === today) sum += Number(e.kcal) || 0;
  return sum;
}

// Progress-bar geometry for dispensed-vs-target, pure percentage math (no rendering):
//   fillPct  — the ok-token segment's width, 0..100
//   overPct  — the warn-token overflow segment's width, 0..100 (0 while at-or-under target)
//   overKcal — kcal dispensed past target (0 while at-or-under)
//   isEmpty  — true when nothing's been dispensed yet (dispensed <= 0) — callers show the
//              bar's own "nothing dispensed yet" empty state rather than a 0%-wide fill
//
// At or under target, the bar's domain IS the target: fillPct is simply dispensed/target.
// Over target, the domain stretches to the dispensed total itself, so fillPct always marks
// "up to target" and overPct always marks the excess past it — the two sum to exactly 100
// (a full, overflowing bar) rather than fillPct alone exceeding 100%.
export function dispenseProgress(dispensed, target) {
  const d = Math.max(0, Number(dispensed) || 0);
  const t = Math.max(0, Number(target) || 0);
  const isEmpty = d <= 0;
  if (t <= 0 || d <= t) {
    return { fillPct: t > 0 ? clamp((d / t) * 100, 0, 100) : 0, overPct: 0, overKcal: 0, isEmpty };
  }
  const overKcal = d - t;
  return { fillPct: (t / d) * 100, overPct: (overKcal / d) * 100, overKcal, isEmpty };
}

// --- Tonight's bowl card (BowlMark + zone bar) -----------------------------------------------

// How full the bowl mark itself should look: straight dispensed/target, clamped to [0, 100].
// Deliberately NOT the same as dispenseProgress().fillPct above — that one shrinks to make
// room for an overflow segment once dispensed exceeds target. The bowl has no overflow
// segment of its own (over-target renders as the bowl sitting simply brim-full); the excess
// is entirely the zone bar's and the status line's job to report.
export function bowlFillPct(dispensed, target) {
  const d = Math.max(0, Number(dispensed) || 0);
  const t = Math.max(0, Number(target) || 0);
  return t > 0 ? clamp((d / t) * 100, 0, 100) : 0;
}

// Pure geometry: the SVG y-coordinate of the fill surface inside the bowl's interior, as a
// function of fill percentage alone (no rendering, no bowl-specific knowledge beyond the two
// y-bounds it's given). SVG y grows downward, so the bowl's rim sits at the smaller y
// (interiorTop) and its deepest point at the larger y (interiorBottom) — the liquid's surface
// falls from interiorBottom (0%, nothing showing) up to interiorTop (100%, brim-full) as pct
// climbs, linearly. pct is clamped to [0, 100] first, so >100% (over-dispensed) draws the same
// brim-full surface as exactly 100%, and <=0%/garbage draws the surface at (or below, i.e. not
// above) the very bottom — nothing visible above the floor of the bowl.
export function bowlFillY(pct, interiorTop, interiorBottom) {
  const p = clamp(Number(pct) || 0, 0, 100);
  return interiorBottom - (p / 100) * (interiorBottom - interiorTop);
}

// The zone bar's bands, in raw kcal, for a given feeding direction — what counts as the
// acceptable ("on plan") range, and what real numbers were available to define it.
//
//   lose:     ok  = [nutritional floor, maintenance]      — below the floor is real lipidosis
//                                                            risk; at/above maintenance the
//                                                            deficit is simply gone.
//   gain:     ok  = [maintenance, target * 1.15]           — below maintenance means no
//                                                            surplus is actually happening yet.
//   maintain: ok  = target ± 10%                           — no maintenance/floor concept beyond
//                                                            the target itself.
//
// `maintenance` and `floorKcal` come from resolveTarget()/planWeightChange() and are only
// populated when the energy basis is "measured" (see lib/targeting.js) — on the formula basis
// (or maintain, which has no floor concept at all) this falls back to target ± 10%. Callers can
// tell real vs. fallback apart via the returned `floorKcal`/`maintenance` (null when a fallback
// was used) — used to pick honest status-line wording rather than claiming a lipidosis-risk
// floor that was never actually computed.
export function bowlZones({ target, direction, maintenance, floorKcal }) {
  const t = Math.max(0, Number(target) || 0);
  const dir = direction === "lose" || direction === "gain" ? direction : "maintain";
  const hasMaintenance = Number(maintenance) > 0;
  const hasFloor = dir === "lose" && Number(floorKcal) > 0;

  let low, high;
  if (dir === "lose") {
    low = hasFloor ? floorKcal : t * 0.9;
    high = hasMaintenance ? maintenance : t * 1.1;
  } else if (dir === "gain") {
    low = hasMaintenance ? maintenance : t * 0.9;
    high = t * 1.15;
  } else {
    low = t * 0.9;
    high = t * 1.1;
  }
  // Guard against a degenerate/inverted band (e.g. a floor above maintenance from unusual
  // inputs) so low <= target <= high always holds, and low <= high for rendering.
  low = Math.min(low, t);
  high = Math.max(high, t, low);

  const max = Math.max(high * 1.25, t * 1.25, 1);
  return { direction: dir, low, high, max, floorKcal: hasFloor ? floorKcal : null, maintenance: hasMaintenance ? maintenance : null };
}

// The status line's zone + message, keyed off where today's dispensed total actually sits
// relative to the zone bar's bands. Pure text/tone logic, no rendering.
//   "empty"   — nothing dispensed yet (matches dispensedToday's own "real zero" semantics).
//   "danger"  — below the true nutritional floor on a loss plan (only when a real floor was
//               wired in — see bowlZones — never fabricated on the formula-basis fallback).
//   "caution" — below the ok band for any other reason (gain not yet at a surplus, or the
//               ±10% fallback band on lose/maintain).
//   "ok"      — inside the ok band, at/under or slightly over target.
//   "warn"    — above the ok band's top: meaningfully over target.
export function bowlStatus({ dispensedKcal, target, zones }) {
  const d = Math.max(0, Number(dispensedKcal) || 0);
  const t = Math.max(0, Number(target) || 0);
  const { low, high, direction, floorKcal } = zones;

  if (d <= 0) return { zone: "empty", message: "nothing dispensed yet" };

  if (d < low) {
    if (direction === "lose" && floorKcal != null) {
      return { zone: "danger", message: "below the safe floor — see the feeding plan" };
    }
    if (direction === "gain") {
      return { zone: "caution", message: `${r0(t - d)} kcal under target — no surplus yet` };
    }
    return { zone: "caution", message: `${r0(t - d)} kcal under target — well under plan` };
  }

  if (d <= high) {
    if (d < t) return { zone: "ok", message: `on plan — ${r0(t - d)} kcal to go` };
    if (d === t) return { zone: "ok", message: "on plan — right on target" };
    return { zone: "ok", message: `on plan — ${r0(d - t)} kcal over, within range` };
  }

  return { zone: "warn", message: `+${r0(d - t)} over target` };
}
