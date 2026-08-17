import { Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  loadSdkSessionSnapshot,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  serializeCookieJar,
  type SessionStoragePort,
  toughCookieJarPort
} from "../../src/index.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "secret-cookie-value"
const secretCsrfToken = "secret-csrf-token"
const secretStorageFailure = "secret-storage-failure"
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

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token: secretCsrfToken }, cookieJar.right)

  if (Either.isLeft(session)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return session.right
}

const makeGuestSnapshot = () => {
  const snapshot = makeGuestSdkSessionSnapshot(makeBaseSession())

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected guest SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeAuthenticatedSnapshot = () => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(), "authenticated", {
    emailHint: secretEmailHint
  })

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeMemoryStorage = (contents: unknown = ""): SessionStoragePort => ({ read: async () => contents })

const storedSnapshot = (snapshot: unknown): SessionStoragePort => makeMemoryStorage(JSON.stringify(snapshot))

const throwingReadStorage: SessionStoragePort = {
  read: async () => {
    throw new Error(secretStorageFailure)
  }
}

describe("session storage", () => {
  it("reads back a stored guest SDK session snapshot", async () => {
    const snapshot = makeGuestSnapshot()
    const loaded = await loadSdkSessionSnapshot(storedSnapshot(snapshot))

    expect(Either.isRight(loaded)).toBe(true)

    if (Either.isRight(loaded)) {
      expect(loaded.right).toEqual(snapshot)
    }
  })

  it("reads back a stored authenticated SDK session snapshot", async () => {
    const snapshot = makeAuthenticatedSnapshot()
    const loaded = await loadSdkSessionSnapshot(storedSnapshot(snapshot))

    expect(Either.isRight(loaded)).toBe(true)

    if (Either.isRight(loaded)) {
      expect(loaded.right).toEqual(snapshot)
    }
  })

  it("returns redacted typed read failures", async () => {
    const result = await loadSdkSessionSnapshot(throwingReadStorage)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SessionStorageReadFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretStorageFailure)
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
    const result = await loadSdkSessionSnapshot(makeMemoryStorage(contents))

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SessionStorageContentsInvalid")
      expect(JSON.stringify(result.left)).not.toContain(secretCsrfToken)
      expect(JSON.stringify(result.left)).not.toContain(secretCookieValue)
    }
  })
})
