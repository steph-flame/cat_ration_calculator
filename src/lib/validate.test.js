import { describe, it, expect } from "vitest";
import { validateImport } from "./validate.js";

const validExport = () => ({
  profile: { name: "Mithril", dob: "2025-09-13", weightKg: 4.38, goal: "gentle", factors: {} },
  ration: [{ id: "a", name: "Food A", mode: "perKg", kcalPerKg: 4000, pct: 100 }],
  start: [],
  library: [{ id: "b", name: "Food B", mode: "perUnit", kcalPerUnit: 60, gramsPerUnit: 79 }],
  weightLog: [{ id: "c", date: "2026-01-01", kg: 4.4, method: "petScale", source: "manual" }],
  intakeLog: [{ id: "d", date: "2026-01-01", kcal: 250, grams: 60, name: "Food A" }],
  tr: { on: false, days: 7, timelineUnit: "g" },
  fridgeDays: 3,
  expSettings: { unit: "kg" },
});

describe("validateImport accepts a well-formed export", () => {
  it("accepts a full export", () => {
    expect(validateImport(validExport())).toBe(true);
  });
  it("accepts a partial blob (every field optional)", () => {
    expect(validateImport({ profile: { name: "X" } })).toBe(true);
    expect(validateImport({})).toBe(true);
  });
});

describe("validateImport rejects malformed shapes", () => {
  it("rejects non-objects at the top level", () => {
    expect(validateImport(null)).toBe(false);
    expect(validateImport(undefined)).toBe(false);
    expect(validateImport("not json")).toBe(false);
    expect(validateImport([1, 2, 3])).toBe(false);
    expect(validateImport(42)).toBe(false);
  });
  it("rejects a profile that isn't an object", () => {
    expect(validateImport({ ...validExport(), profile: "Mithril" })).toBe(false);
    expect(validateImport({ ...validExport(), profile: [] })).toBe(false);
  });
  it("rejects list fields that aren't arrays", () => {
    expect(validateImport({ ...validExport(), ration: { name: "Food A" } })).toBe(false);
    expect(validateImport({ ...validExport(), weightLog: "oops" })).toBe(false);
  });
  it("rejects food entries missing name/mode", () => {
    expect(validateImport({ ...validExport(), ration: [{ pct: 100 }] })).toBe(false);
    expect(validateImport({ ...validExport(), library: [{ name: "Food A" }] })).toBe(false); // no mode
  });
  it("rejects log entries missing their primitive fields", () => {
    expect(validateImport({ ...validExport(), weightLog: [{ date: "2026-01-01", kg: "4.4" }] })).toBe(false); // kg not a number
    expect(validateImport({ ...validExport(), intakeLog: [{ kcal: 250 }] })).toBe(false); // no date
  });
});
