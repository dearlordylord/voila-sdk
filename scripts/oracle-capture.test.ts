import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

import { assertCaptureEnvironment, capture } from "./oracle-capture.mjs"
import { readOracle } from "./oracle-core.mjs"

const readContentHash = async (path: string): Promise<string> => {
  const envelope = await readOracle(path)
  if (typeof envelope !== "object" || envelope === null || !("contentHash" in envelope)) {
    throw new Error(`Expected a hashed oracle envelope at ${path}`)
  }
  if (typeof envelope.contentHash !== "string") {
    throw new Error(`Expected a string oracle content hash at ${path}`)
  }
  return envelope.contentHash
}

test("refuses an existing output before any capture work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "voila-oracle-capture-"))
  const path = join(directory, "baseline.json")
  await writeFile(path, "immutable\n", "utf8")
  await expect(capture(path)).rejects.toThrow("Refusing to overwrite immutable oracle")
})

test("rejects the post-cutover workspace as an Effect 3 capture source", async () => {
  await expect(assertCaptureEnvironment()).rejects.toThrow("Immutable oracle capture guard failed")
})

test("keeps the original and supplemental envelopes independently immutable", async () => {
  const originalPath = "docs/migrations/effect-4/oracle/baseline.json"
  const supplementalPath = "docs/migrations/effect-4/oracle/baseline-v2.json"
  const originalHash = await readContentHash(originalPath)
  const supplementalHash = await readContentHash(supplementalPath)

  expect(originalHash).toBe("26d53bbd2414fb084cbf8c8dcbfaae4707fd80d2e0964d82661560a9b6f8ab5a")
  expect(supplementalHash).toBe("08b728419ce5eafe0a671e8bebeccf8ae22c78ecd7c724c3d37fa96858dbc137")
  await expect(capture(supplementalPath, { supplemental: true })).rejects.toThrow(
    "Refusing to overwrite immutable oracle"
  )
})
