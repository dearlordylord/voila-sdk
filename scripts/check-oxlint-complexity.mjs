import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"

const suppressionPath = "oxlint-complexity-suppressions.json"
const result = spawnSync("pnpm", ["exec", "oxlint", "-c", "oxlint.complexity.json", "-f", "json", "packages"], {
  encoding: "utf8"
})

if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
  throw result.error ?? new Error(result.stderr)
}

const parsed = JSON.parse(result.stdout)

if (typeof parsed !== "object" || parsed === null || !("diagnostics" in parsed) || !Array.isArray(parsed.diagnostics)) {
  throw new Error("Oxlint returned an unexpected JSON diagnostic shape")
}

const diagnosticsByFile = new Map()

for (const diagnostic of parsed.diagnostics) {
  const span = diagnostic?.labels?.[0]?.span
  if (
    typeof diagnostic !== "object" ||
    diagnostic === null ||
    diagnostic.code !== "eslint(complexity)" ||
    typeof diagnostic.filename !== "string" ||
    typeof diagnostic.message !== "string" ||
    typeof span?.offset !== "number" ||
    typeof span?.length !== "number"
  )
    continue

  const filename = relative(process.cwd(), resolve(diagnostic.filename))
  const source = readFileSync(filename, "utf8").slice(span.offset, span.offset + span.length)
  const signature = source
    .slice(0, source.indexOf("{") === -1 ? 120 : source.indexOf("{"))
    .replaceAll(/\s+/gu, " ")
    .trim()
  const match = /complexity of (\d+)/u.exec(diagnostic.message)
  if (match === null) throw new Error(`Could not parse complexity diagnostic: ${diagnostic.message}`)

  const entry = { complexity: Number(match[1]), signature }
  diagnosticsByFile.set(filename, [...(diagnosticsByFile.get(filename) ?? []), entry])
}

const sorted = [...diagnosticsByFile]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([filename, diagnostics]) => [
    filename,
    diagnostics.toSorted((left, right) => left.signature.localeCompare(right.signature))
  ])

if (process.argv.includes("--prune")) {
  writeFileSync(suppressionPath, `${JSON.stringify(Object.fromEntries(sorted), undefined, 2)}\n`)
  console.log(`Updated ${suppressionPath} with ${sorted.length} files.`)
} else {
  const expected = JSON.parse(readFileSync(suppressionPath, "utf8"))
  const actual = Object.fromEntries(sorted)

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(
      "Cyclomatic complexity diagnostics changed. Refactor new/worsened offenders or intentionally prune the baseline."
    )
    process.exitCode = 1
  } else {
    console.log(`Cyclomatic complexity is within the recorded per-function baseline for ${sorted.length} files.`)
  }
}
