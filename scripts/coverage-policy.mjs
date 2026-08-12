/** One coverage policy consumed by both Vitest and the independent exit-code verifier. */
export const coveragePolicy = Object.freeze({
  metrics: Object.freeze(["statements", "branches", "functions", "lines"]),
  threshold: 99
})
