import { createContext, useContext, useMemo, useState } from "react";
import { num, r1, clamp } from "../lib/util.js";
import { computeTargets, seedProfile, bcsToPct, pctToBcs, ageMonthsFromDob, effectiveAgeMonths } from "../lib/nutrition.js";
import { makeRationSeed, makeStartSeed, makeLibrarySeed, toLibraryEntry, dedupeFoods, stripKind, canonicalFoodName, migrateLegacyFood, ensureBuiltins } from "../lib/foods.js";
import { estimateExpenditure, kalmanEstimateExpenditure, ucEstimateExpenditure, WEIGH_SOURCES, DEFAULT_METHOD } from "../lib/expenditure.js";
import { groupByDay, median } from "../lib/series.js";
import { usePersistence, store, probeStorage } from "../lib/storage.js";
import { useFoodList } from "../hooks/useFoodList.js";
import { useFoodLibrary } from "../hooks/useFoodLibrary.js";
import { useLog } from "../hooks/useLog.js";

const defaultTr = () => ({ on: false, days: 7, timelineUnit: "g" });
const defaultExpSettings = () => ({ pctPerWeek: 1, energyBasis: "formula", algo: "v3", unit: "kg", direction: "auto", lastMethod: "petScale" });

// Clean up legacy food data: strip "(dry)"/"(wet)", snap macro-identical near-dupes to their
// canonical built-in name, and retire the generic Tiki. Pure — used on load and on import.
const cleanName = (f) => (f.name == null ? f : { ...f, name: stripKind(f.name) });
const cleanFood = (f) => { const s = cleanName(f); return s.name == null ? s : migrateLegacyFood({ ...s, name: canonicalFoodName(s) }); };

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Owns every piece of persisted state and the values derived from it. Pages are pure views
// over this. Persistence and semantics stay in their own modules; this just wires them.
export function AppProvider({ children }) {
  const [p, setP] = useState(seedProfile);
  const ration = useFoodList(makeRationSeed);
  const start = useFoodList(makeStartSeed);
  const library = useFoodLibrary(makeLibrarySeed);
  const weightLog = useLog();
  const intakeLog = useLog();
  const [tr, setTr] = useState(defaultTr);
  const [fridgeDays, setFridgeDays] = useState(3);
  const [expSettings, setExpSettingsRaw] = useState(defaultExpSettings);
  const [hydrated, setHydrated] = useState(false); // did we load real saved data (vs. seed defaults)?
  const [storageOk] = useState(probeStorage);

  // Apply a saved/imported blob to state (with the food cleanup). Reused by load + import.
  const applyData = (d) => {
    if (!d || typeof d !== "object") return;
    setHydrated(true);
    if (d.profile) setP(d.profile);
    if (d.ration) ration.setItems(d.ration.map(cleanFood));
    if (d.start) start.setItems(d.start.map(cleanFood));
    if (d.library) library.setFoods(dedupeFoods(ensureBuiltins(d.library.map(cleanFood)))); // merge dupes + pick up new built-ins
    if (d.weightLog) weightLog.setItems(d.weightLog);
    if (d.intakeLog) intakeLog.setItems(d.intakeLog.map(cleanName));
    if (d.tr) setTr(d.tr);
    if (typeof d.fridgeDays === "number") setFridgeDays(d.fridgeDays);
    if (d.expSettings) setExpSettingsRaw({ ...defaultExpSettings(), ...d.expSettings });
  };

  const persistData = { profile: p, ration: ration.items, start: start.items, library: library.foods,
    weightLog: weightLog.items, intakeLog: intakeLog.items, tr, fridgeDays, expSettings };
  const loaded = usePersistence(persistData, applyData);
  const firstRun = loaded && !hydrated; // showing seed defaults, no saved data yet

  // Foods enter the library only on an explicit save click (see saveFood) — never
  // automatically, so typing a food doesn't silently accumulate library entries.
  const saveFood = (f) => library.upsert(toLibraryEntry(f));

  // Permanent vs. logged state. Age derives from date of birth (so it never goes stale);
  // with no dob to derive it from, the cat is treated as an adult (never a fabricated
  // newborn — see effectiveAgeMonths) and dobMissing tells the UI to prompt for it instead
  // of showing a made-up age. The current weight the feeding math runs on is the latest
  // weigh-in — not a hand-typed number that can silently disagree with the log — falling
  // back to the seeded profile weight before the first weigh-in.
  const today = new Date().toISOString().slice(0, 10);
  const dobMissing = ageMonthsFromDob(p.dob, today) == null;
  const effAgeMonths = effectiveAgeMonths(p.dob, today);
  const weightDays = groupByDay(weightLog.items); // newest day first
  const currentWeight = weightDays.length
    ? { kg: median(weightDays[0].items.map((e) => num(e.kg))), date: weightDays[0].date, fromLog: true }
    : { kg: num(p.weightKg), date: null, fromLog: false };
  const logWeight = ({ kg, method }) =>
    weightLog.add({ date: today, kg, method: method || expSettings.lastMethod || DEFAULT_METHOD, source: WEIGH_SOURCES.manual });

  const t = useMemo(() => computeTargets({ ...p, ageMonths: effAgeMonths, weightKg: currentWeight.kg }), [p, effAgeMonths, currentWeight.kg]);
  const expenditure = useMemo(() => {
    const w = weightLog.items.map((e) => ({ date: e.date, value: e.kg, method: e.method }));
    const i = intakeLog.items.map((e) => ({ date: e.date, value: e.kcal }));
    const opts = { priorKcal: t.refs.maintain }; // cold-start the filter prior from the vet formula
    if (expSettings.algo === "v1") return estimateExpenditure(w, i, opts);
    if (expSettings.algo === "v2") return kalmanEstimateExpenditure(w, i, opts);
    return ucEstimateExpenditure(w, i, opts); // v3 (default)
  }, [weightLog.items, intakeLog.items, expSettings.algo, t.refs.maintain]);

  // Profile helpers (unchanged semantics, just centralized).
  const ageUnit = p.ageUnit || "months";
  const ageDisplay = dobMissing ? null : ageUnit === "years" ? r1(effAgeMonths / 12) : r1(effAgeMonths); // never a fabricated age
  const set = (k, v) => setP((s) => ({ ...s, [k]: v }));
  const setFactor = (k, v) => setP((s) => ({ ...s, factors: { ...s.factors, [k]: v } }));
  const setBcs = (v) => setP((s) => ({ ...s, bcs: v, pctOver: bcsToPct(v), bcAsOf: today }));
  const setPct = (v) => { const cv = clamp(num(v), -60, 100); setP((s) => ({ ...s, pctOver: cv, bcs: pctToBcs(cv), bcAsOf: today })); }; // clamp: a wild % → absurd ideal weight → overfeed
  const setExpSettings = (patch) => setExpSettingsRaw((s) => ({ ...s, ...patch }));
  const reset = () => {
    store.clear();
    setP(seedProfile); ration.reset(); start.reset(); library.reset();
    weightLog.reset(); intakeLog.reset();
    setTr(defaultTr()); setFridgeDays(3); setExpSettingsRaw(defaultExpSettings());
  };

  const value = {
    loaded, firstRun, storageOk, p, set, setFactor, ageUnit, ageDisplay, dobMissing, setBcs, setPct, reset,
    today, currentWeight, logWeight,
    ration, start, library, weightLog, intakeLog, saveFood,
    tr, setTr, fridgeDays, setFridgeDays, expSettings, setExpSettings,
    t, expenditure,
    exportData: () => JSON.stringify(persistData, null, 2),
    importData: applyData,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
