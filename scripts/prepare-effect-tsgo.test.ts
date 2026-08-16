import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

// @ts-expect-error The effect-tsgo preparation helper is an executable JavaScript module.
import { ensureExecutable, installedNativeBinaries } from "./prepare-effect-tsgo.mjs"

const nativeBinaryFixture = async (mode: number) => {
  const directory = await mkdtemp(join(tmpdir(), "prepare-effect-tsgo-"))
  const executablePath = join(directory, "tsc")
  await writeFile(executablePath, "binary", { mode })

  return executablePath
}

const modeOf = async (path: string) => (await stat(path)).mode & 0o777

test("adds the missing executable bit to a published native binary", async () => {
  const executablePath = await nativeBinaryFixture(0o644)

  expect(ensureExecutable(executablePath)).toBe(true)
  expect(await modeOf(executablePath)).toBe(0o755)
})

test("leaves an already executable binary untouched", async () => {
  const executablePath = await nativeBinaryFixture(0o700)

  expect(ensureExecutable(executablePath)).toBe(false)
  expect(await modeOf(executablePath)).toBe(0o700)
})

const virtualStoreFixture = async (packageNames: ReadonlyArray<string>) => {
  const workspace = await mkdtemp(join(tmpdir(), "prepare-effect-tsgo-store-"))

  for (const name of packageNames) {
    const library = join(
      workspace,
      "node_modules",
      ".pnpm",
      `@effect+${name}@0.24.3`,
      "node_modules",
      "@effect",
      name,
      "lib"
    )
    await mkdir(library, { recursive: true })
    await writeFile(join(library, "tsc"), "binary", { mode: 0o644 })
    await writeFile(join(library, "tsc-next"), "binary", { mode: 0o644 })
    await writeFile(join(library, "tsc.json"), "{}", { mode: 0o644 })
  }

  return workspace
}

test("finds native binaries for every installed platform, not just this machine's", async () => {
  const workspace = await virtualStoreFixture(["tsgo-darwin-arm64", "tsgo-linux-x64"])

  const binaries: ReadonlyArray<string> = installedNativeBinaries(workspace)

  expect(binaries.filter((path) => path.includes("linux-x64"))).toHaveLength(2)
  expect(binaries.filter((path) => path.includes("darwin-arm64"))).toHaveLength(2)
  // the sibling JSON manifests are not binaries
  expect(binaries.every((path) => !path.endsWith(".json"))).toBe(true)
})

test("reports no binaries when the workspace has no virtual store", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "prepare-effect-tsgo-empty-"))

  expect(installedNativeBinaries(workspace)).toEqual([])
})
