import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { artifactManifest } from "./oracle-artifacts.mjs"
import { captureOracleCorpus } from "./oracle-probe.mjs"
import { assertReviewedParity, readOracle, validateAllowlist, writeJson } from "./oracle-core.mjs"
import { oracleWorkspaceRoot } from "./oracle-workspace.mjs"
import { parseJsonValue } from "./json-boundary.mjs"

const execFileAsync = promisify(execFile)
const root = oracleWorkspaceRoot
const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
export const defaultSupplementalOraclePath = resolve(sourceRoot, "scripts/oracle-baselines/baseline-v2.json")
export const defaultSupplementalAllowlistPath = resolve(sourceRoot, "scripts/oracle-baselines/allowlist-v2.json")

const currentProvenance = async () => {
  const artifacts = await artifactManifest(root)
  const effectVersions = [
    ...new Set(
      artifacts.flatMap((artifact) =>
        artifact.dependencyClosure.filter(({ name }) => name === "effect").map(({ version }) => version)
      )
    )
  ]
  const revision = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })
  return {
    captureKind: "current-supplemental-v2",
    effectVersion: effectVersions[0] ?? "unresolved",
    sourceRevision: revision.stdout.trim(),
    supplements: "baseline-v2.json"
  }
}

const parseArgs = (args) => ({
  allowlistPath: resolve(args[args.indexOf("--allowlist") + 1] ?? defaultSupplementalAllowlistPath),
  baselinePath: resolve(args[args.indexOf("--baseline") + 1] ?? defaultSupplementalOraclePath)
})

export const verifySupplemental = async ({
  allowlistPath = defaultSupplementalAllowlistPath,
  baselinePath = defaultSupplementalOraclePath
} = {}) => {
  const baseline = await readOracle(baselinePath)
  const allowlist = validateAllowlist(parseJsonValue(await readFile(allowlistPath, "utf8")))
  const directory = await mkdtemp(join(resolve(root), ".oracle-v2-"))
  const currentPath = join(directory, "current.json")
  try {
    const captured = await captureOracleCorpus({ supplemental: true })
    const current = { ...captured, capture: { ...captured.capture, provenance: await currentProvenance() } }
    await writeJson(currentPath, current)
    const result = assertReviewedParity(baseline.supplemental, current.supplemental, allowlist)
    return { ...result, baselineHash: baseline.contentHash, currentProvenance: current.capture.provenance }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifySupplemental(parseArgs(process.argv.slice(2)))
    console.log(`Voila supplemental oracle parity passed: ${result.baselineHash}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
