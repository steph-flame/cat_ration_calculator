// Minimal dense linear algebra for small matrices — just what the Kalman filters need
// (2×2 for v2, 3×3 for v3). Hand-rolled, no dependency. Matrices are arrays of rows.

export const matmul = (A, B) => {
  const n = A.length, k = B.length, m = B[0].length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++)
    for (let t = 0; t < k; t++) { const a = A[i][t]; for (let j = 0; j < m; j++) C[i][j] += a * B[t][j]; }
  return C;
};

export const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));

export const matadd = (A, B) => A.map((row, i) => row.map((v, j) => v + B[i][j]));

export const matVec = (A, v) => A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));

export const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

export const diag = (arr) => arr.map((v, i) => arr.map((_, j) => (i === j ? v : 0)));

// Force symmetry — covariances should stay symmetric; float drift can nudge them.
export const symmetrize = (A) => A.map((row, i) => row.map((v, j) => (A[i][j] + A[j][i]) / 2));
