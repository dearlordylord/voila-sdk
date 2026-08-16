import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { argv, platform } from "node:process"
import { fileURLToPath } from "node:url"

const ownerExecutable = 0o100
const executableMode = 0o755

// @effect/tsgo 0.24.3 publishes its native binaries without an executable bit,
// and the CLI spawns them by path rather than through a bin shim, so every
// install leaves `effect-tsgo diagnostics` failing with EACCES until this runs.
export const ensureExecutable = (executablePath) => {
  if ((statSync(executablePath).mode & ownerExecutable) !== 0) {
    return false
  }

  chmodSync(executablePath, executableMode)

  return true
}

const nativeBinariesBelow = (packageDirectory) => {
  const libraryDirectory = join(packageDirectory, "lib")

  if (!existsSync(libraryDirectory)) {
    return []
  }

  return readdirSync(libraryDirectory)
    .filter((entry) => entry === "tsc" || entry.startsWith("tsc-"))
    .map((entry) => join(libraryDirectory, entry))
    .filter((entry) => statSync(entry).isFile())
}

// Every installed platform package is repaired, not just this machine's: a
// workspace may carry binaries for another platform (a Linux image built on a
// Mac), and those are just as broken when they get there.
export const installedNativeBinaries = (workspaceDirectory) => {
  const virtualStore = join(workspaceDirectory, "node_modules", ".pnpm")

  if (!existsSync(virtualStore)) {
    return []
  }

  return readdirSync(virtualStore)
    .filter((entry) => entry.startsWith("@effect+tsgo-"))
    .flatMap((entry) => {
      const scopeDirectory = join(virtualStore, entry, "node_modules", "@effect")

      return existsSync(scopeDirectory)
        ? readdirSync(scopeDirectory).flatMap((name) => nativeBinariesBelow(join(scopeDirectory, name)))
        : []
    })
}

// Fallback for layouts the virtual store scan does not know about: ask the CLI
// where its own binary lives.
const effectTsgoExecutablePath = () =>
  execFileSync(resolve("node_modules", ".bin", "effect-tsgo"), ["get-exe-path"], { encoding: "utf8" }).trim()

const prepare = () => {
  const binaries = installedNativeBinaries(resolve("."))

  if (binaries.length === 0) {
    ensureExecutable(effectTsgoExecutablePath())

    return
  }

  binaries.forEach(ensureExecutable)
}

const isEntryPoint = fileURLToPath(import.meta.url) === resolve(argv[1])

if (isEntryPoint && platform !== "win32") {
  prepare()
}
