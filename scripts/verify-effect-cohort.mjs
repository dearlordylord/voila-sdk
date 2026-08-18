import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"

import { parseJson } from "./json-boundary.mjs"

export const EFFECT_COHORT_VERSION = "4.0.0-rc.110"
export const TSGO_VERSION = "0.36.5"
export const LANGUAGE_SERVICE_VERSION = "0.87.2"
export const VITEST_VERSION = "4.1.10"
export const REDIS_VERSION = "6.0.0"
export const SUPPORTED_NODE_ENGINE = "^22.22.2 || ^24.15.0"

const requiredVersions = new Map([
  ["effect", EFFECT_COHORT_VERSION],
  ["@effect/platform-node", EFFECT_COHORT_VERSION],
  ["@effect/vitest", EFFECT_COHORT_VERSION],
  ["@effect/tsgo", TSGO_VERSION],
  ["@effect/language-service", LANGUAGE_SERVICE_VERSION],
  ["vitest", VITEST_VERSION],
  ["@vitest/coverage-v8", VITEST_VERSION],
  ["redis", REDIS_VERSION]
])

const prohibitedPackages = new Set([
  "@effect/ai",
  "@effect/cli",
  "@effect/experimental",
  "@effect/platform",
  "@effect/rpc"
])

const workspacePackages = [
  "package.json",
  "packages/voila-sdk/package.json",
  "packages/voila-mcp/package.json",
  "packages/voila-cli/package.json",
  "packages/voila-session-store/package.json"
]

const WorkspaceManifestSchema = Schema.Struct({ engines: Schema.Struct({ node: Schema.String }) })
const DependencyRecordSchema = Schema.Record(
  Schema.String,
  Schema.suspend(() => DependencyProjectSchema)
)
export const DependencyProjectSchema = Schema.Struct({
  dependencies: Schema.optionalKey(DependencyRecordSchema),
  devDependencies: Schema.optionalKey(DependencyRecordSchema),
  optionalDependencies: Schema.optionalKey(DependencyRecordSchema),
  version: Schema.optionalKey(Schema.String)
})
const DependencyListOutputSchema = Schema.Union([Schema.Array(DependencyProjectSchema), DependencyProjectSchema])

export const parseDependencyListOutput = (input) => {
  const parsed = parseJson(DependencyListOutputSchema, input)
  return Array.isArray(parsed) ? parsed : [parsed]
}

const addVersion = (foundVersions, name, version) => {
  if (typeof version !== "string") return

  const versions = foundVersions.get(name) ?? new Set()
  versions.add(version)
  foundVersions.set(name, versions)
}

const visitPackage = (entry, foundVersions, visited) => {
  if (visited.has(entry)) return
  visited.add(entry)

  for (const sectionName of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const section = entry[sectionName]
    if (section === undefined) continue

    for (const [name, dependency] of Object.entries(section)) {
      if (
        name === "effect" ||
        name === "redis" ||
        name === "vitest" ||
        name.startsWith("@effect/") ||
        name.startsWith("@vitest/")
      ) {
        addVersion(foundVersions, name, dependency.version)
      }
      visitPackage(dependency, foundVersions, visited)
    }
  }
}

export const collectDependencyVersions = (projects) => {
  const foundVersions = new Map()
  const visited = new Set()

  for (const project of projects) visitPackage(project, foundVersions, visited)

  return foundVersions
}

const sortedVersions = (versions) => [...versions].sort((left, right) => left.localeCompare(right))

export const evaluateCohort = (foundVersions) => {
  const failures = []

  for (const [name, expectedVersion] of requiredVersions) {
    const versions = foundVersions.get(name) ?? new Set()
    if (versions.size !== 1 || !versions.has(expectedVersion)) {
      failures.push(
        `${name}: expected only ${expectedVersion}, found ${sortedVersions(versions).join(", ") || "nothing"}`
      )
    }
  }

  for (const name of prohibitedPackages) {
    const versions = foundVersions.get(name) ?? new Set()
    if (versions.size > 0) {
      failures.push(`${name}: prohibited package found at ${sortedVersions(versions).join(", ")}`)
    }
  }

  for (const [name, versions] of foundVersions) {
    if (requiredVersions.has(name) || prohibitedPackages.has(name)) continue

    const expectedVersion = name.startsWith("@effect/tsgo-") ? TSGO_VERSION : EFFECT_COHORT_VERSION
    if (name.startsWith("@effect/") && (versions.size !== 1 || !versions.has(expectedVersion))) {
      failures.push(
        `${name}: expected only ${expectedVersion}, found ${sortedVersions(versions).join(", ") || "nothing"}`
      )
    }
  }

  return failures
}

export const evaluateRuntimeCohort = (foundVersions, requiredRuntimePackages = []) => {
  const failures = []
  const runtimeRequiredVersions = new Map([
    ["effect", EFFECT_COHORT_VERSION],
    ["@effect/platform-node", EFFECT_COHORT_VERSION],
    ["redis", REDIS_VERSION]
  ])

  for (const [name, expectedVersion] of runtimeRequiredVersions) {
    const versions = foundVersions.get(name) ?? new Set()
    const required = requiredRuntimePackages.includes(name)
    const mismatch = versions.size !== 1 || !versions.has(expectedVersion)
    if (mismatch && (required || versions.size > 0)) {
      failures.push(
        `${name}: expected only ${expectedVersion}, found ${sortedVersions(versions).join(", ") || "nothing"}`
      )
    }
  }

  for (const name of prohibitedPackages) {
    const versions = foundVersions.get(name) ?? new Set()
    if (versions.size > 0) {
      failures.push(`${name}: prohibited package found at ${sortedVersions(versions).join(", ")}`)
    }
  }

  for (const [name, versions] of foundVersions) {
    if (!name.startsWith("@effect/") || prohibitedPackages.has(name)) continue
    const expectedVersion =
      name === "@effect/language-service" || name.startsWith("@effect/tsgo")
        ? name === "@effect/language-service"
          ? LANGUAGE_SERVICE_VERSION
          : TSGO_VERSION
        : EFFECT_COHORT_VERSION
    if (versions.size !== 1 || !versions.has(expectedVersion)) {
      failures.push(
        `${name}: expected only ${expectedVersion}, found ${sortedVersions(versions).join(", ") || "nothing"}`
      )
    }
  }

  return failures
}

const readWorkspaceManifest = (path) => parseJson(WorkspaceManifestSchema, readFileSync(resolve(path), "utf8"))

export const verifyWorkspaceEngines = () => {
  const failures = []

  for (const path of workspacePackages) {
    const manifest = readWorkspaceManifest(path)
    const actual = manifest.engines.node
    if (actual !== SUPPORTED_NODE_ENGINE) {
      failures.push(`${path}: expected engines.node ${SUPPORTED_NODE_ENGINE}, found ${actual}`)
    }
  }

  return failures
}

const installedProjects = () =>
  parseDependencyListOutput(
    execFileSync("pnpm", ["list", "--recursive", "--depth", "Infinity", "--json"], { encoding: "utf8" })
  )

const tsgoVersion = () =>
  execFileSync("pnpm", ["--silent", "exec", "effect-tsgo", "--version"], { encoding: "utf8" }).trim()

export const verifyInstalledCohort = () => {
  const foundVersions = collectDependencyVersions(installedProjects())
  const failures = [...evaluateCohort(foundVersions), ...verifyWorkspaceEngines()]
  const expectedTsgoVersion = `tsgo v${TSGO_VERSION}`
  const actualTsgoVersion = tsgoVersion()

  if (actualTsgoVersion !== expectedTsgoVersion) {
    failures.push(`effect-tsgo: expected ${expectedTsgoVersion}, found ${actualTsgoVersion || "nothing"}`)
  }

  return { failures, foundVersions, tsgoVersion: actualTsgoVersion }
}

const main = () => {
  const result = verifyInstalledCohort()

  if (result.failures.length > 0) {
    throw new Error(`Effect dependency cohort mismatch:\n${result.failures.join("\n")}`)
  }

  process.stdout.write(
    `Verified exact Effect ${EFFECT_COHORT_VERSION} cohort, tsgo ${TSGO_VERSION}, Vitest ${VITEST_VERSION}, Redis ${REDIS_VERSION}, and Node ${SUPPORTED_NODE_ENGINE}.\n`
  )
}

const invocationPath = process.argv.slice(1).at(0)
const isEntryPoint = invocationPath !== undefined && fileURLToPath(import.meta.url) === resolve(invocationPath)

if (isEntryPoint) main()
