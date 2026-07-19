import { describe, it, expect } from "vitest";
import { dispensedToday, dispenseProgress, bowlFillPct, bowlFillY, bowlZones, bowlStatus } from "./dispenseProgress.js";

describe("dispensedToday", () => {
  it("sums only entries dated today", () => {
    const items = [
      { date: "2026-07-14", kcal: 100 },
      { date: "2026-07-13", kcal: 200 },
      { date: "2026-07-14", kcal: 50 },
    ];
    expect(dispensedToday(items, "2026-07-14")).toBe(150);
  });

  it("returns 0 for an empty log", () => {
    expect(dispensedToday([], "2026-07-14")).toBe(0);
    expect(dispensedToday(undefined, "2026-07-14")).toBe(0);
  });

  it("treats an explicit 0-kcal 'nothing eaten' entry the same as no entries", () => {
    const items = [{ date: "2026-07-14", kcal: 0, name: "nothing eaten" }];
    expect(dispensedToday(items, "2026-07-14")).toBe(0);
  });

  it("ignores entries missing kcal", () => {
    const items = [{ date: "2026-07-14" }];
    expect(dispensedToday(items, "2026-07-14")).toBe(0);
  });
});

describe("dispenseProgress", () => {
  it("flags empty (nothing dispensed yet) at 0", () => {
    const p = dispenseProgress(0, 300);
    expect(p.isEmpty).toBe(true);
    expect(p.fillPct).toBe(0);
    expect(p.overPct).toBe(0);
    expect(p.overKcal).toBe(0);
  });

  it("fills proportionally under target", () => {
    const p = dispenseProgress(150, 300);
    expect(p.isEmpty).toBe(false);
    expect(p.fillPct).toBeCloseTo(50);
    expect(p.overPct).toBe(0);
    expect(p.overKcal).toBe(0);
  });

  it("fills exactly to 100 at target, no overflow", () => {
    const p = dispenseProgress(300, 300);
    expect(p.fillPct).toBe(100);
    expect(p.overPct).toBe(0);
    expect(p.overKcal).toBe(0);
  });

  it("splits into an ok segment (up to target) and a warn segment (the excess) over target, summing to 100", () => {
    const p = dispenseProgress(360, 300);
    expect(p.overKcal).toBe(60);
    expect(p.fillPct).toBeCloseTo((300 / 360) * 100);
    expect(p.overPct).toBeCloseTo((60 / 360) * 100);
    expect(p.fillPct + p.overPct).toBeCloseTo(100);
    expect(p.isEmpty).toBe(false);
  });

  it("never reports a fillPct or overPct outside [0, 100]", () => {
    const p = dispenseProgress(10000, 300);
    expect(p.fillPct).toBeGreaterThanOrEqual(0);
    expect(p.fillPct).toBeLessThanOrEqual(100);
    expect(p.overPct).toBeGreaterThanOrEqual(0);
    expect(p.overPct).toBeLessThanOrEqual(100);
  });

  it("guards a non-positive target instead of dividing by zero", () => {
    expect(dispenseProgress(50, 0)).toEqual({ fillPct: 0, overPct: 0, overKcal: 0, isEmpty: false });
    expect(dispenseProgress(0, 0)).toEqual({ fillPct: 0, overPct: 0, overKcal: 0, isEmpty: true });
  });

  it("guards a negative/garbage dispensed value as empty", () => {
    expect(dispenseProgress(-5, 300).isEmpty).toBe(true);
    expect(dispenseProgress(NaN, 300).isEmpty).toBe(true);
  });
});

describe("bowlFillPct", () => {
  it("is straight dispensed/target, unlike dispenseProgress's split fillPct", () => {
    expect(bowlFillPct(150, 300)).toBeCloseTo(50);
    expect(bowlFillPct(300, 300)).toBe(100);
  });

  it("clamps at 100 once dispensed exceeds target — no overflow segment of its own", () => {
    expect(bowlFillPct(450, 300)).toBe(100);
  });

  it("guards a non-positive target/dispensed", () => {
    expect(bowlFillPct(50, 0)).toBe(0);
    expect(bowlFillPct(-5, 300)).toBe(0);
    expect(bowlFillPct(NaN, 300)).toBe(0);
  });
});

describe("bowlFillY", () => {
  const top = 20, bottom = 70;

  it("0% sits at (not above) the interior bottom — nothing visible", () => {
    expect(bowlFillY(0, top, bottom)).toBe(bottom);
  });

  it("50% sits at the midpoint", () => {
    expect(bowlFillY(50, top, bottom)).toBeCloseTo((top + bottom) / 2);
  });

  it("100% sits at the rim", () => {
    expect(bowlFillY(100, top, bottom)).toBe(top);
  });

  it("clamps anything over 100% at the rim", () => {
    expect(bowlFillY(150, top, bottom)).toBe(top);
  });

  it("clamps negative/garbage pct at the bottom", () => {
    expect(bowlFillY(-20, top, bottom)).toBe(bottom);
    expect(bowlFillY(NaN, top, bottom)).toBe(bottom);
  });
});

describe("bowlZones", () => {
  it("lose, real floor + maintenance: ok band is [floor, maintenance]", () => {
    const z = bowlZones({ target: 220, direction: "lose", maintenance: 320, floorKcal: 180 });
    expect(z.low).toBe(180);
    expect(z.high).toBe(320);
    expect(z.floorKcal).toBe(180);
    expect(z.maintenance).toBe(320);
    expect(z.direction).toBe("lose");
  });

  it("lose, fallback (formula basis — no measured maintenance/floor): target ±10%", () => {
    const z = bowlZones({ target: 200, direction: "lose" });
    expect(z.low).toBeCloseTo(180);
    expect(z.high).toBeCloseTo(220);
    expect(z.floorKcal).toBeNull();
    expect(z.maintenance).toBeNull();
  });

  it("maintain: target ±10% regardless of maintenance/floor inputs", () => {
    const z = bowlZones({ target: 300, direction: "maintain", maintenance: 300 });
    expect(z.low).toBeCloseTo(270);
    expect(z.high).toBeCloseTo(330);
  });

  it("gain, real maintenance: ok band is [maintenance, target * 1.15]", () => {
    const z = bowlZones({ target: 250, direction: "gain", maintenance: 220 });
    expect(z.low).toBe(220);
    expect(z.high).toBeCloseTo(287.5);
    expect(z.maintenance).toBe(220);
    expect(z.floorKcal).toBeNull(); // floor is a loss-only concept
  });

  it("gain, fallback (no measured maintenance): target ±10%/+15%", () => {
    const z = bowlZones({ target: 250, direction: "gain" });
    expect(z.low).toBeCloseTo(225);
    expect(z.high).toBeCloseTo(287.5);
    expect(z.maintenance).toBeNull();
  });

  it("guards an inverted/degenerate band so low <= target <= high", () => {
    const z = bowlZones({ target: 200, direction: "lose", floorKcal: 250, maintenance: 260 });
    expect(z.low).toBeLessThanOrEqual(200);
    expect(z.high).toBeGreaterThanOrEqual(200);
    expect(z.low).toBeLessThanOrEqual(z.high);
  });

  it("unrecognized/missing direction falls back to the maintain rule", () => {
    const z = bowlZones({ target: 100, direction: undefined });
    expect(z.direction).toBe("maintain");
    expect(z.low).toBeCloseTo(90);
    expect(z.high).toBeCloseTo(110);
  });
});

describe("bowlStatus", () => {
  const loseZones = bowlZones({ target: 220, direction: "lose", maintenance: 320, floorKcal: 180 });
  const loseFallbackZones = bowlZones({ target: 200, direction: "lose" });
  const gainZones = bowlZones({ target: 250, direction: "gain", maintenance: 220 });
  const maintainZones = bowlZones({ target: 300, direction: "maintain" });

  it("nothing dispensed yet reads as empty, not danger", () => {
    expect(bowlStatus({ dispensedKcal: 0, target: 220, zones: loseZones })).toEqual({ zone: "empty", message: "nothing dispensed yet" });
  });

  it("lose, below the real floor: strong danger warning", () => {
    const s = bowlStatus({ dispensedKcal: 100, target: 220, zones: loseZones });
    expect(s.zone).toBe("danger");
    expect(s.message).toMatch(/safe floor/);
  });

  it("lose, below the ±10% fallback band (no real floor wired): caution, not danger", () => {
    const s = bowlStatus({ dispensedKcal: 50, target: 200, zones: loseFallbackZones });
    expect(s.zone).toBe("caution");
    expect(s.message).not.toMatch(/safe floor/);
  });

  it("gain, below maintenance (no surplus yet): caution", () => {
    const s = bowlStatus({ dispensedKcal: 150, target: 250, zones: gainZones });
    expect(s.zone).toBe("caution");
    expect(s.message).toMatch(/no surplus/);
  });

  it("maintain, below the ±10% band: caution", () => {
    const s = bowlStatus({ dispensedKcal: 200, target: 300, zones: maintainZones });
    expect(s.zone).toBe("caution");
  });

  it("in-band and under target: on plan, kcal to go", () => {
    const s = bowlStatus({ dispensedKcal: 200, target: 220, zones: loseZones });
    expect(s.zone).toBe("ok");
    expect(s.message).toBe("on plan — 20 kcal to go");
  });

  it("in-band and exactly at target: on plan, right on target", () => {
    const s = bowlStatus({ dispensedKcal: 220, target: 220, zones: loseZones });
    expect(s.zone).toBe("ok");
    expect(s.message).toBe("on plan — right on target");
  });

  it("in-band but over target (still under the ok band's top): ok tone, honest about the overage", () => {
    const s = bowlStatus({ dispensedKcal: 280, target: 220, zones: loseZones });
    expect(s.zone).toBe("ok");
    expect(s.message).toBe("on plan — 60 kcal over, within range");
  });

  it("above the ok band's top: warn, over target", () => {
    const s = bowlStatus({ dispensedKcal: 360, target: 220, zones: loseZones });
    expect(s.zone).toBe("warn");
    expect(s.message).toBe("+140 over target");
  });

  it("gain, above the ok band's top: warn, over target", () => {
    const s = bowlStatus({ dispensedKcal: 300, target: 250, zones: gainZones });
    expect(s.zone).toBe("warn");
    expect(s.message).toBe("+50 over target");
  });
});
