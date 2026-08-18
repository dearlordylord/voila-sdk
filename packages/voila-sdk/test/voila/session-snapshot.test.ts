import { Result } from "effect"
import { CookieJar, PrefixSecurityEnum } from "tough-cookie"
import { describe, expect, it } from "vitest"

import { SessionSnapshotSchema } from "../../src/domain/schemas/index.js"
import {
  decodeSessionSnapshot,
  deserializeCookieJar,
  formatSessionSnapshotDiagnostic,
  makeSessionSnapshot,
  serializeCookieJar,
  toughCookieJarPort
} from "../../src/voila/session-snapshot.js"
import { assertDecodeFailure } from "../helpers/property.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "secret-cookie-value"
const secretCsrfToken = "secret-csrf-token"
const secretClientRouteId = "secret-client-route-id"
const secretPageViewId = "secret-page-view-id"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: secretClientRouteId,
  pageViewId: secretPageViewId,
  regionId: "region-id"
}

const sampleCsrf = { token: secretCsrfToken }

const minimalCookieJarSnapshot = {
  cookies: [],
  rejectPublicSuffixes: true,
  storeType: null,
  version: "tough-cookie@6.0.0"
}

const cookieJarSnapshotWithoutCookies = { rejectPublicSuffixes: true, storeType: null, version: "tough-cookie@6.0.0" }

const cookieJarSnapshotWithoutRejectPublicSuffixes = { cookies: [], storeType: null, version: "tough-cookie@6.0.0" }

const missingRequiredFieldSnapshots = [
  { csrf: sampleCsrf, metadata: sampleMetadata },
  { cookieJar: minimalCookieJarSnapshot, metadata: sampleMetadata },
  { cookieJar: minimalCookieJarSnapshot, csrf: sampleCsrf },
  { cookieJar: cookieJarSnapshotWithoutCookies, csrf: sampleCsrf, metadata: sampleMetadata },
  { cookieJar: cookieJarSnapshotWithoutRejectPublicSuffixes, csrf: sampleCsrf, metadata: sampleMetadata }
]

const unsupportedSerializableCookieJar = { serializeSync: () => undefined }

const malformedSerializableCookieJar = {
  serializeSync: () => ({
    cookies: [],
    rejectPublicSuffixes: "not-boolean",
    storeType: null,
    version: "tough-cookie@6.0.0"
  })
}

const throwingSerializableCookieJar = {
  serializeSync: () => {
    throw new Error(`serializer exploded with ${secretCookieValue}`)
  }
}

const throwingNonErrorSerializableCookieJar = {
  serializeSync: () => {
    throw "secret thrown payload"
  }
}

const jsonUnsafeCookieJarSnapshot = {
  cookies: [],
  rejectPublicSuffixes: true,
  storeType: null,
  unsupported: BigInt("1"),
  version: "tough-cookie@6.0.0"
}

const makeCookieJarWithSecret = (): CookieJar => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)

  return jar
}

const makeConfiguredCookieJar = (): CookieJar => {
  const jar = new CookieJar(undefined, {
    allowSpecialUseDomain: true,
    looseMode: true,
    prefixSecurity: PrefixSecurityEnum.DISABLED,
    rejectPublicSuffixes: false
  })
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)

  return jar
}

describe("session snapshots", () => {
  it("serializes and deserializes a tough-cookie jar", () => {
    const serialized = toughCookieJarPort.serialize(makeCookieJarWithSecret())

    expect(Result.isSuccess(serialized)).toBe(true)

    if (Result.isSuccess(serialized)) {
      const deserialized = toughCookieJarPort.deserialize(serialized.success)

      expect(Result.isSuccess(deserialized)).toBe(true)

      if (Result.isSuccess(deserialized)) {
        expect(deserialized.success.getCookieStringSync(voilaUrl)).toBe(`voila-session=${secretCookieValue}`)
      }
    }
  })

  it("preserves tough-cookie serialized metadata across a jar round-trip", () => {
    const serialized = toughCookieJarPort.serialize(makeConfiguredCookieJar())

    expect(Result.isSuccess(serialized)).toBe(true)

    if (Result.isSuccess(serialized)) {
      const deserialized = toughCookieJarPort.deserialize(serialized.success)

      expect(Result.isSuccess(deserialized)).toBe(true)

      if (Result.isSuccess(deserialized)) {
        const reserialized = toughCookieJarPort.serialize(deserialized.success)

        expect(Result.isSuccess(reserialized)).toBe(true)

        if (Result.isSuccess(reserialized)) {
          expect(reserialized.success.allowSpecialUseDomain).toBe(true)
          expect(reserialized.success.enableLooseMode).toBe(true)
          expect(reserialized.success.prefixSecurity).toBe(PrefixSecurityEnum.DISABLED)
          expect(reserialized.success.rejectPublicSuffixes).toBe(false)
        }
      }
    }
  })

  it("builds schema-owned session snapshots", () => {
    const serialized = serializeCookieJar(makeCookieJarWithSecret())

    expect(Result.isSuccess(serialized)).toBe(true)

    if (Result.isSuccess(serialized)) {
      const snapshot = makeSessionSnapshot(sampleMetadata, sampleCsrf, serialized.success)

      expect(Result.isSuccess(snapshot)).toBe(true)
    }
  })

  it("rejects missing required session snapshot fields", () => {
    for (const malformedSnapshot of missingRequiredFieldSnapshots) {
      assertDecodeFailure(SessionSnapshotSchema, malformedSnapshot)
    }
  })

  it("returns a typed error for throwing cookie jar serialization", () => {
    const result = serializeCookieJar(throwingSerializableCookieJar)

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result) && result.failure._tag === "CookieJarSerializationFailed") {
      expect(result.failure._tag).toBe("CookieJarSerializationFailed")
      expect(result.failure.message).toBe("Cookie jar serialization failed")
      expect(JSON.stringify(result.failure)).not.toContain(secretCookieValue)
    }
  })

  it("redacts non-error thrown values from cookie jar serialization failures", () => {
    const result = serializeCookieJar(throwingNonErrorSerializableCookieJar)

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result) && result.failure._tag === "CookieJarSerializationFailed") {
      expect(result.failure.message).toBe("Cookie jar serialization failed")
      expect(JSON.stringify(result.failure)).not.toContain("secret thrown payload")
    }
  })

  it("returns a typed error for unsupported cookie jar serialization", () => {
    const result = serializeCookieJar(unsupportedSerializableCookieJar)

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CookieJarSerializationUnsupported")
    }
  })

  it("returns a typed error for malformed serialized cookie jars", () => {
    const result = serializeCookieJar(malformedSerializableCookieJar)

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CookieJarSnapshotSchemaMismatch")
      expect(JSON.stringify(result.failure)).not.toContain("not-boolean")
    }
  })

  it("returns a typed error when a cookie jar snapshot cannot be imported", () => {
    const result = deserializeCookieJar(jsonUnsafeCookieJarSnapshot)

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result) && result.failure._tag === "CookieJarSnapshotImportFailed") {
      expect(result.failure._tag).toBe("CookieJarSnapshotImportFailed")
      expect(result.failure.message).toBe("Cookie jar snapshot import failed")
      expect(JSON.stringify(result.failure)).not.toContain("unsupported")
    }
  })

  it("returns a typed error for malformed session snapshots", () => {
    const result = decodeSessionSnapshot({ csrf: sampleCsrf, metadata: sampleMetadata })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("SessionSnapshotSchemaMismatch")
      expect(JSON.stringify(result.failure)).not.toContain(secretCsrfToken)
    }
  })

  it("keeps secret-bearing fields out of diagnostic strings", () => {
    const serialized = serializeCookieJar(makeCookieJarWithSecret())

    expect(Result.isSuccess(serialized)).toBe(true)

    if (Result.isSuccess(serialized)) {
      const snapshot = makeSessionSnapshot(sampleMetadata, sampleCsrf, serialized.success)

      expect(Result.isSuccess(snapshot)).toBe(true)

      if (Result.isSuccess(snapshot)) {
        const diagnostic = formatSessionSnapshotDiagnostic(snapshot.success)

        expect(diagnostic).not.toContain(secretCookieValue)
        expect(diagnostic).not.toContain(secretCsrfToken)
        expect(diagnostic).not.toContain(secretClientRouteId)
        expect(diagnostic).not.toContain(secretPageViewId)
        expect(diagnostic).toContain("[redacted]")
      }
    }
  })

  it("states no route id in a diagnostic for a session captured without one", () => {
    const serialized = serializeCookieJar(makeCookieJarWithSecret())

    if (Result.isFailure(serialized)) {
      throw new Error("Expected cookie jar serialization to succeed")
    }

    const snapshot = makeSessionSnapshot(
      { assetVersion: "asset-version", pageViewId: secretPageViewId, regionId: "region-id" },
      sampleCsrf,
      serialized.success
    )

    if (Result.isFailure(snapshot)) {
      throw new Error("Expected session snapshot creation to succeed")
    }

    const diagnostic = formatSessionSnapshotDiagnostic(snapshot.success)

    expect(diagnostic).not.toContain("clientRouteId")
    expect(diagnostic).not.toContain(secretPageViewId)
  })
})
