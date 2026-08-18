import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { cleanPackageDist, resolvePackageDist } from "./clean-package-dist.mjs"

describe("package dist cleanup", () => {
  test("resolves only known package dist directories", () => {
    expect(resolvePackageDist(join(process.cwd(), "packages", "voila-mcp"))).toBe(
      join(process.cwd(), "packages", "voila-mcp", "dist")
    )
    expect(() => resolvePackageDist(process.cwd())).toThrow("outside a workspace package")
  })

  test("removes nested dist output idempotently and preserves siblings", async () => {
    const root = await mkdtemp(join(tmpdir(), "voila-clean-dist-"))
    const packageDirectory = join(root, "package")
    const siblingDirectory = join(root, "sibling")
    const nestedOutput = join(packageDirectory, "dist", "nested")
    try {
      await mkdir(nestedOutput, { recursive: true })
      await mkdir(siblingDirectory)
      await writeFile(join(nestedOutput, "stale.js"), "stale")
      await writeFile(join(packageDirectory, "keep.txt"), "keep")
      await writeFile(join(siblingDirectory, "keep.txt"), "keep")

      await cleanPackageDist(packageDirectory, [packageDirectory])
      await cleanPackageDist(packageDirectory, [packageDirectory])

      await expect(access(join(packageDirectory, "dist"))).rejects.toThrow()
      await expect(access(join(packageDirectory, "keep.txt"))).resolves.toBeUndefined()
      await expect(access(join(siblingDirectory, "keep.txt"))).resolves.toBeUndefined()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
