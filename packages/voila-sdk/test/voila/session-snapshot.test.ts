import { Either } from "effect"
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

const sampleCsrf = {
  token: secretCsrfToken
}

const minimalCookieJarSnapshot = {
  cookies: [],
  rejectPublicSuffixes: true,
  storeType: null,
  version: "tough-cookie@6.0.0"
}

const cookieJarSnapshotWithoutCookies = {
  rejectPublicSuffixes: true,
  storeType: null,
  version: "tough-cookie@6.0.0"
}

const cookieJarSnapshotWithoutRejectPublicSuffixes = {
  cookies: [],
  storeType: null,
  version: "tough-cookie@6.0.0"
}

const missingRequiredFieldSnapshots = [
  {
    csrf: sampleCsrf,
    metadata: sampleMetadata
  },
  {
    cookieJar: minimalCookieJarSnapshot,
    metadata: sampleMetadata
  },
  {
    cookieJar: minimalCookieJarSnapshot,
    csrf: sampleCsrf
  },
  {
    cookieJar: cookieJarSnapshotWithoutCookies,
    csrf: sampleCsrf,
    metadata: sampleMetadata
  },
  {
    cookieJar: cookieJarSnapshotWithoutRejectPublicSuffixes,
    csrf: sampleCsrf,
    metadata: sampleMetadata
  }
]

const unsupportedSerializableCookieJar = {
  serializeSync: () => undefined
}

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

    expect(Either.isRight(serialized)).toBe(true)

    if (Either.isRight(serialized)) {
      const deserialized = toughCookieJarPort.deserialize(serialized.right)

      expect(Either.isRight(deserialized)).toBe(true)

      if (Either.isRight(deserialized)) {
        expect(deserialized.right.getCookieStringSync(voilaUrl)).toBe(`voila-session=${secretCookieValue}`)
      }
    }
  })

  it("preserves tough-cookie serialized metadata across a jar round-trip", () => {
    const serialized = toughCookieJarPort.serialize(makeConfiguredCookieJar())

    expect(Either.isRight(serialized)).toBe(true)

    if (Either.isRight(serialized)) {
      const deserialized = toughCookieJarPort.deserialize(serialized.right)

      expect(Either.isRight(deserialized)).toBe(true)

      if (Either.isRight(deserialized)) {
        const reserialized = toughCookieJarPort.serialize(deserialized.right)

        expect(Either.isRight(reserialized)).toBe(true)

        if (Either.isRight(reserialized)) {
          expect(reserialized.right.allowSpecialUseDomain).toBe(true)
          expect(reserialized.right.enableLooseMode).toBe(true)
          expect(reserialized.right.prefixSecurity).toBe(PrefixSecurityEnum.DISABLED)
          expect(reserialized.right.rejectPublicSuffixes).toBe(false)
        }
      }
    }
  })

  it("builds schema-owned session snapshots", () => {
    const serialized = serializeCookieJar(makeCookieJarWithSecret())

    expect(Either.isRight(serialized)).toBe(true)

    if (Either.isRight(serialized)) {
      const snapshot = makeSessionSnapshot(sampleMetadata, sampleCsrf, serialized.right)

      expect(Either.isRight(snapshot)).toBe(true)
    }
  })

  it("rejects missing required session snapshot fields", () => {
    for (const malformedSnapshot of missingRequiredFieldSnapshots) {
      assertDecodeFailure(SessionSnapshotSchema, malformedSnapshot)
    }
  })

  it("returns a typed error for throwing cookie jar serialization", () => {
    const result = serializeCookieJar(throwingSerializableCookieJar)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result) && result.left._tag === "CookieJarSerializationFailed") {
      expect(result.left._tag).toBe("CookieJarSerializationFailed")
      expect(result.left.message).toBe("Cookie jar serialization failed")
      expect(JSON.stringify(result.left)).not.toContain(secretCookieValue)
    }
  })

  it("redacts non-error thrown values from cookie jar serialization failures", () => {
    const result = serializeCookieJar(throwingNonErrorSerializableCookieJar)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result) && result.left._tag === "CookieJarSerializationFailed") {
      expect(result.left.message).toBe("Cookie jar serialization failed")
      expect(JSON.stringify(result.left)).not.toContain("secret thrown payload")
    }
  })

  it("returns a typed error for unsupported cookie jar serialization", () => {
    const result = serializeCookieJar(unsupportedSerializableCookieJar)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CookieJarSerializationUnsupported")
    }
  })

  it("returns a typed error for malformed serialized cookie jars", () => {
    const result = serializeCookieJar(malformedSerializableCookieJar)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CookieJarSnapshotSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("not-boolean")
    }
  })

  it("returns a typed error when a cookie jar snapshot cannot be imported", () => {
    const result = deserializeCookieJar(jsonUnsafeCookieJarSnapshot)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result) && result.left._tag === "CookieJarSnapshotImportFailed") {
      expect(result.left._tag).toBe("CookieJarSnapshotImportFailed")
      expect(result.left.message).toBe("Cookie jar snapshot import failed")
      expect(JSON.stringify(result.left)).not.toContain("unsupported")
    }
  })

  it("returns a typed error for malformed session snapshots", () => {
    const result = decodeSessionSnapshot({
      csrf: sampleCsrf,
      metadata: sampleMetadata
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SessionSnapshotSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain(secretCsrfToken)
    }
  })

  it("keeps secret-bearing fields out of diagnostic strings", () => {
    const serialized = serializeCookieJar(makeCookieJarWithSecret())

    expect(Either.isRight(serialized)).toBe(true)

    if (Either.isRight(serialized)) {
      const snapshot = makeSessionSnapshot(sampleMetadata, sampleCsrf, serialized.right)

      expect(Either.isRight(snapshot)).toBe(true)

      if (Either.isRight(snapshot)) {
        const diagnostic = formatSessionSnapshotDiagnostic(snapshot.right)

        expect(diagnostic).not.toContain(secretCookieValue)
        expect(diagnostic).not.toContain(secretCsrfToken)
        expect(diagnostic).not.toContain(secretClientRouteId)
        expect(diagnostic).not.toContain(secretPageViewId)
        expect(diagnostic).toContain("[redacted]")
      }
    }
  })
})
