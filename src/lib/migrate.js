// v1 → v2 storage migration. Pure — no I/O, no React.
//
// v1 was a single flat blob: { profile, ration, start, library, weightLog, intakeLog, tr,
// fridgeDays, expSettings } — one cat, implicitly. v2 wraps one-or-more cats:
// { v: 2, activeCatId, cats: { [id]: { profile, ration, start, weightLog, intakeLog, tr,
// expSettings } }, library, fridgeDays } — library and fridgeDays stay shared across cats.

import { uid } from "./util.js";

const CAT_FIELDS = ["profile", "ration", "start", "weightLog", "intakeLog", "tr", "expSettings"];

// Wrap a v1 blob as a v2 blob with that data as its one cat. Preserves every field it's
// given verbatim — fabricates nothing beyond a fresh cat id. Used both for the one-time
// load-time migration and for accepting a legacy export via Import.
export function migrateV1(d) {
  const src = d && typeof d === "object" ? d : {};
  const id = uid();
  const cat = {};
  for (const k of CAT_FIELDS) if (src[k] !== undefined) cat[k] = src[k];
  const out = { v: 2, activeCatId: id, cats: { [id]: cat } };
  if (src.library !== undefined) out.library = src.library;
  if (src.fridgeDays !== undefined) out.fridgeDays = src.fridgeDays;
  return out;
}

// Normalize whatever's in storage to v2. Already-v2 data passes through unchanged, so this
// is safe to run on every load — idempotent once the one-time migration has happened.
export function toV2(d) {
  if (d && typeof d === "object" && d.v === 2) return d;
  return migrateV1(d);
}
