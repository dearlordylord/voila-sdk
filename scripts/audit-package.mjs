import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { chdir, cwd } from "node:process"
import { Schema } from "effect"

import { parseJson } from "./json-boundary.mjs"
import { EFFECT_COHORT_VERSION, REDIS_VERSION, SUPPORTED_NODE_ENGINE } from "./verify-effect-cohort.mjs"

const packageDirectory = process.argv[2] ?? "."
const packageKind = process.argv[3] ?? "sdk"
const originalCwd = cwd()

const requiredByKind = {
  bin: [
    "LICENSE",
    "README.md",
    "dist/bin.cjs",
    "dist/index.cjs",
    "dist/index.mjs",
    "dist/types/index.d.ts",
    "package.json"
  ],
  sdk: ["LICENSE", "README.md", "dist/src/index.d.ts", "dist/src/index.js", "package.json"]
}

const allowedDistExtensions = [".cjs", ".d.ts", ".d.ts.map", ".js", ".js.map", ".mjs"]
const DependenciesSchema = Schema.Record(Schema.String, Schema.String)
const PackageManifestSchema = Schema.Struct({
  dependencies: Schema.optionalKey(DependenciesSchema),
  devDependencies: Schema.optionalKey(DependenciesSchema),
  engines: Schema.Struct({ node: Schema.String })
})
const PackOutputSchema = Schema.Array(
  Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })), name: Schema.String })
).pipe(Schema.check(Schema.isMinLength(1)))

if (!Object.hasOwn(requiredByKind, packageKind)) {
  throw new Error(`Unknown package audit kind: ${packageKind}`)
}

chdir(packageDirectory)

try {
  const manifest = parseJson(PackageManifestSchema, readFileSync("package.json", "utf8"))
  const packageDependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  const prohibitedDependencies = [
    "@effect/ai",
    "@effect/cli",
    "@effect/experimental",
    "@effect/platform",
    "@effect/rpc"
  ]

  if (manifest.engines.node !== SUPPORTED_NODE_ENGINE) {
    throw new Error(`Package declares unsupported Node engine: expected ${SUPPORTED_NODE_ENGINE}`)
  }

  if (manifest.dependencies?.effect !== EFFECT_COHORT_VERSION) {
    throw new Error(`Package must depend on exact Effect ${EFFECT_COHORT_VERSION}`)
  }

  if (
    manifest.dependencies["@effect/platform-node"] === EFFECT_COHORT_VERSION &&
    manifest.dependencies.redis !== REDIS_VERSION
  ) {
    throw new Error(`Package using @effect/platform-node must provide exact redis ${REDIS_VERSION}`)
  }

  const prohibited = prohibitedDependencies.filter((name) => Object.hasOwn(packageDependencies, name))
  if (prohibited.length > 0) {
    throw new Error(`Package contains removed Effect dependencies: ${prohibited.join(", ")}`)
  }

  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" })
  const [pack] = parseJson(PackOutputSchema, output)
  const paths = pack.files.map((file) => file.path)
  const requiredFiles = requiredByKind[packageKind]

  const missing = requiredFiles.filter((path) => !paths.includes(path))

  if (missing.length > 0) {
    throw new Error(`Package is missing required files: ${missing.join(", ")}`)
  }

  const unexpectedFiles = paths.filter(
    (path) =>
      !requiredFiles.includes(path) &&
      path !== "dist/types/bin.d.ts" &&
      path !== "dist/types/bin.d.ts.map" &&
      path.startsWith("dist/") === false
  )

  if (unexpectedFiles.length > 0) {
    throw new Error(`Package contains unexpected files: ${unexpectedFiles.join(", ")}`)
  }

  const leaked = paths.filter(
    (path) =>
      path.startsWith("dist/test/") ||
      path.startsWith("test/") ||
      path.startsWith("src/") ||
      path.endsWith(".tsbuildinfo")
  )

  if (leaked.length > 0) {
    throw new Error(`Package contains non-publishable files: ${leaked.join(", ")}`)
  }

  const invalidDistFiles = paths.filter(
    (path) => path.startsWith("dist/") && !allowedDistExtensions.some((extension) => path.endsWith(extension))
  )

  if (invalidDistFiles.length > 0) {
    throw new Error(`Package contains unexpected dist files: ${invalidDistFiles.join(", ")}`)
  }

  const missingDeclarationFiles = paths
    .filter((path) => path.startsWith("dist/src/") && path.endsWith(".js"))
    .map((path) => path.replace(/\.js$/, ".d.ts"))
    .filter((path) => !paths.includes(path))

  if (missingDeclarationFiles.length > 0) {
    throw new Error(`Package JavaScript files are missing declarations: ${missingDeclarationFiles.join(", ")}`)
  }

  console.log(`Package audit passed for ${pack.name} with ${paths.length} files`)
} finally {
  chdir(originalCwd)
}
