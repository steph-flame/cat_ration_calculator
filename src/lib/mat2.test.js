import { describe, it, expect } from "vitest";
import { mm, mT, madd, sym, mv } from "./mat2.js";

describe("mat2", () => {
  const A = [[1, 2], [3, 4]], B = [[5, 6], [7, 8]];
  it("multiplies", () => expect(mm(A, B)).toEqual([[19, 22], [43, 50]]));
  it("transposes", () => expect(mT(A)).toEqual([[1, 3], [2, 4]]));
  it("adds", () => expect(madd(A, B)).toEqual([[6, 8], [10, 12]]));
  it("symmetrizes", () => expect(sym([[1, 2], [4, 3]])).toEqual([[1, 3], [3, 3]]));
  it("matrix × vector", () => expect(mv(A, [1, 1])).toEqual([3, 7]));
  it("identity multiply is a no-op", () => expect(mm([[1, 0], [0, 1]], A)).toEqual(A));
});
