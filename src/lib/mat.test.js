import { describe, it, expect } from "vitest";
import { matmul, transpose, matadd, matVec, identity, diag, symmetrize } from "./mat.js";

describe("mat", () => {
  const A = [[1, 2], [3, 4]], B = [[5, 6], [7, 8]];
  it("multiplies (2×2)", () => expect(matmul(A, B)).toEqual([[19, 22], [43, 50]]));
  it("multiplies non-square (3×3)", () => {
    const M = [[1, 0, 2], [0, 1, 0], [0, 0, 1]];
    expect(matmul(M, identity(3))).toEqual(M);
  });
  it("transposes", () => expect(transpose(A)).toEqual([[1, 3], [2, 4]]));
  it("adds", () => expect(matadd(A, B)).toEqual([[6, 8], [10, 12]]));
  it("matrix × vector", () => expect(matVec(A, [1, 1])).toEqual([3, 7]));
  it("diag builds a diagonal matrix", () => expect(diag([2, 3])).toEqual([[2, 0], [0, 3]]));
  it("symmetrizes", () => expect(symmetrize([[1, 2], [4, 3]])).toEqual([[1, 3], [3, 3]]));
});
