import { describe, it, expect } from "vitest";
import { resolveTarget } from "./targeting.js";

const t = { target: 250, w: 5, idealWeight: 4, pctOver: 20 };

describe("resolveTarget (shared by Home + Ration planner)", () => {
  it("uses the vet-formula target by default", () => {
    const r = resolveTarget({ t, expenditure: { enoughData: false }, expSettings: { energyBasis: "formula" } });
    expect(r).toMatchObject({ target: 250, measured: false });
  });
  it("falls back to formula when 'measured' is chosen but there's not enough data", () => {
    const r = resolveTarget({ t, expenditure: { enoughData: false }, expSettings: { energyBasis: "measured" } });
    expect(r.target).toBe(250);
    expect(r.measured).toBe(false);
  });
  it("uses measured maintenance − safe deficit when measured + enough data", () => {
    const r = resolveTarget({ t, expenditure: { enoughData: true, kcal: 280 }, expSettings: { energyBasis: "measured", direction: "lose", pctPerWeek: 1 } });
    expect(r.measured).toBe(true);
    expect(r.target).toBeLessThan(280);      // a deficit off measured maintenance
    expect(r.target % 5).toBe(0);            // snapped to multiples of 5
  });
});
