import { createRequire } from "node:module"
import { readFile, readdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { Schema } from "effect"

import { hashFile } from "./oracle-core.mjs"
import { oracleWorkspaceRoot } from "./oracle-workspace.mjs"
import { parseJson } from "./json-boundary.mjs"

const root = oracleWorkspaceRoot

const DependencyRecordSchema = Schema.Record(Schema.String, Schema.String)
const PackageManifestSchema = Schema.Struct({
  bin: Schema.optionalKey(Schema.Json),
  dependencies: Schema.optionalKey(DependencyRecordSchema),
  exports: Schema.optionalKey(Schema.Json),
  main: Schema.optionalKey(Schema.String),
  name: Schema.String,
  peerDependencies: Schema.optionalKey(DependencyRecordSchema),
  version: Schema.String
})
const SourceMapSchema = Schema.Struct({ sources: Schema.optionalKey(Schema.Array(Schema.String)) })

const readPackageManifest = async (path) => parseJson(PackageManifestSchema, await readFile(path, "utf8"))

const allFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await allFiles(path)))
    else if (!entry.name.endsWith(".tsbuildinfo")) files.push(path)
  }
  return files
}

const installedPackage = async (fromRoot, name) => {
  try {
    const resolver = createRequire(join(fromRoot, "package.json"))
    let path = resolver.resolve(name)
    while (path !== root && path !== "/") {
      path = join(path, "..")
      try {
        const candidate = await readPackageManifest(join(path, "package.json"))
        if (candidate.name === name) return { json: candidate, root: path }
      } catch {
        // Continue walking through a package's dist directory.
      }
    }
  } catch {
    // The lockfile may declare an optional package that is not installed.
  }
  return { json: { name, version: "unresolved" }, root: undefined }
}

const artifactPackageSpecs = (rootPath) => [
  { name: "@firfi/voila-mcp", path: join(rootPath, "packages/voila-mcp") },
  { name: "@firfi/voila-cli", path: join(rootPath, "packages/voila-cli") },
  { name: "@firfi/voila-sdk", path: join(rootPath, "packages/voila-sdk") }
]

/**
 * A capture is only meaningful when every source package was built after its
 * source tree. This is deliberately a conservative check: one old dist file
 * is enough to reject a capture rather than silently mixing source revisions.
 */
export const assertFreshBuiltArtifacts = async (rootPath = root) => {
  const stale = []
  for (const spec of artifactPackageSpecs(rootPath)) {
    try {
      const sourceFiles = await allFiles(join(spec.path, "src"))
      const distFiles = await allFiles(join(spec.path, "dist"))
      if (sourceFiles.length === 0 || distFiles.length === 0) {
        stale.push({ name: spec.name, reason: "source-or-dist-is-empty" })
        continue
      }
      const sourceTimes = await Promise.all(sourceFiles.map(async (path) => (await stat(path)).mtimeMs))
      const distTimes = await Promise.all(distFiles.map(async (path) => (await stat(path)).mtimeMs))
      const newestSource = Math.max(...sourceTimes)
      const oldestDist = Math.min(...distTimes)
      if (oldestDist < newestSource) stale.push({ name: spec.name, newestSource, oldestDist })
    } catch (error) {
      stale.push({ name: spec.name, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  if (stale.length > 0) {
    throw new Error(`Fresh built-artifact guard failed: ${JSON.stringify(stale)}`)
  }
  return true
}

const packageClosure = async (packageRoot, packageJson, seen = new Set()) => {
  const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.peerDependencies ?? {}) }
  const result = []
  for (const name of Object.keys(dependencies).sort()) {
    const installed = await installedPackage(packageRoot, name)
    const key = `${name}@${installed.json.version}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ name, requested: dependencies[name], version: installed.json.version })
    if (installed.root !== undefined) result.push(...(await packageClosure(installed.root, installed.json, seen)))
  }
  return result
}

export const artifactManifest = async (rootPath = root) => {
  const packages = []
  for (const spec of artifactPackageSpecs(rootPath)) {
    const packageJson = await readPackageManifest(join(spec.path, "package.json"))
    const files = []
    for (const path of await allFiles(join(spec.path, "dist"))) {
      const fileStat = await stat(path)
      files.push({ path: relative(spec.path, path), sha256: await hashFile(path), size: fileStat.size })
    }
    files.sort((left, right) => left.path.localeCompare(right.path))
    const composition = {}
    const compositionStatus = {}
    for (const file of files.filter(({ path }) => path.endsWith(".cjs") || path.endsWith(".mjs"))) {
      try {
        const map = parseJson(SourceMapSchema, await readFile(join(spec.path, `${file.path}.map`), "utf8"))
        composition[file.path] = (map.sources ?? []).map((source) => source.replaceAll("\\", "/")).sort()
        compositionStatus[file.path] = "available"
      } catch (error) {
        const unavailable = {
          reason: error?.code === "ENOENT" ? "source-map-not-emitted" : "source-map-invalid",
          status: "unavailable"
        }
        composition[file.path] = unavailable
        compositionStatus[file.path] = unavailable
      }
    }
    packages.push({
      bin: packageJson.bin ?? {},
      bundleComposition: composition,
      bundleCompositionStatus: compositionStatus,
      dependencyClosure: await packageClosure(spec.path, packageJson),
      entryPoints: { exports: packageJson.exports, main: packageJson.main },
      files,
      name: packageJson.name,
      version: packageJson.version
    })
  }
  return packages
}
