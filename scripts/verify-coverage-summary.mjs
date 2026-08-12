import { readFile } from "node:fs/promises"

import { coveragePolicy } from "./coverage-policy.mjs"

const summaryPath = process.argv[2] ?? "coverage/coverage-summary.json"
const summary = JSON.parse(await readFile(summaryPath, "utf8"))
const failures = coveragePolicy.metrics.flatMap((metric) => {
  const percentage = summary?.total?.[metric]?.pct

  return typeof percentage === "number" && percentage >= coveragePolicy.threshold
    ? []
    : [`${metric}: expected at least ${coveragePolicy.threshold}%, observed ${String(percentage)}`]
})

if (failures.length > 0) {
  process.stderr.write(`Coverage threshold failure:\n${failures.join("\n")}\n`)
  process.exitCode = 1
}
