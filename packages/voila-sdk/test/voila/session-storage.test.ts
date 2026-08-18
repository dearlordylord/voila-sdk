import { Effect, Result } from "effect"
import { describe, expect, it } from "vitest"

import {
  loadSdkSessionSnapshot,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  serializeCookieJar,
  type SessionStoragePort,
  sessionStorageReadFailure,
  toughCookieJarPort
} from "../../src/index.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "secret-cookie-value"
const secretCsrfToken = "secret-csrf-token"
const secretEmailHint = "secret@example.test"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
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

const makeGuestSnapshot = () => {
  const snapshot = makeGuestSdkSessionSnapshot(makeBaseSession())

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected guest SDK session snapshot creation to succeed")
  }

  return snapshot.success
}

const makeAuthenticatedSnapshot = () => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(), "authenticated", {
    emailHint: secretEmailHint
  })

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot creation to succeed")
  }

  return snapshot.success
}

const makeMemoryStorage = (contents: unknown = ""): SessionStoragePort => ({ read: () => Effect.succeed(contents) })

const storedSnapshot = (snapshot: unknown): SessionStoragePort => makeMemoryStorage(JSON.stringify(snapshot))

// an adapter whose read did not happen reports it in the SDK's own vocabulary:
// the platform error that caused it never crosses this boundary
const failingReadStorage: SessionStoragePort = { read: () => Effect.fail(sessionStorageReadFailure()) }

describe("session storage", () => {
  it("reads back a stored guest SDK session snapshot", async () => {
    const snapshot = makeGuestSnapshot()
    const loaded = await Effect.runPromise(Effect.result(loadSdkSessionSnapshot(storedSnapshot(snapshot))))

    expect(Result.isSuccess(loaded)).toBe(true)

    if (Result.isSuccess(loaded)) {
      expect(loaded.success).toEqual(snapshot)
    }
  })

  it("reads back a stored authenticated SDK session snapshot", async () => {
    const snapshot = makeAuthenticatedSnapshot()
    const loaded = await Effect.runPromise(Effect.result(loadSdkSessionSnapshot(storedSnapshot(snapshot))))

    expect(Result.isSuccess(loaded)).toBe(true)

    if (Result.isSuccess(loaded)) {
      expect(loaded.success).toEqual(snapshot)
    }
  })

  it("returns redacted typed read failures", async () => {
    const result = await Effect.runPromise(Effect.result(loadSdkSessionSnapshot(failingReadStorage)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("SessionStorageReadFailure")
    }
  })

  it.each([
    { contents: 1, name: "non-string storage contents" },
    { contents: `{ "csrf": "${secretCsrfToken}"`, name: "malformed JSON" },
    {
      contents: JSON.stringify({
        kind: "authenticated",
        session: { csrf: { token: secretCsrfToken } },
        state: "authenticated"
      }),
      name: "stale session JSON"
    }
  ])("returns redacted typed failures for $name", async ({ contents }) => {
    const result = await Effect.runPromise(Effect.result(loadSdkSessionSnapshot(makeMemoryStorage(contents))))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("SessionStorageContentsInvalid")
      expect(JSON.stringify(result.failure)).not.toContain(secretCsrfToken)
      expect(JSON.stringify(result.failure)).not.toContain(secretCookieValue)
    }
  })
})
