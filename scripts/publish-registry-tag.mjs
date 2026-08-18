#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { Schema } from "effect"

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
const ServerJsonSchema = Schema.Struct({ name: NonEmptyString, version: NonEmptyString })

const PackageJsonSchema = Schema.Struct({ mcpName: NonEmptyString, version: NonEmptyString })

const readJson = (path, schema) => {
  const raw = JSON.parse(readFileSync(path, "utf-8"))

  return Schema.decodeUnknownSync(schema)(raw)
}

const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const hasTag = (ref) => {
  try {
    run("git", ["rev-parse", "--verify", "--quiet", ref])

    return true
  } catch {
    return false
  }
}

const serverJson = readJson("server.json", ServerJsonSchema)
const packageJson = readJson("packages/voila-mcp/package.json", PackageJsonSchema)
const checkOnly = process.argv.includes("--check")

if (serverJson.name !== packageJson.mcpName) {
  console.error(`server.json name ${serverJson.name} does not match package mcpName ${packageJson.mcpName}`)
  process.exit(1)
}

if (serverJson.version !== packageJson.version) {
  console.error(`server.json version ${serverJson.version} does not match package version ${packageJson.version}`)
  process.exit(1)
}

const tagName = `v${serverJson.version}`
const currentCommit = run("git", ["rev-parse", "HEAD"])
const status = run("git", ["status", "--porcelain"])

if (status.length > 0) {
  console.error(`refusing to release ${tagName}: worktree has uncommitted changes`)
  process.exit(1)
}

if (checkOnly) {
  console.log(`release worktree is clean for ${tagName}`)
  process.exit(0)
}

const remoteTag = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tagName}`])

if (remoteTag.length > 0) {
  console.log(`${tagName} already exists on origin; registry publish workflow should already have run`)
  process.exit(0)
}

if (hasTag(`refs/tags/${tagName}`)) {
  const tagCommit = run("git", ["rev-list", "-n", "1", tagName])

  if (tagCommit !== currentCommit) {
    console.error(`${tagName} exists locally at ${tagCommit}, not current commit ${currentCommit}`)
    process.exit(1)
  }
} else {
  execFileSync("git", ["tag", tagName], { stdio: "inherit" })
}

execFileSync("git", ["push", "origin", `refs/tags/${tagName}`], { stdio: "inherit" })
console.log(
  `pushed ${tagName}; GitHub Actions will publish ${serverJson.name}@${serverJson.version} to the MCP Registry`
)
