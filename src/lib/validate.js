// Shape-check an imported data blob before it's applied to state. Not a full schema —
// just enough to catch "this isn't our JSON" and reject up front, so a malformed file
// can't half-apply (some fields adopted, others left stale). Pure.

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const arrOf = (v, pred) => Array.isArray(v) && v.every(pred);

// A ration/start/library row: name + mode are the load-bearing primitives. The macro
// fields vary by mode and are often blank, so they're not pinned down further here.
const isFoodEntry = (f) => isPlainObject(f) && typeof f.name === "string" && typeof f.mode === "string";
const isWeightEntry = (e) => isPlainObject(e) && typeof e.date === "string" && typeof e.kg === "number";
const isIntakeEntry = (e) => isPlainObject(e) && typeof e.date === "string" && typeof e.kcal === "number";

export function validateImport(d) {
  if (!isPlainObject(d)) return false;
  if (d.profile !== undefined && !isPlainObject(d.profile)) return false;
  if (d.ration !== undefined && !arrOf(d.ration, isFoodEntry)) return false;
  if (d.start !== undefined && !arrOf(d.start, isFoodEntry)) return false;
  if (d.library !== undefined && !arrOf(d.library, isFoodEntry)) return false;
  if (d.weightLog !== undefined && !arrOf(d.weightLog, isWeightEntry)) return false;
  if (d.intakeLog !== undefined && !arrOf(d.intakeLog, isIntakeEntry)) return false;
  if (d.tr !== undefined && !isPlainObject(d.tr)) return false;
  if (d.expSettings !== undefined && !isPlainObject(d.expSettings)) return false;
  if (d.fridgeDays !== undefined && typeof d.fridgeDays !== "number") return false;
  return true;
}
