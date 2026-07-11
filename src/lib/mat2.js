// Minimal 2×2 / 2-vector linear algebra — just what the 2-state Kalman filter needs.
// Hand-rolled (no dependency, no general matrix lib) because at this size it's clearer
// and matches the "shows its work" ethos. Matrices are [[a, b], [c, d]]; vectors [x, y].

export const mm = (A, B) => [
  [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
  [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
];

export const mT = (A) => [[A[0][0], A[1][0]], [A[0][1], A[1][1]]];

export const madd = (A, B) => [
  [A[0][0] + B[0][0], A[0][1] + B[0][1]],
  [A[1][0] + B[1][0], A[1][1] + B[1][1]],
];

// Symmetrize — covariances should stay symmetric; floating-point drift can nudge them.
export const sym = (A) => {
  const off = (A[0][1] + A[1][0]) / 2;
  return [[A[0][0], off], [off, A[1][1]]];
};

// Matrix × vector.
export const mv = (A, v) => [A[0][0] * v[0] + A[0][1] * v[1], A[1][0] * v[0] + A[1][1] * v[1]];
