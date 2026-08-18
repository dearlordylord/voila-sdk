import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { artifactManifest } from "./oracle-artifacts.mjs"
import { capture, exactEffect3Version } from "./oracle-capture.mjs"
import { oracleWorkspaceRoot } from "./oracle-workspace.mjs"

const execFileAsync = promisify(execFile)
const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
export const defaultSupplementalOraclePath = resolve(sourceRoot, "docs/migrations/effect-4/oracle/baseline-v2.json")

export const supplementalProvenance = async (rootPath = oracleWorkspaceRoot) => {
  const artifacts = await artifactManifest(rootPath)
  const effectVersions = [
    ...new Set(
      artifacts.flatMap((artifact) =>
        artifact.dependencyClosure.filter(({ name }) => name === "effect").map(({ version }) => version)
      )
    )
  ]
  if (effectVersions.length !== 1 || effectVersions[0] !== exactEffect3Version) {
    throw new Error(`Supplemental baseline requires exactly Effect ${exactEffect3Version}`)
  }
  const revision = await execFileAsync("git", ["-C", rootPath, "rev-parse", "HEAD"], { encoding: "utf8" })
  return {
    captureGuard: "fresh-dist+exact-effect-3",
    captureKind: "effect3-supplemental-v2",
    effectVersion: exactEffect3Version,
    sourceRevision: revision.stdout.trim(),
    supplements: "baseline.json"
  }
}

export const captureSupplementalOracle = async (outputPath = defaultSupplementalOraclePath) =>
  capture(outputPath, { provenance: await supplementalProvenance(), supplemental: true })

const parseOutput = (args) => {
  const index = args.indexOf("--output")
  const output = index < 0 ? defaultSupplementalOraclePath : args[index + 1]
  if (output === undefined || output.startsWith("--")) throw new Error("--output requires a path")
  return resolve(output)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const envelope = await captureSupplementalOracle(parseOutput(process.argv.slice(2)))
    console.log(`Captured immutable supplemental Voila oracle v2: ${envelope.contentHash}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
