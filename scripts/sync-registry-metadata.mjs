#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { Schema } from "effect"

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
const ConcreteVersion = NonEmptyString.pipe(
  Schema.check(
    Schema.makeFilter((value) => value !== "latest" && !/^[~^>=<*]|\.x$|\.\*$/.test(value), {
      message: "Expected a concrete package version"
    })
  )
)
const GitHubUrl = NonEmptyString.pipe(Schema.check(Schema.isPattern(/^https:\/\/github\.com\/[^/]+\/[^/]+$/)))
const McpServerName = NonEmptyString.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/)))

const PackageJsonSchema = Schema.Struct({
  homepage: NonEmptyString,
  mcpName: McpServerName,
  name: NonEmptyString,
  repository: Schema.Struct({ url: NonEmptyString }),
  version: ConcreteVersion
})

const EnvironmentVariableSchema = Schema.Struct({
  description: NonEmptyString,
  format: Schema.optionalKey(Schema.Literals(["string", "number", "boolean", "filepath"])),
  isRequired: Schema.optionalKey(Schema.Boolean),
  isSecret: Schema.optionalKey(Schema.Boolean),
  name: NonEmptyString,
  placeholder: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.String)
})

const PackageSchema = Schema.Struct({
  environmentVariables: Schema.optionalKey(Schema.Array(EnvironmentVariableSchema)),
  identifier: NonEmptyString,
  registryType: NonEmptyString,
  transport: Schema.Struct({ type: Schema.Literal("stdio") }),
  version: ConcreteVersion
})

const ServerJsonSchema = Schema.Struct({
  $schema: Schema.Literal("https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"),
  description: NonEmptyString.pipe(Schema.check(Schema.isMaxLength(100))),
  name: McpServerName,
  packages: Schema.Array(PackageSchema),
  repository: Schema.Struct({
    id: Schema.optionalKey(NonEmptyString),
    source: Schema.Literal("github"),
    url: GitHubUrl
  }),
  title: Schema.optionalKey(NonEmptyString),
  version: ConcreteVersion,
  websiteUrl: NonEmptyString
})

const readJson = (path, schema, options = {}) => {
  const raw = JSON.parse(readFileSync(path, "utf-8"))
  const parsed = Schema.decodeUnknownSync(schema)(raw)

  return options.preserveRaw === true ? raw : parsed
}

const normalizeRepositoryUrl = (url) =>
  url
    .replace(/^git\+https:\/\//, "https://")
    .replace(/^git\+ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")

const checkMode = process.argv.includes("--check")
const packageJsonPath = join(process.cwd(), "packages/voila-mcp/package.json")
const serverJsonPath = join(process.cwd(), "server.json")

const packageJson = readJson(packageJsonPath, PackageJsonSchema)
const serverJson = readJson(serverJsonPath, ServerJsonSchema, { preserveRaw: true })

const updatedServerJson = {
  ...serverJson,
  name: packageJson.mcpName,
  repository: { ...serverJson.repository, url: normalizeRepositoryUrl(packageJson.repository.url) },
  websiteUrl: packageJson.homepage,
  version: packageJson.version,
  packages: serverJson.packages.map((entry) =>
    entry?.registryType === "npm" ? { ...entry, identifier: packageJson.name, version: packageJson.version } : entry
  )
}

const currentContent = readFileSync(serverJsonPath, "utf-8")
const updatedContent = `${JSON.stringify(updatedServerJson, null, 2)}\n`

if (currentContent === updatedContent) {
  console.log("server.json is in sync with packages/voila-mcp/package.json")
  process.exit(0)
}

if (checkMode) {
  console.error("server.json is out of sync with packages/voila-mcp/package.json. Run `pnpm sync-registry-metadata`.")
  process.exit(1)
}

writeFileSync(serverJsonPath, updatedContent, "utf-8")
console.log("Updated server.json from packages/voila-mcp/package.json")
