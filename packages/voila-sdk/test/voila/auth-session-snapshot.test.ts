import { Result } from "effect"
import { describe, expect, it } from "vitest"

import { SdkSessionSnapshotDiagnosticSchema, SdkSessionSnapshotSchema } from "../../src/domain/schemas/index.js"
import {
  decodeSdkSessionSnapshot,
  formatSdkSessionSnapshotDiagnostic,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  redactSdkSessionSnapshot,
  serializeCookieJar,
  toughCookieJarPort
} from "../../src/voila/session-snapshot.js"
import { assertDecodeFailure, assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "secret-cookie-value"
const secretCsrfToken = "secret-csrf-token"
const secretDisplayName = "Secret Shopper"
const secretEmailHint = "secret@example.test"
const secretAccountHash = "secret-account-hash"
const secretClientRouteId = "secret-client-route-id"
const secretPageViewId = "secret-page-view-id"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: secretClientRouteId,
  pageViewId: secretPageViewId,
  regionId: "region-id"
}

const makeBaseSession = () => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token: secretCsrfToken }, cookieJar.success)

  if (Result.isFailure(session)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return session.success
}

describe("auth session snapshots", () => {
  it("round-trips guest SDK session snapshots through the schema", () => {
    const snapshot = makeGuestSdkSessionSnapshot(makeBaseSession())

    expect(Result.isSuccess(snapshot)).toBe(true)

    if (Result.isSuccess(snapshot)) {
      const decoded = assertDecodeSuccess(SdkSessionSnapshotSchema, snapshot.success)

      expect(decoded.kind).toBe("guest")
      expect(assertEncodeSuccess(SdkSessionSnapshotSchema, decoded)).toEqual(snapshot.success)
    }
  })

  it("round-trips authenticated SDK session snapshots with unknown expiry state", () => {
    const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(), "unknown-expiry", {
      displayName: secretDisplayName,
      emailHint: secretEmailHint,
      stableAccountIdHash: secretAccountHash
    })

    expect(Result.isSuccess(snapshot)).toBe(true)

    if (Result.isSuccess(snapshot)) {
      const decoded = assertDecodeSuccess(SdkSessionSnapshotSchema, snapshot.success)

      expect(decoded.kind).toBe("authenticated")

      if (decoded.kind === "authenticated") {
        expect(decoded.state).toBe("unknown-expiry")
        expect(decoded.account?.emailHint).toBe(secretEmailHint)
      }

      expect(assertEncodeSuccess(SdkSessionSnapshotSchema, decoded)).toEqual(snapshot.success)
    }
  })

  it("represents reauthentication-required authenticated sessions", () => {
    const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(), "reauth-required")

    expect(Result.isSuccess(snapshot)).toBe(true)

    if (Result.isSuccess(snapshot)) {
      const decoded = assertDecodeSuccess(SdkSessionSnapshotSchema, snapshot.success)

      expect(decoded.kind).toBe("authenticated")

      if (decoded.kind === "authenticated") {
        expect(decoded.state).toBe("reauth-required")
        expect(decoded.account).toBeUndefined()
      }

      expect(assertEncodeSuccess(SdkSessionSnapshotSchema, decoded)).toEqual(snapshot.success)
    }
  })

  it("rejects missing sensitive session fields at the SDK session boundary", () => {
    assertDecodeFailure(SdkSessionSnapshotSchema, { kind: "authenticated", state: "authenticated" })
    assertDecodeFailure(SdkSessionSnapshotSchema, {
      kind: "authenticated",
      session: makeBaseSession(),
      state: "expired"
    })
  })

  it("returns typed errors for malformed SDK session snapshots", () => {
    const result = decodeSdkSessionSnapshot({
      kind: "authenticated",
      session: { csrf: { token: secretCsrfToken }, metadata: sampleMetadata },
      state: "authenticated"
    })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("SessionSnapshotSchemaMismatch")
      expect(JSON.stringify(result.failure)).not.toContain(secretCsrfToken)
    }
  })

  it("keeps authenticated secrets out of diagnostics", () => {
    const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(), "authenticated", {
      displayName: secretDisplayName,
      emailHint: secretEmailHint,
      stableAccountIdHash: secretAccountHash
    })

    expect(Result.isSuccess(snapshot)).toBe(true)

    if (Result.isSuccess(snapshot)) {
      const diagnostic = formatSdkSessionSnapshotDiagnostic(snapshot.success)

      expect(diagnostic).toContain("authenticated")
      expect(diagnostic).toContain("[redacted]")
      expect(diagnostic).not.toContain(secretCookieValue)
      expect(diagnostic).not.toContain(secretCsrfToken)
      expect(diagnostic).not.toContain(secretDisplayName)
      expect(diagnostic).not.toContain(secretEmailHint)
      expect(diagnostic).not.toContain(secretAccountHash)
      expect(diagnostic).not.toContain(secretClientRouteId)
      expect(diagnostic).not.toContain(secretPageViewId)
    }
  })

  it("rejects incoherent SDK session diagnostic state combinations", () => {
    const sessionDiagnostic = {
      cookieJar: { cookieCount: 0, storeType: null, version: "tough-cookie@6.0.0" },
      csrf: "[redacted]",
      metadata: {
        assetVersion: "asset-version",
        clientRouteId: "[redacted]",
        pageViewId: "[redacted]",
        regionId: "region-id"
      }
    }

    assertDecodeFailure(SdkSessionSnapshotDiagnosticSchema, {
      ...sessionDiagnostic,
      kind: "guest",
      state: "authenticated"
    })
    assertDecodeFailure(SdkSessionSnapshotDiagnosticSchema, {
      ...sessionDiagnostic,
      kind: "authenticated",
      state: "guest"
    })
  })

  it("redacts guest SDK session diagnostics without account state", () => {
    const snapshot = makeGuestSdkSessionSnapshot(makeBaseSession())

    expect(Result.isSuccess(snapshot)).toBe(true)

    if (Result.isSuccess(snapshot)) {
      const diagnostic = redactSdkSessionSnapshot(snapshot.success)

      expect(diagnostic.kind).toBe("guest")
      expect(diagnostic.state).toBe("guest")
      expect(diagnostic.account).toBeUndefined()
    }
  })

  it("redacts authenticated diagnostics when account details are absent or partial", () => {
    const withoutAccount = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(), "authenticated")
    const partialAccount = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(), "authenticated", {
      displayName: secretDisplayName
    })
    const emailOnlyAccount = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(), "authenticated", {
      emailHint: secretEmailHint,
      stableAccountIdHash: secretAccountHash
    })

    expect(Result.isSuccess(withoutAccount)).toBe(true)
    expect(Result.isSuccess(partialAccount)).toBe(true)
    expect(Result.isSuccess(emailOnlyAccount)).toBe(true)

    if (Result.isSuccess(withoutAccount) && Result.isSuccess(partialAccount) && Result.isSuccess(emailOnlyAccount)) {
      expect(redactSdkSessionSnapshot(withoutAccount.success).account).toBeUndefined()
      expect(redactSdkSessionSnapshot(partialAccount.success).account).toEqual({ displayName: "[redacted]" })
      expect(redactSdkSessionSnapshot(emailOnlyAccount.success).account).toEqual({
        emailHint: "[redacted]",
        stableAccountIdHash: "[redacted]"
      })
    }
  })
})
