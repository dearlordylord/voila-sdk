import { access, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { captureOracleCorpus } from "./oracle-probe.mjs"
import { writeOracle } from "./oracle-core.mjs"
import { artifactManifest, assertFreshBuiltArtifacts } from "./oracle-artifacts.mjs"
import { oracleWorkspaceRoot } from "./oracle-workspace.mjs"

const root = oracleWorkspaceRoot
export const defaultOraclePath = resolve(root, "scripts/oracle-baselines/baseline.json")
export const exactEffect3Version = "3.22.1"

const parseOutput = (args) => {
  const outputIndex = args.indexOf("--output")
  if (outputIndex < 0) return defaultOraclePath
  const output = args[outputIndex + 1]
  if (output === undefined || output.startsWith("--")) throw new Error("--output requires a path")
  return resolve(output)
}

export const capture = async (outputPath = defaultOraclePath, { provenance, supplemental = false } = {}) => {
  try {
    await access(outputPath)
    throw new Error(`Refusing to overwrite immutable oracle at ${outputPath}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing")) throw error
  }
  await assertCaptureEnvironment(root)
  await mkdir(dirname(outputPath), { recursive: true })
  const corpus = await captureOracleCorpus({ supplemental })
  const enriched = provenance === undefined ? corpus : { ...corpus, capture: { ...corpus.capture, provenance } }
  return writeOracle(outputPath, enriched)
}

/**
 * The immutable oracle must be captured before the migration changes the
 * dependency cohort. Verify both halves of that claim before loading any
 * built package or writing the output file.
 */
export const assertCaptureEnvironment = async (rootPath = root) => {
  const failures = []
  try {
    await assertFreshBuiltArtifacts(rootPath)
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }

  try {
    const artifacts = await artifactManifest(rootPath)
    const mismatches = []
    for (const artifact of artifacts) {
      const effectDependencies = artifact.dependencyClosure.filter(({ name }) => name === "effect")
      if (effectDependencies.length === 0) {
        mismatches.push({ name: artifact.name, reason: "effect-is-unresolved" })
        continue
      }
      for (const dependency of effectDependencies) {
        if (dependency.version !== exactEffect3Version) {
          mismatches.push({ name: artifact.name, requested: dependency.requested, resolved: dependency.version })
        }
      }
    }
    if (mismatches.length > 0) {
      failures.push(`Exact Effect 3 guard failed: ${JSON.stringify(mismatches)}`)
    }
  } catch (error) {
    failures.push(`Effect dependency inspection failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (failures.length > 0) throw new Error(`Immutable oracle capture guard failed: ${failures.join("; ")}`)
  return true
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const envelope = await capture(parseOutput(process.argv.slice(2)))
    console.log(`Captured immutable Voila oracle: ${envelope.contentHash}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
