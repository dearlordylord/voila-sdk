import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { CookieJarPort, CookieJarPortError, SessionSnapshot, VoilaTransportResponse } from "../../src/index.js"
import {
  makeSessionSnapshot,
  refreshSessionCsrf,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"
import { connectionFailureTransport, respondingTransport, runWith } from "../helpers/transport.js"

const staleToken = "stale-csrf-token"
const freshToken = "fresh-csrf-token"
const authenticatedCookie = "userEmail=someone%40example.com; Path=/; Secure"
const sessionCookie = "voila-session=before; Path=/; Secure"

const staleMetadata = {
  assetVersion: "stale-asset-version",
  clientRouteId: "stale-client-route-id",
  pageViewId: "stale-page-view-id",
  regionId: "region-id"
}

const freshMetadata = { assetVersion: "fresh-asset-version", pageViewId: "fresh-page-view-id", regionId: "region-id" }

const cookieSerializationFailure = {
  _tag: "CookieJarSerializationFailed",
  message: "cannot serialize jar with fresh-csrf-token"
} satisfies CookieJarPortError

const cookieImportFailure = {
  _tag: "CookieJarSnapshotImportFailed",
  message: "cannot import jar with voila-session=secret-cookie"
} satisfies CookieJarPortError

const makeSession = (cookies: ReadonlyArray<string>, token: string = staleToken): SessionSnapshot => {
  const jar = toughCookieJarPort.create()

  for (const cookie of cookies) {
    jar.setCookieSync(cookie, VOILA_BASE_URL)
  }

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const snapshot = makeSessionSnapshot(staleMetadata, { token }, cookieJar.right)

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return snapshot.right
}

const homepageHtml = (session: unknown): string =>
  `<html><body><script>window.__INITIAL_STATE__ = ${JSON.stringify({
    data: { unrelated: "the refresh does not read the basket" },
    session
  })};</script></body></html>`

const freshSessionState = { csrf: { token: freshToken }, metadata: freshMetadata }

const homepageResponse = (
  body: string = homepageHtml(freshSessionState),
  headers: VoilaTransportResponse["headers"] = {},
  status: number = 200
): VoilaTransportResponse => ({ body, headers, status })

const cookiesOf = (session: SessionSnapshot): string => {
  const jar = toughCookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    throw new Error("Expected refreshed cookie jar to deserialize")
  }

  return jar.right.getCookieStringSync(VOILA_BASE_URL)
}

const failingSerializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: toughCookieJarPort.deserialize,
  serialize: () => Either.left(cookieSerializationFailure)
}

const failingDeserializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: () => Either.left(cookieImportFailure),
  serialize: toughCookieJarPort.serialize
}

describe("refreshSessionCsrf", () => {
  it("adopts the token and metadata the homepage publishes", async () => {
    const fake = respondingTransport(homepageResponse())
    const result = await runWith(refreshSessionCsrf(makeSession([sessionCookie])), fake)
    const [request] = fake.requests

    expect(request?.method).toBe("GET")
    expect(request?.url.href).toBe(`${VOILA_BASE_URL}/`)
    expect(request?.headers.cookie).toContain("voila-session=before")

    if (Either.isLeft(result)) {
      throw new Error(`Expected refresh to succeed, got ${result.left._tag}`)
    }

    expect(result.right.csrf.token).toBe(freshToken)
    expect(result.right.metadata.assetVersion).toBe("fresh-asset-version")
    expect(result.right.metadata.pageViewId).toBe("fresh-page-view-id")
  })

  it("keeps the session cookies it started from and folds the homepage's on top", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie, authenticatedCookie])),
      respondingTransport(homepageResponse(undefined, { "set-cookie": "visitor=fresh; Path=/; Secure" }))
    )

    if (Either.isLeft(result)) {
      throw new Error(`Expected refresh to succeed, got ${result.left._tag}`)
    }

    const cookies = cookiesOf(result.right)

    expect(cookies).toContain("voila-session=before")
    expect(cookies).toContain("userEmail=")
    expect(cookies).toContain("visitor=fresh")
  })

  it("sends no cookie header when the jar is empty", async () => {
    const fake = respondingTransport(homepageResponse())
    await runWith(refreshSessionCsrf(makeSession([])), fake)

    expect(fake.requests[0]?.headers.cookie).toBeUndefined()
  })

  it("reports a token the session already carries rather than retrying with it", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie])),
      respondingTransport(homepageResponse(homepageHtml({ csrf: { token: staleToken }, metadata: freshMetadata })))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshTokenUnchanged")
    }
  })

  it("refuses a refresh that drops the authenticated cookie", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie, authenticatedCookie])),
      respondingTransport(
        homepageResponse(undefined, { "set-cookie": "userEmail=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT" })
      )
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshSessionDeauthenticated")
    }
  })

  it("reports a non-success homepage response", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie])),
      respondingTransport(homepageResponse(undefined, {}, 503))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshNon2xxResponse")
    }
  })

  it("reports initial state that carries no session block", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie])),
      respondingTransport(homepageResponse(homepageHtml({ metadata: freshMetadata })))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshInitialStateMalformed")
    }
  })

  it("reports a homepage with no initial state at all", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie])),
      respondingTransport(homepageResponse("<html><body>maintenance</body></html>"))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshInitialStateMalformed")
    }
  })

  it("reports a blank token as malformed rather than adopting it", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie])),
      respondingTransport(homepageResponse(homepageHtml({ csrf: { token: " " }, metadata: freshMetadata })))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshInitialStateMalformed")
    }
  })

  it("reports a cookie the jar refuses to store without leaking it", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie])),
      respondingTransport(homepageResponse(undefined, { "set-cookie": "bad cookie value" }))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain("bad cookie value")
    }
  })

  it("reports a redacted persistence failure when the jar cannot be serialized", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie]), failingSerializeCookieJarPort),
      respondingTransport(homepageResponse())
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain(cookieSerializationFailure.message)
    }
  })

  it("reports a redacted persistence failure when the jar cannot be restored", async () => {
    const result = await runWith(
      refreshSessionCsrf(makeSession([sessionCookie]), failingDeserializeCookieJarPort),
      respondingTransport(homepageResponse())
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CsrfRefreshPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain(cookieImportFailure.message)
    }
  })

  it("passes a transport failure through untouched", async () => {
    const result = await runWith(refreshSessionCsrf(makeSession([sessionCookie])), connectionFailureTransport())

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaConnectionFailure")
    }
  })
})
