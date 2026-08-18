import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

export const oracleVersion = 1
export const draft07SchemaUri = "http://json-schema.org/draft-07/schema#"
export const undefinedMarker = { $oracle: "undefined" }
export const missingMarker = { $oracle: "missing" }

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Convert values returned by a JavaScript seam into a JSON-safe value without
 * losing the distinction between an omitted property and an explicit
 * `undefined`. Arrays keep their order; object keys are sorted only when the
 * canonical bytes are produced.
 */
export const toOracleValue = (value, seen = new WeakSet()) => {
  if (value === undefined) return undefinedMarker
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { $oracle: "number", value: String(value) }
    if (Object.is(value, -0)) return { $oracle: "number", value: "-0" }
    return value
  }
  if (typeof value === "bigint") return { $oracle: "bigint", value: String(value) }
  if (typeof value === "function") return { $oracle: "function", value: value.name || "anonymous" }
  if (typeof value === "symbol") return { $oracle: "symbol", value: value.description ?? "" }
  if (seen.has(value)) return { $oracle: "cycle" }
  seen.add(value)

  if (value instanceof URL) {
    seen.delete(value)
    return value.toString()
  }

  if (Array.isArray(value)) {
    const result = value.map((entry) => toOracleValue(entry, seen))
    seen.delete(value)
    return result
  }

  if (value instanceof Date) {
    seen.delete(value)
    return { $oracle: "date", value: value.toISOString() }
  }

  const result = {}
  for (const key of Object.keys(value)) result[key] = toOracleValue(value[key], seen)
  seen.delete(value)
  return result
}

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  return value
}

export const canonicalJson = (value) => JSON.stringify(canonicalize(toOracleValue(value)))

export const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonicalJson(value))
    .digest("hex")

export const hashFile = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex")

const escapePointer = (segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")
const pathFor = (path, segment) => (path === "$" ? `$.${escapePointer(segment)}` : `${path}.${escapePointer(segment)}`)
const arrayPathFor = (path, index) => `${path}[${index}]`

const equalCanonical = (left, right) => canonicalJson(left) === canonicalJson(right)

/** Return leaf-level structural differences while preserving array order. */
export const structuralDiff = (before, after, path = "$", differences = []) => {
  const left = toOracleValue(before)
  const right = toOracleValue(after)

  if (equalCanonical(left, right)) return differences

  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
      const hasLeft = index < left.length
      const hasRight = index < right.length
      if (!hasLeft || !hasRight) {
        differences.push({
          after: hasRight ? right[index] : missingMarker,
          before: hasLeft ? left[index] : missingMarker,
          path: arrayPathFor(path, index)
        })
      } else structuralDiff(left[index], right[index], arrayPathFor(path, index), differences)
    }
    return differences
  }

  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const key of keys) {
      const hasLeft = Object.hasOwn(left, key)
      const hasRight = Object.hasOwn(right, key)
      if (!hasLeft || !hasRight) {
        differences.push({
          after: hasRight ? right[key] : missingMarker,
          before: hasLeft ? left[key] : missingMarker,
          path: pathFor(path, key)
        })
      } else structuralDiff(left[key], right[key], pathFor(path, key), differences)
    }
    return differences
  }

  differences.push({ after: right, before: left, path })
  return differences
}

const exactValue = (left, right) => equalCanonical(left, right)

const prefixMatchesPath = (prefix, path) =>
  path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)

export const canonicalDifferenceHash = (differences) =>
  sha256(
    [...differences].sort(
      (left, right) => left.path.localeCompare(right.path) || canonicalJson(left).localeCompare(canonicalJson(right))
    )
  )

const groupsOverlap = (left, right) =>
  prefixMatchesPath(left.prefix, right.prefix) || prefixMatchesPath(right.prefix, left.prefix)

/**
 * Match every reviewed allowlist entry to exactly one observed diff. An entry
 * that no longer matches is stale, and an observed path with no entry is an
 * unclassified contract change.
 */
export const classifyDifferences = (before, after, allowlist = { version: 1, entries: [] }) => {
  const differences = structuralDiff(before, after)
  const entries = allowlist.entries
  const groups = allowlist.groups ?? []
  const duplicatePaths = []
  const seenPaths = new Set()
  for (const entry of entries) {
    if (seenPaths.has(entry.path)) duplicatePaths.push(entry.path)
    seenPaths.add(entry.path)
  }

  const duplicatePrefixes = []
  const seenPrefixes = new Set()
  for (const group of groups) {
    if (seenPrefixes.has(group.prefix)) duplicatePrefixes.push(group.prefix)
    seenPrefixes.add(group.prefix)
  }

  const overlappingGroups = []
  for (let index = 0; index < groups.length; index += 1) {
    const left = groups[index]
    if (left === undefined) continue
    for (let otherIndex = index + 1; otherIndex < groups.length; otherIndex += 1) {
      const right = groups[otherIndex]
      if (right !== undefined && groupsOverlap(left, right)) {
        overlappingGroups.push([left.prefix, right.prefix])
      }
    }
  }

  const overlappingEntries = []
  for (const group of groups) {
    for (const entry of entries) {
      if (prefixMatchesPath(group.prefix, entry.path) || prefixMatchesPath(entry.path, group.prefix)) {
        overlappingEntries.push({ entry: entry.path, prefix: group.prefix })
      }
    }
  }

  const matched = new Set()
  const stale = []
  const invalid = []
  for (const entry of entries) {
    const index = differences.findIndex(
      (difference) =>
        difference.path === entry.path &&
        exactValue(difference.before, entry.before) &&
        exactValue(difference.after, entry.after)
    )
    if (index < 0) stale.push(entry)
    else matched.add(index)
  }

  for (const group of groups) {
    const members = differences.filter(({ path }) => prefixMatchesPath(group.prefix, path))
    if (members.length !== group.count || canonicalDifferenceHash(members) !== group.diffHash) stale.push(group)
    else {
      for (const difference of members) matched.add(differences.indexOf(difference))
    }
  }

  const unclassified = differences.filter((_, index) => !matched.has(index))
  if (duplicatePaths.length > 0) invalid.push({ kind: "duplicate", paths: duplicatePaths })
  if (duplicatePrefixes.length > 0) invalid.push({ kind: "duplicate-group", prefixes: duplicatePrefixes })
  if (overlappingGroups.length > 0) invalid.push({ kind: "overlapping-groups", groups: overlappingGroups })
  if (overlappingEntries.length > 0) invalid.push({ kind: "entry-group-overlap", paths: overlappingEntries })
  return { differences, invalid, stale, unclassified }
}

export const validateAllowlist = (allowlist) => {
  if (!isRecord(allowlist) || allowlist.version !== 1 || !Array.isArray(allowlist.entries)) {
    throw new Error("Oracle allowlist must have version 1 and an entries array")
  }
  for (const entry of allowlist.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      entry.path.length === 0 ||
      !Object.hasOwn(entry, "before") ||
      !Object.hasOwn(entry, "after") ||
      typeof entry.rationale !== "string" ||
      entry.rationale.trim().length === 0 ||
      !Array.isArray(entry.evidence) ||
      entry.evidence.length === 0 ||
      entry.evidence.some((item) => typeof item !== "string" || item.trim().length === 0)
    ) {
      throw new Error(`Oracle allowlist entry is not reviewable: ${JSON.stringify(entry)}`)
    }
  }
  if (allowlist.groups !== undefined && !Array.isArray(allowlist.groups)) {
    throw new Error("Oracle allowlist groups must be an array when provided")
  }
  for (const group of allowlist.groups ?? []) {
    if (
      !isRecord(group) ||
      typeof group.prefix !== "string" ||
      !/^\$\./.test(group.prefix) ||
      group.prefix.endsWith(".") ||
      group.prefix.endsWith("[") ||
      !Number.isInteger(group.count) ||
      group.count <= 0 ||
      typeof group.diffHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(group.diffHash) ||
      typeof group.rationale !== "string" ||
      group.rationale.trim().length === 0 ||
      !Array.isArray(group.evidence) ||
      group.evidence.length === 0 ||
      group.evidence.some((item) => typeof item !== "string" || item.trim().length === 0)
    ) {
      throw new Error(`Oracle allowlist group is not reviewable: ${JSON.stringify(group)}`)
    }
  }
  return allowlist
}

export const assertReviewedParity = (before, after, allowlist) => {
  const result = classifyDifferences(before, after, allowlist)
  if (result.invalid.length > 0 || result.stale.length > 0 || result.unclassified.length > 0) {
    const sections = []
    if (result.invalid.length > 0) sections.push(`invalid allowlist entries: ${JSON.stringify(result.invalid)}`)
    if (result.stale.length > 0) sections.push(`stale allowlist entries: ${JSON.stringify(result.stale)}`)
    if (result.unclassified.length > 0)
      sections.push(`unclassified differences: ${JSON.stringify(result.unclassified)}`)
    throw new Error(`Oracle parity failed; ${sections.join("; ")}`)
  }
  return result
}

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"))

export const readOracle = async (path) => {
  const document = await readJson(path)
  if (!isRecord(document) || document.oracleVersion !== oracleVersion || typeof document.contentHash !== "string") {
    throw new Error(`Invalid oracle envelope at ${path}`)
  }
  const { contentHash, oracleVersion: _oracleVersion, ...content } = document
  const expected = sha256(content)
  if (contentHash !== expected)
    throw new Error(`Oracle hash mismatch at ${path}: expected ${expected}, found ${contentHash}`)
  return document
}

export const writeOracle = async (path, content) => {
  const envelope = { ...toOracleValue(content), contentHash: sha256(content), oracleVersion }
  await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  return envelope
}

export const writeJson = async (path, value) => {
  await writeFile(path, `${JSON.stringify(toOracleValue(value), null, 2)}\n`, { encoding: "utf8" })
}

export const normalizePackageVersion = (value) => {
  if (!isRecord(value)) return value
  const copy = structuredClone(value)
  const normalize = (node, path = "$") => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => normalize(entry, `${path}[${index}]`))
      return
    }
    if (!isRecord(node)) return
    for (const [key, child] of Object.entries(node)) {
      const childPath = pathFor(path, key)
      if (key === "version" && /(^|\.)package|artifacts|serverInfo|dependencies/.test(childPath))
        node[key] = "[package-version]"
      else normalize(child, childPath)
    }
  }
  normalize(copy)
  return copy
}

export const normalizeNondeterministic = (value) => {
  const copy = structuredClone(toOracleValue(value))
  const isCookieTimestampPath = (path) =>
    /^\$\.sdk\.codec\.(?:authenticated|decodeAuthenticated|decodeGuest)\.value\.session\.cookieJar\.cookies\[\d+\]\.(?:creation|lastAccessed)$/.test(
      path
    ) || /^\$\.sdk\.codec\.decodeSession\.value\.cookieJar\.cookies\[\d+\]\.(?:creation|lastAccessed)$/.test(path)

  const normalize = (node, path = "$") => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => normalize(entry, arrayPathFor(path, index)))
      return
    }
    if (!isRecord(node)) return
    for (const [key, child] of Object.entries(node)) {
      const childPath = pathFor(path, key)
      if (childPath === "$.capture.capturedAt" || isCookieTimestampPath(childPath)) {
        node[key] = "[normalized]"
      } else normalize(child, childPath)
    }
  }
  normalize(copy)
  return copy
}

export const strictDraft07 = async () => {
  try {
    const { default: Ajv } = await import("ajv")
    return new Ajv({ allErrors: true, strict: true, validateSchema: true })
  } catch (error) {
    throw new Error(
      `Strict Draft-07 validation requires ajv: ${error instanceof Error ? error.message : "load failed"}`
    )
  }
}

export const validateDraft07 = async (schemas) => {
  const errors = []
  for (const [name, schema] of Object.entries(schemas)) {
    try {
      if (!isRecord(schema)) throw new Error("schema must be a JSON object")
      const ajv = await strictDraft07()
      const normalized = schema.$schema === undefined ? { $schema: draft07SchemaUri, ...schema } : schema
      ajv.compile(normalized)
    } catch (error) {
      errors.push({ error: error instanceof Error ? error.message : String(error), name })
    }
  }
  if (errors.length > 0) throw new Error(`Draft-07 schema validation failed: ${JSON.stringify(errors)}`)
}
