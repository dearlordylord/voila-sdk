import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { captureOracleCorpus } from "./oracle-probe.mjs"
import { assertReviewedParity, readOracle, validateAllowlist, writeJson } from "./oracle-core.mjs"
import { oracleWorkspaceRoot } from "./oracle-workspace.mjs"

const root = oracleWorkspaceRoot
export const defaultOraclePath = resolve(root, "docs/migrations/effect-4/oracle/baseline.json")
export const defaultAllowlistPath = resolve(root, "docs/migrations/effect-4/oracle/allowlist.json")

const parseArgs = (args) => ({
  allowlist: resolve(args[args.indexOf("--allowlist") + 1] ?? defaultAllowlistPath),
  baseline: resolve(args[args.indexOf("--baseline") + 1] ?? defaultOraclePath)
})

export const verify = async ({ allowlistPath = defaultAllowlistPath, baselinePath = defaultOraclePath } = {}) => {
  const baseline = await readOracle(baselinePath)
  const allowlist = validateAllowlist(JSON.parse(await readFile(allowlistPath, "utf8")))
  const directory = await mkdtemp(join(tmpdir(), "voila-oracle-"))
  const currentPath = join(directory, "current.json")
  try {
    const current = await captureOracleCorpus()
    await writeJson(currentPath, current)
    const baselineCorpus = Object.fromEntries(
      Object.entries(baseline).filter(([key]) => key !== "contentHash" && key !== "oracleVersion")
    )
    const result = assertReviewedParity(baselineCorpus, current, allowlist)
    return { ...result, baselineHash: baseline.contentHash }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await verify(parseArgs(process.argv.slice(2)))
    console.log(`Voila oracle parity passed: ${result.baselineHash}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
