import { Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  loadSdkSessionSnapshot,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  saveSdkSessionSnapshot,
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

const makeMemoryStorage = (initialContents: unknown = ""): {
  readonly readContents: () => unknown
  readonly storage: SessionStoragePort
} => {
  let contents = initialContents

  return {
    readContents: () => contents,
    storage: {
      read: async () => contents,
      write: async (nextContents) => {
        contents = nextContents
      }
    }
  }
}

const throwingReadStorage: SessionStoragePort = {
  read: async () => {
    throw new Error(secretStorageFailure)
  },
  write: async () => undefined
}

const throwingWriteStorage: SessionStoragePort = {
  read: async () => "",
  write: async () => {
    throw new Error(secretStorageFailure)
  }
}

describe("session storage", () => {
  it("round-trips guest SDK session snapshots through caller-provided storage", async () => {
    const memory = makeMemoryStorage()
    const snapshot = makeGuestSnapshot()

    const saved = await saveSdkSessionSnapshot(memory.storage, snapshot)

    expect(Either.isRight(saved)).toBe(true)
    expect(typeof memory.readContents()).toBe("string")

    const loaded = await loadSdkSessionSnapshot(memory.storage)

    expect(Either.isRight(loaded)).toBe(true)

    if (Either.isRight(loaded)) {
      expect(loaded.right).toEqual(snapshot)
    }
  })

  it("round-trips authenticated SDK session snapshots through caller-provided storage", async () => {
    const memory = makeMemoryStorage()
    const snapshot = makeAuthenticatedSnapshot()

    const saved = await saveSdkSessionSnapshot(memory.storage, snapshot)
    const loaded = await loadSdkSessionSnapshot(memory.storage)

    expect(Either.isRight(saved)).toBe(true)
    expect(Either.isRight(loaded)).toBe(true)

    if (Either.isRight(loaded)) {
      expect(loaded.right).toEqual(snapshot)
    }
  })

  it("rejects invalid snapshots before writing", async () => {
    const memory = makeMemoryStorage("unchanged")
    const result = await saveSdkSessionSnapshot(memory.storage, {
      kind: "authenticated",
      session: {
        csrf: {
          token: secretCsrfToken
        }
      }
    })

    expect(Either.isLeft(result)).toBe(true)
    expect(memory.readContents()).toBe("unchanged")

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SessionStorageSnapshotInvalid")
      expect(JSON.stringify(result.left)).not.toContain(secretCsrfToken)
    }
  })

  it("returns redacted typed write failures", async () => {
    const result = await saveSdkSessionSnapshot(throwingWriteStorage, makeGuestSnapshot())

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SessionStorageWriteFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretStorageFailure)
      expect(JSON.stringify(result.left)).not.toContain(secretCookieValue)
      expect(JSON.stringify(result.left)).not.toContain(secretCsrfToken)
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
        session: {
          csrf: {
            token: secretCsrfToken
          }
        },
        state: "authenticated"
      }),
      name: "stale session JSON"
    }
  ])("returns redacted typed failures for $name", async ({ contents }) => {
    const memory = makeMemoryStorage(contents)
    const result = await loadSdkSessionSnapshot(memory.storage)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SessionStorageContentsInvalid")
      expect(JSON.stringify(result.left)).not.toContain(secretCsrfToken)
      expect(JSON.stringify(result.left)).not.toContain(secretCookieValue)
    }
  })
})
