import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"

import { parseJson } from "./json-boundary.mjs"
import {
  SUPPORTED_NODE_ENGINE,
  collectDependencyVersions,
  evaluateRuntimeCohort,
  parseDependencyListOutput
} from "./verify-effect-cohort.mjs"

const packageDefinitions = [
  { name: "@firfi/voila-sdk", directory: "packages/voila-sdk", kind: "sdk" },
  { name: "@firfi/voila-mcp", directory: "packages/voila-mcp", kind: "mcp" },
  { name: "@firfi/voila-cli", directory: "packages/voila-cli", kind: "cli" }
]

const supportedManagers = ["pnpm", "npm"]
const processArgumentOffset = 2
const consumerPrefix = "voila-clean-consumer-"
const InstalledManifestSchema = Schema.Struct({
  bin: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  engines: Schema.Struct({ node: Schema.String })
})

export const parseManagerArguments = (args) => {
  const managerArgument = args.find((argument) => argument.startsWith("--manager="))
  const manager = managerArgument?.slice("--manager=".length) ?? "both"

  if (!["both", ...supportedManagers].includes(manager)) {
    throw new Error(`Unknown package manager '${manager}'; expected pnpm, npm, or both`)
  }

  return manager === "both" ? supportedManagers : [manager]
}

const run = (command, args, cwd, options = {}) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.capture === true ? ["ignore", "pipe", "pipe"] : "inherit"
  })

const localPackageOverrides = (manager, archives) => {
  if (manager !== "pnpm") return {}

  const sdk = archives.get("@firfi/voila-sdk")
  const mcp = archives.get("@firfi/voila-mcp")
  if (sdk === undefined || mcp === undefined) throw new Error("Missing package archive")

  return { pnpm: { overrides: { "@firfi/voila-mcp": `file:${mcp}`, "@firfi/voila-sdk": `file:${sdk}` } } }
}

const writeConsumerManifest = (directory, manager, archives) => {
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify(
      { name: "voila-clean-consumer", private: true, type: "module", ...localPackageOverrides(manager, archives) },
      null,
      2
    )}\n`,
    "utf8"
  )
}

const packPackages = (archiveDirectory, rootDirectory) => {
  const archives = new Map()

  for (const definition of packageDefinitions) {
    const before = new Set(readdirSync(archiveDirectory))
    run("pnpm", ["pack", "--pack-destination", archiveDirectory], resolve(rootDirectory, definition.directory), {
      env: { npm_config_ignore_scripts: "true" }
    })
    const archive = readdirSync(archiveDirectory).find((entry) => entry.endsWith(".tgz") && !before.has(entry))

    if (archive === undefined) {
      throw new Error(`pnpm pack did not produce an archive for ${definition.name}`)
    }

    archives.set(definition.name, join(archiveDirectory, archive))
  }

  return archives
}

const installArguments = (manager, archives) =>
  manager === "pnpm"
    ? ["add", "--no-optional", "--ignore-scripts", ...archives]
    : ["install", "--omit=optional", "--ignore-scripts", ...archives]

// The matrix installs the just-published RC.110 tarballs in a temporary
// directory, outside this workspace's .npmrc. Keep the bypass scoped to that
// disposable consumer so the normal workspace install remains quarantined.
const installEnvironment = (manager) => (manager === "pnpm" ? { npm_config_minimum_release_age: "0" } : {})

const listArguments = (manager) =>
  manager === "pnpm"
    ? ["list", "--prod", "--no-optional", "--depth", "Infinity", "--json"]
    : ["ls", "--omit=dev", "--all", "--json"]

const executablePath = (directory, name) =>
  join(directory, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name)

const installedManifest = (directory, packageName) => {
  const path = join(directory, "node_modules", ...packageName.split("/"), "package.json")
  return parseJson(InstalledManifestSchema, readFileSync(path, "utf8"))
}

const assertManifest = (directory, packageName, expectedBin) => {
  const manifest = installedManifest(directory, packageName)
  if (manifest.engines.node !== SUPPORTED_NODE_ENGINE) {
    throw new Error(`${packageName}: expected Node engine ${SUPPORTED_NODE_ENGINE}, found ${manifest.engines.node}`)
  }

  if (expectedBin !== undefined && JSON.stringify(manifest.bin) !== JSON.stringify(expectedBin)) {
    throw new Error(`${packageName}: unexpected executable metadata ${JSON.stringify(manifest.bin)}`)
  }
}

const assertRuntimeCohort = (listOutput, manager, consumerKind) => {
  const projects = parseDependencyListOutput(listOutput)
  const requiredRuntimePackages = consumerKind === "sdk" ? ["effect"] : ["effect", "@effect/platform-node", "redis"]
  const failures = evaluateRuntimeCohort(collectDependencyVersions(projects), requiredRuntimePackages)

  if (failures.length > 0) {
    throw new Error(`${manager}/${consumerKind}: runtime Effect cohort mismatch:\n${failures.join("\n")}`)
  }
}

const runSdkSmoke = (directory) => {
  const result = run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const sdk = await import('@firfi/voila-sdk'); if (typeof sdk.bootstrapGuestSession !== 'function') throw new Error('SDK entrypoint missing')"
    ],
    directory,
    { capture: true }
  )

  return result
}

const runCliSmoke = (directory) => {
  const output = run(executablePath(directory, "voila"), ["--help"], directory, { capture: true })
  if (!output.includes("voila auth login")) throw new Error("CLI help did not expose the root command inventory")
}

const runMcpSmoke = (directory) => {
  const result = spawnSync(executablePath(directory, "voila-mcp"), [], {
    encoding: "utf8",
    env: { ...process.env, MCP_TRANSPORT: "stdio", VOILA_GUEST: "1" },
    input: "",
    timeout: 20_000
  })

  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`MCP stdio clean-consumer process exited ${result.status}: ${result.stderr}`)
  }
}

const consumerArchives = (kind, archives) => {
  const sdk = archives.get("@firfi/voila-sdk")
  const mcp = archives.get("@firfi/voila-mcp")
  const cli = archives.get("@firfi/voila-cli")

  if (sdk === undefined || mcp === undefined || cli === undefined) throw new Error("Missing package archive")

  return kind === "sdk" ? [sdk] : kind === "mcp" ? [sdk, mcp] : [sdk, mcp, cli]
}

const runConsumer = (manager, kind, archives) => {
  const directory = mkdtempSync(join(tmpdir(), `${consumerPrefix}${manager}-${kind}-`))

  try {
    const localArchives = consumerArchives(kind, archives)
    writeConsumerManifest(directory, manager, archives)
    run(manager, installArguments(manager, localArchives), directory, { env: installEnvironment(manager) })
    const listOutput = run(manager, listArguments(manager), directory, { capture: true })
    assertRuntimeCohort(listOutput, manager, kind)

    if (kind === "sdk") {
      assertManifest(directory, "@firfi/voila-sdk")
      runSdkSmoke(directory)
    } else if (kind === "mcp") {
      assertManifest(directory, "@firfi/voila-mcp", { "voila-mcp": "./dist/bin.cjs" })
      runMcpSmoke(directory)
    } else {
      assertManifest(directory, "@firfi/voila-cli", { voila: "./dist/bin.cjs" })
      runCliSmoke(directory)
    }

    process.stdout.write(`Passed clean ${manager} consumer: ${kind} on ${process.version}\n`)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

export const runCleanConsumerMatrix = (managers = supportedManagers) => {
  const rootDirectory = resolve(".")
  const archiveDirectory = mkdtempSync(join(tmpdir(), "voila-package-archives-"))

  try {
    const archives = packPackages(archiveDirectory, rootDirectory)
    for (const manager of managers) {
      for (const definition of packageDefinitions) runConsumer(manager, definition.kind, archives)
    }
  } finally {
    rmSync(archiveDirectory, { force: true, recursive: true })
  }
}

const invocationPath = process.argv.slice(1).at(0)
const isEntryPoint = invocationPath !== undefined && fileURLToPath(import.meta.url) === resolve(invocationPath)

if (isEntryPoint) runCleanConsumerMatrix(parseManagerArguments(process.argv.slice(processArgumentOffset)))
