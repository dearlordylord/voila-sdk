import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const fixtureDirectory = process.argv[2] ?? "test/fixtures"
const sensitiveKeyTerms = ["cookie", "csrf", "token", "password", "payment", "card", "customer", "account", "address", "street", "postal", "phone", "email", "visitor", "session", "auth", "authorization"]
const sensitiveIdentifierKeyPattern = /(?:destination|checkout|order|cart|basket).*(?:id|identifier)$|(?:id|identifier).*(?:destination|checkout|order|cart|basket)/i
const allowedSensitiveKeys = new Set(["csrf", "session", "customerAccountId", "addressId", "deliveryDestinationId", "destinationId", "deliveryInstructions", "formattedAddress", "resolvedRegionId", "regionId", "pageViewId", "clientRouteId", "assetVersion", "nextPageToken", "token", "basketId", "draftBasketId", "cartId", "cartPropositionId", "checkoutCorrelationId", "orderId"])
const sanitizedValuePattern = /\bsanitized[-_\w]*\b/i
const rawValuePatterns = [
  /(?:^|[;\s])(?:cookie|set-cookie)\s*[:=]/i,
  /\bcsrf[-_ ]?token\b(?![^"]*sanitized)/i,
  /\b(?:visa|mastercard|amex|cvv|card number|payment method)\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/i,
  /\b\d+\s+[A-Za-z0-9.'-]+\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct)\b/i
]

const listFixtureFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      return listFixtureFiles(entryPath)
    }

    if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".html"))) {
      return [entryPath]
    }

    return []
  })

const fixtureFiles = listFixtureFiles(fixtureDirectory)

const errors = []

const isSensitiveKey = (key) => {
  const normalizedKey = key.toLowerCase()

  return isAllowedSensitiveKey(key) || sensitiveIdentifierKeyPattern.test(key) || sensitiveKeyTerms.some((term) => normalizedKey.includes(term))
}

const isAllowedSensitiveKey = (key) => allowedSensitiveKeys.has(key)

const isSanitizedValue = (value) => sanitizedValuePattern.test(value)

const hasOwnProperty = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

const isCookieEntryShape = (value) =>
  typeof value === "object" &&
  value !== null &&
  hasOwnProperty(value, "key") &&
  hasOwnProperty(value, "value") &&
  (hasOwnProperty(value, "domain") || hasOwnProperty(value, "path"))

const inspectValue = (filePath, path, value) => {
  if (typeof value !== "string") {
    return
  }

  for (const pattern of rawValuePatterns) {
    if (pattern.test(value) && !isSanitizedValue(value)) {
      errors.push(`${filePath}: ${path} contains raw-looking sensitive value`)
    }
  }
}

const inspectJson = (filePath, value, path = "$") => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectJson(filePath, item, `${path}[${String(index)}]`))
    return
  }

  if (value === null || typeof value !== "object") {
    inspectValue(filePath, path, value)
    return
  }

  if (isCookieEntryShape(value)) {
    errors.push(`${filePath}: ${path} contains a cookie-entry-like object`)
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    const sensitiveKey = isSensitiveKey(key)

    if (sensitiveKey && !isAllowedSensitiveKey(key)) {
      errors.push(`${filePath}: ${childPath} uses sensitive key "${key}"`)
    }

    if (sensitiveKey && typeof child === "string" && !isSanitizedValue(child)) {
      errors.push(`${filePath}: ${childPath} must contain a sanitized placeholder value`)
    }

    if (sensitiveKey && child !== null && typeof child !== "object" && typeof child !== "string") {
      errors.push(`${filePath}: ${childPath} must use a sanitized string placeholder value`)
    }

    inspectJson(filePath, child, childPath)
  }
}

const inspectRawText = (filePath, text) => {
  for (const objectMatch of text.matchAll(/\{[^{}]*\}/gs)) {
    const objectText = objectMatch[0]
    const fixtureLine = text.slice(0, objectMatch.index).split("\n").length

    if (
      /"key"\s*:/.test(objectText) &&
      /"value"\s*:/.test(objectText) &&
      (/"domain"\s*:/.test(objectText) || /"path"\s*:/.test(objectText))
    ) {
      errors.push(`${filePath}:${String(fixtureLine)} contains a cookie-entry-like object`)
    }
  }

  for (const stringFieldMatch of text.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/gs)) {
    const [, key, value] = stringFieldMatch
    const fixtureLine = text.slice(0, stringFieldMatch.index).split("\n").length

    if (key !== undefined && value !== undefined && isSensitiveKey(key) && !isSanitizedValue(value)) {
      errors.push(`${filePath}:${String(fixtureLine)} field "${key}" must contain a sanitized placeholder value`)
    }
  }

  for (const primitiveFieldMatch of text.matchAll(/"([^"]+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)\b/gs)) {
    const [, key] = primitiveFieldMatch
    const fixtureLine = text.slice(0, primitiveFieldMatch.index).split("\n").length

    if (key !== undefined && isSensitiveKey(key)) {
      errors.push(`${filePath}:${String(fixtureLine)} field "${key}" must use a sanitized string placeholder value`)
    }
  }

  text.split("\n").forEach((line, index) => {
    const fixtureLine = index + 1

    for (const keyMatch of line.matchAll(/"([^"]+)"\s*:/g)) {
      const [, key] = keyMatch

      if (key !== undefined && isSensitiveKey(key) && !isAllowedSensitiveKey(key)) {
        errors.push(`${filePath}:${String(fixtureLine)} uses sensitive key "${key}"`)
      }
    }

    for (const pattern of rawValuePatterns) {
      if (pattern.test(line) && !isSanitizedValue(line)) {
        errors.push(`${filePath}:${String(fixtureLine)} contains raw-looking sensitive text`)
      }
    }
  })
}

for (const filePath of fixtureFiles) {
  const text = readFileSync(filePath, "utf8")
  inspectRawText(filePath, text)

  if (filePath.endsWith(".json")) {
    inspectJson(filePath, JSON.parse(text))
  }
}

if (errors.length > 0) {
  throw new Error(`Fixture audit failed:\n${errors.join("\n")}`)
}

console.log(`Fixture audit passed for ${String(fixtureFiles.length)} files`)
