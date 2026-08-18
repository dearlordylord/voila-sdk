import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

import { artifactManifest, assertFreshBuiltArtifacts } from "./oracle-artifacts.mjs"

test("records missing source maps explicitly in bundle composition", async () => {
  const root = await mkdtemp(join(tmpdir(), "voila-oracle-artifacts-"))
  try {
    for (const name of ["voila-mcp", "voila-cli", "voila-sdk"]) {
      const packageRoot = join(root, "packages", name)
      await mkdir(join(packageRoot, "src"), { recursive: true })
      await mkdir(join(packageRoot, "dist"), { recursive: true })
      await writeFile(join(packageRoot, "src/index.ts"), "export {}\n", "utf8")
      await writeFile(join(packageRoot, "dist/index.cjs"), "module.exports = {}\n", "utf8")
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({ name: `@firfi/${name}`, version: "0.0.0" }),
        "utf8"
      )
    }

    const artifact = (await artifactManifest(root)).at(0)
    if (artifact === undefined) throw new Error("Expected an artifact manifest entry")
    expect(artifact.bundleComposition["dist/index.cjs"]).toEqual({
      reason: "source-map-not-emitted",
      status: "unavailable"
    })
    expect(artifact.bundleCompositionStatus["dist/index.cjs"]).toEqual({
      reason: "source-map-not-emitted",
      status: "unavailable"
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("rejects a dist tree older than its source tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "voila-oracle-freshness-"))
  try {
    const now = 1_700_000_000
    for (const name of ["voila-mcp", "voila-cli", "voila-sdk"]) {
      const packageRoot = join(root, "packages", name)
      await mkdir(join(packageRoot, "src"), { recursive: true })
      await mkdir(join(packageRoot, "dist"), { recursive: true })
      const source = join(packageRoot, "src/index.ts")
      const output = join(packageRoot, "dist/index.js")
      await writeFile(source, "export {}\n", "utf8")
      await writeFile(output, "module.exports = {}\n", "utf8")
      await utimes(source, now, now)
      await utimes(output, now + 2, now + 2)
    }
    await expect(assertFreshBuiltArtifacts(root)).resolves.toBe(true)
    await utimes(join(root, "packages/voila-sdk/src/index.ts"), now + 4, now + 4)
    await expect(assertFreshBuiltArtifacts(root)).rejects.toThrow("Fresh built-artifact guard failed")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
