import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "vitest"

import {
  assertReviewedParity,
  canonicalJson,
  canonicalDifferenceHash,
  classifyDifferences,
  normalizeNondeterministic,
  readOracle,
  structuralDiff,
  toOracleValue,
  validateAllowlist,
  validateDraft07,
  writeOracle
} from "./oracle-core.mjs"

describe("oracle core", () => {
  test("canonical bytes sort object keys but retain array order and undefined", () => {
    expect(canonicalJson({ b: 2, a: [undefined, 1] })).toBe('{"a":[{"$oracle":"undefined"},1],"b":2}')
    expect(toOracleValue(new URL("https://voila.ca/path"))).toBe("https://voila.ca/path")
  })

  test("reports structural paths for array movement without sorting the array", () => {
    expect(structuralDiff({ items: ["old", "same"] }, { items: ["new", "same", "added"] })).toEqual([
      { after: "new", before: "old", path: "$.items[0]" },
      { after: "added", before: { $oracle: "missing" }, path: "$.items[2]" }
    ])
  })

  test("rejects stale and duplicate reviewed allowlist entries", () => {
    const firstEntry = { after: "new", before: "old", path: "$.value", rationale: "reviewed" }
    const allowlist = {
      version: 1,
      entries: [firstEntry, { after: "new", before: "old", path: "$.value", rationale: "duplicate" }]
    }
    const classified = classifyDifferences({ value: "old" }, { value: "new" }, allowlist)
    expect(classified.invalid).toEqual([{ kind: "duplicate", paths: ["$.value"] }])
    expect(() => assertReviewedParity({ value: "old" }, { value: "new" }, allowlist)).toThrow("invalid allowlist")
    expect(
      classifyDifferences({ value: "old" }, { value: "same" }, { version: 1, entries: [firstEntry] }).stale
    ).toHaveLength(1)
  })

  test("matches a reviewed prefix group by count and canonical diff hash", () => {
    const before = { artifact: { files: [{ size: 1 }, { size: 2 }] } }
    const after = { artifact: { files: [{ size: 3 }, { size: 4 }] } }
    const differences = structuralDiff(before, after)
    const members = differences.filter((difference) => difference.path.startsWith("$.artifact.files"))
    const group = {
      count: members.length,
      diffHash: canonicalDifferenceHash(members),
      evidence: ["https://github.com/dearlordylord/voila-sdk/issues/19"],
      prefix: "$.artifact.files",
      rationale: "The reviewed group covers only the generated artifact leaves."
    }
    const result = assertReviewedParity(before, after, { version: 1, entries: [], groups: [group] })
    expect(result.unclassified).toHaveLength(0)
    expect(result.stale).toHaveLength(0)
  })

  test("rejects stale, duplicate, and overlapping prefix groups", () => {
    const before = { artifact: { files: [{ size: 1 }, { size: 2 }] } }
    const after = { artifact: { files: [{ size: 3 }, { size: 4 }] } }
    const differences = structuralDiff(before, after)
    const all = differences.filter((difference) => difference.path.startsWith("$.artifact.files"))
    const first = all.filter((difference) => difference.path.startsWith("$.artifact.files[0]"))
    const makeGroup = (prefix: string, members: typeof all) => ({
      count: members.length,
      diffHash: canonicalDifferenceHash(members),
      evidence: ["https://github.com/dearlordylord/voila-sdk/issues/19"],
      prefix,
      rationale: "Reviewed generated artifact differences."
    })
    const group = makeGroup("$.artifact.files", all)
    const stale = { ...group, diffHash: "0".repeat(64) }
    expect(classifyDifferences(before, after, { version: 1, entries: [], groups: [stale] }).stale).toHaveLength(1)

    const duplicate = classifyDifferences(before, after, { version: 1, entries: [], groups: [group, group] })
    expect(duplicate.invalid).toContainEqual({ kind: "duplicate-group", prefixes: [group.prefix] })

    const overlap = classifyDifferences(before, after, {
      version: 1,
      entries: [],
      groups: [group, makeGroup("$.artifact.files[0]", first)]
    })
    expect(overlap.invalid).toContainEqual({
      groups: [["$.artifact.files", "$.artifact.files[0]"]],
      kind: "overlapping-groups"
    })
  })

  test("rejects an exact entry that overlaps a prefix group", () => {
    const before = { artifact: { files: [{ size: 1 }] } }
    const after = { artifact: { files: [{ size: 2 }] } }
    const difference = structuralDiff(before, after).at(0)
    if (difference === undefined) throw new Error("Expected an artifact difference")
    const group = {
      count: 1,
      diffHash: canonicalDifferenceHash([difference]),
      evidence: ["https://github.com/dearlordylord/voila-sdk/issues/19"],
      prefix: "$.artifact.files",
      rationale: "Reviewed generated artifact differences."
    }
    const entry = {
      after: difference.after,
      before: difference.before,
      evidence: ["https://github.com/dearlordylord/voila-sdk/issues/19"],
      path: difference.path,
      rationale: "An exact entry intentionally overlaps."
    }
    expect(
      classifyDifferences(before, after, { version: 1, entries: [entry], groups: [group] }).invalid
    ).toContainEqual({ kind: "entry-group-overlap", paths: [{ entry: difference.path, prefix: group.prefix }] })
  })

  test("strictly validates Draft-07 schemas", async () => {
    await expect(
      validateDraft07({
        sample: { type: "object", properties: { value: { type: "string" } }, additionalProperties: false }
      })
    ).resolves.toBeUndefined()
    await expect(validateDraft07({ invalid: { type: "not-a-draft-07-type" } })).rejects.toThrow("Draft-07")
  })

  test("requires evidence and rationale for every reviewed exception", () => {
    expect(validateAllowlist({ version: 1, entries: [] })).toEqual({ version: 1, entries: [] })
    expect(() => validateAllowlist({ version: 1, entries: [{ after: 1, before: 0, path: "$.value" }] })).toThrow(
      "evidence"
    )
    expect(() =>
      validateAllowlist({
        version: 1,
        entries: [],
        groups: [{ count: 1, diffHash: "bad", prefix: "$.value", rationale: "missing evidence" }]
      })
    ).toThrow("diffHash")
  })

  test("fails closed on an unclassified difference", () => {
    expect(() => assertReviewedParity({ value: "before" }, { value: "after" }, { version: 1, entries: [] })).toThrow(
      "unclassified differences"
    )
  })

  test("normalizes only the capture marker and SDK cookie timestamps", () => {
    const normalized = normalizeNondeterministic({
      capture: { capturedAt: "volatile" },
      generatedAt: "keep",
      sdk: {
        codec: {
          authenticated: {
            value: { session: { cookieJar: { cookies: [{ creation: "volatile", lastAccessed: "volatile" }] } } }
          },
          other: { value: { cookieJar: { cookies: [{ creation: "keep", lastAccessed: "keep" }] } } }
        }
      }
    })
    expect(normalized).toMatchObject({
      capture: { capturedAt: "[normalized]" },
      generatedAt: "keep",
      sdk: {
        codec: {
          authenticated: {
            value: { session: { cookieJar: { cookies: [{ creation: "[normalized]", lastAccessed: "[normalized]" }] } } }
          },
          other: { value: { cookieJar: { cookies: [{ creation: "keep", lastAccessed: "keep" }] } } }
        }
      }
    })
  })

  test("detects tampering and refuses an immutable overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voila-oracle-"))
    const path = join(directory, "baseline.json")
    await writeOracle(path, { value: "before" })
    await expect(writeOracle(path, { value: "after" })).rejects.toMatchObject({ code: "EEXIST" })
    const envelope = JSON.parse(await readFile(path, "utf8"))
    envelope.value = "tampered"
    await writeFile(path, `${JSON.stringify(envelope)}\n`, "utf8")
    await expect(readOracle(path)).rejects.toThrow("Oracle hash mismatch")
  })
})
