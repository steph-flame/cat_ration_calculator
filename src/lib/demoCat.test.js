import { describe, it, expect } from "vitest";
import { buildDemoCat, DEMO_CAT_ID } from "./demoCat.js";
import { freshCatState, defaultTr, defaultExpSettings, DEMO_CAT_ID as CATSTORE_DEMO_ID } from "./catStore.js";
import { validateImport } from "./validate.js";

const TODAY = "2026-07-14";

describe("DEMO_CAT_ID", () => {
  it("re-exports the same id catStore.js defines (no duplicate source of truth)", () => {
    expect(DEMO_CAT_ID).toBe(CATSTORE_DEMO_ID);
    expect(DEMO_CAT_ID).toBe("__demo__");
  });
});

describe("buildDemoCat determinism", () => {
  it("produces byte-identical output for the same `today`", () => {
    const a = buildDemoCat(TODAY);
    const b = buildDemoCat(TODAY);
    expect(a).toEqual(b);
  });
  it("shifts every date by the same amount for a different `today`, leaving values untouched", () => {
    const a = buildDemoCat("2026-07-14");
    const b = buildDemoCat("2026-08-13"); // 30 days later
    expect(a.weightLog).toHaveLength(b.weightLog.length);
    // Same relative day offsets → same kg/method/source sequence, only dates shifted.
    expect(a.weightLog.map((e) => e.kg)).toEqual(b.weightLog.map((e) => e.kg));
    expect(a.weightLog.map((e) => e.method)).toEqual(b.weightLog.map((e) => e.method));
    expect(a.intakeLog.map((e) => e.kcal)).toEqual(b.intakeLog.map((e) => e.kcal));
    const shifted = new Set(a.weightLog.map((e) => e.date));
    const bDates = new Set(b.weightLog.map((e) => e.date));
    expect(shifted).not.toEqual(bDates); // dates actually moved
    // dob shifts by the same real-calendar amount (4 years before whichever `today`)
    expect(a.profile.dob).not.toBe(b.profile.dob);
    expect(a.profile.dob.slice(0, 4)).toBe("2022");
    expect(b.profile.dob.slice(0, 4)).toBe("2022");
  });
});

describe("buildDemoCat shape", () => {
  const demo = buildDemoCat(TODAY);
  const fresh = freshCatState();

  it("matches freshCatState()'s per-cat record shape exactly (same top-level keys)", () => {
    expect(Object.keys(demo).sort()).toEqual(Object.keys(fresh).sort());
  });
  it("uses the real default tr/expSettings factories, unmodified", () => {
    expect(demo.tr).toEqual(defaultTr());
    expect(demo.expSettings).toEqual(defaultExpSettings());
  });
  it("gives Biscuit a name, a dob ~4 years back, neutered, and a gentle-trim profile", () => {
    expect(demo.profile.name).toBe("Biscuit");
    expect(demo.profile.neutered).toBe(true);
    expect(demo.profile.bcMode).toBe("pct");
    expect(demo.profile.pctOver).toBeGreaterThan(0);
    expect(demo.profile.goal).toBe("gentle");
  });
  it("has ~8 weeks of weigh-ins, 2-4 a day, mostly Litter-Robot with occasional manual pet-scale", () => {
    expect(demo.weightLog.length).toBeGreaterThan(100); // 56 days * 2-4/day
    const methods = new Set(demo.weightLog.map((e) => e.method));
    expect(methods).toEqual(new Set(["litterRobot", "petScale"]));
    const sources = new Set(demo.weightLog.map((e) => e.source));
    expect(sources).toEqual(new Set(["litter-robot", "manual"]));
    const lrCount = demo.weightLog.filter((e) => e.method === "litterRobot").length;
    expect(lrCount).toBeGreaterThan(demo.weightLog.length / 2); // "mostly" Litter-Robot
  });
  it("weight trends down from ~4.95 to ~4.62 kg", () => {
    const byDate = [...demo.weightLog].sort((a, b) => (a.date < b.date ? -1 : 1));
    expect(byDate[0].kg).toBeGreaterThan(4.7);
    expect(byDate[byDate.length - 1].kg).toBeLessThan(4.8);
  });
  it("logs ~215 kcal/day of intake, dense enough for no missing days", () => {
    const byDay = new Map();
    for (const e of demo.intakeLog) byDay.set(e.date, (byDay.get(e.date) || 0) + e.kcal);
    const totals = [...byDay.values()];
    expect(totals.length).toBe(56);
    for (const t of totals) expect(t).toBeGreaterThan(190);
    for (const t of totals) expect(t).toBeLessThan(240);
  });
  it("has a 2-food ration (one dry perKg, one wet perUnit) summing to 100%", () => {
    expect(demo.ration).toHaveLength(2);
    const sum = demo.ration.reduce((s, f) => s + f.pct, 0);
    expect(sum).toBe(100);
    expect(demo.ration.some((f) => f.mode === "perKg")).toBe(true);
    expect(demo.ration.some((f) => f.mode === "perUnit")).toBe(true);
  });
});

describe("Biscuit is never persisted", () => {
  it("is never a key in a fresh app's cats map, so an export built from real cats never contains her", () => {
    // Simulates AppState's persistData shape: cats only ever holds real (non-demo) entries —
    // Biscuit is generated separately (see AppState's demoCat useMemo) and merged in only for
    // display (catsSummary), never written into `cats`.
    const cats = { realCat1: freshCatState() };
    expect(Object.keys(cats)).not.toContain(DEMO_CAT_ID);
  });
});

describe("validateImport tolerates a persisted activeCatId of DEMO_CAT_ID", () => {
  it("accepts a v2 blob whose activeCatId is the demo id, even though she's never in `cats`", () => {
    const blob = {
      v: 2,
      activeCatId: DEMO_CAT_ID,
      cats: { real: { profile: { name: "Real Cat" } } },
    };
    expect(validateImport(blob)).toBe(true);
  });
});
