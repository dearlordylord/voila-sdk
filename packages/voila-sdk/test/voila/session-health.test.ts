import { Effect, Result } from "effect"
import { CookieJar, Store } from "tough-cookie"
import { describe, expect, it } from "vitest"

import {
  checkSessionHealth,
  connectionFailure,
  type CookieJarPort,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  requestDeadlineExceeded,
  responseReadFailure,
  type SdkSessionSnapshot,
  serializeCookieJar,
  SessionHealthSchema,
  type SessionSnapshot,
  toughCookieJarPort,
  VOILA_BASE_URL,
  type VoilaTransportResponse
} from "../../src/index.js"
import {
  connectionFailureTransport,
  deadlineExceededTransport,
  respondingTransport,
  responseReadFailureTransport,
  runWith,
  sequenceTransport,
  stubTransport
} from "../helpers/transport.js"
import { assertDecodeFailure } from "../helpers/property.js"

const csrfToken = "csrf-token"
const authenticatedCookieName = "userEmail"
const secretCookieValue = "secret-cookie-value"
const secretTransportPayload = "secret-transport-payload"
const secretAccountHint = "secret@example.test"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const makeSession = (token: string = csrfToken, authenticatedCookieValue?: string): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure`, VOILA_BASE_URL)

  if (authenticatedCookieValue !== undefined) {
    jar.setCookieSync(`${authenticatedCookieName}=${authenticatedCookieValue}; Path=/; Secure`, VOILA_BASE_URL)
  }

  const cookieJar = serializeCookieJar(jar)

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token }, cookieJar.success)

  if (Result.isFailure(session)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return session.success
}

const makeEmptyCookieSession = (): SessionSnapshot => {
  const cookieJar = serializeCookieJar(toughCookieJarPort.create())

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected empty cookie jar serialization to succeed")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, cookieJar.success)

  if (Result.isFailure(session)) {
    throw new Error("Expected empty-cookie session snapshot creation to succeed")
  }

  return session.success
}

const makeGuestSnapshot = (): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeSession())

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected guest SDK session snapshot creation to succeed")
  }

  return snapshot.success
}

const makeEmptyCookieGuestSnapshot = (): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeEmptyCookieSession())

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected empty-cookie guest SDK session snapshot creation to succeed")
  }

  return snapshot.success
}

const makeAuthenticatedSnapshot = (token: string = csrfToken): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeSession(token), "unknown-expiry", {
    emailHint: secretAccountHint
  })

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot creation to succeed")
  }

  return snapshot.success
}

const makeAuthenticatedCookieSnapshot = (): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeSession(csrfToken, "redacted-user"), "unknown-expiry", {
    emailHint: secretAccountHint
  })

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot creation to succeed")
  }

  return snapshot.success
}

const makeReauthSnapshot = (): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeSession(), "reauth-required", {
    emailHint: secretAccountHint
  })

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected reauth SDK session snapshot creation to succeed")
  }

  return snapshot.success
}

const makeResponse = (
  body: string,
  status: number = 200,
  headers: VoilaTransportResponse["headers"] = {}
): VoilaTransportResponse => ({ body, headers, status })

const homepageResponse = (isLoggedIn: boolean): VoilaTransportResponse =>
  makeResponse(
    `<script>window.__INITIAL_STATE__ = ${JSON.stringify({
      session: { csrf: { token: csrfToken }, isLoggedIn, metadata: sampleMetadata }
    })};</script>`
  )

const failingDeserializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: () => Result.fail({ _tag: "CookieJarSnapshotImportFailed", message: secretTransportPayload }),
  serialize: toughCookieJarPort.serialize
}

/**
 * A jar whose store is asynchronous: tough-cookie's synchronous read throws
 * rather than returning, which the health check must report as a typed retry
 * rather than let escape as a defect.
 */
const asyncStoreCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: () => Result.succeed(new CookieJar(new Store())),
  serialize: toughCookieJarPort.serialize
}

const failingSerializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: toughCookieJarPort.deserialize,
  serialize: () => Result.fail({ _tag: "CookieJarSerializationFailed", message: secretTransportPayload })
}

const makeFailingSecondDeserializeCookieJarPort = (): CookieJarPort => {
  let deserializeCount = 0

  return {
    create: toughCookieJarPort.create,
    deserialize: (snapshot) => {
      deserializeCount = deserializeCount + 1

      return deserializeCount === 1
        ? toughCookieJarPort.deserialize(snapshot)
        : Result.fail({ _tag: "CookieJarSnapshotImportFailed", message: secretTransportPayload })
    },
    serialize: toughCookieJarPort.serialize
  }
}

const getSessionCookieHeader = (session: SessionSnapshot): string => {
  const jar = toughCookieJarPort.deserialize(session.cookieJar)

  if (Result.isFailure(jar)) {
    throw new Error("Expected cookie jar deserialization to succeed")
  }

  return jar.success.getCookieStringSync(VOILA_BASE_URL)
}

describe("session health", () => {
  it("checks an active authenticated session and preserves account summary", async () => {
    const fake = respondingTransport(
      makeResponse(JSON.stringify({ authenticated: true }), 200, {
        "set-cookie": "fresh-session=after; Path=/; Secure"
      })
    )

    const result = await runWith(checkSessionHealth(makeAuthenticatedSnapshot()), fake)

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      const [request] = fake.requests

      expect(request?.method).toBe("GET")
      expect(request?.url.href).toBe(`${VOILA_BASE_URL}/api/customersessions/v2/sessions/active`)
      expect(request?.headers.cookie).toContain(`voila-session=${secretCookieValue}`)
      expect(result.success.status).toBe("active")
      expect(result.success.session.kind).toBe("authenticated")

      if (result.success.session.kind === "authenticated") {
        expect(result.success.session.state).toBe("authenticated")
        expect(result.success.session.account?.emailHint).toBe(secretAccountHint)
        expect(getSessionCookieHeader(result.success.session.session)).toContain("fresh-session=after")
      }
    }
  })

  it("checks an active guest session", async () => {
    const result = await runWith(
      checkSessionHealth(makeGuestSnapshot()),
      respondingTransport(makeResponse(JSON.stringify({ authenticated: false })))
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("active")
      expect(result.success.session.kind).toBe("guest")
    }
  })

  it("checks an active guest session without sending a cookie header when the jar is empty", async () => {
    const fake = respondingTransport(makeResponse(JSON.stringify({ authenticated: false })))
    const result = await runWith(checkSessionHealth(makeEmptyCookieGuestSnapshot()), fake)

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      const [request] = fake.requests

      expect(request?.headers.cookie).toBeUndefined()
      expect(result.success.status).toBe("active")
      expect(result.success.session.kind).toBe("guest")
    }
  })

  it.each([
    { body: { isAuthenticated: true }, name: "top-level isAuthenticated" },
    { body: { customer: { authenticated: true } }, name: "customer authenticated" },
    { body: { status: "AUTHENTICATED" }, name: "authenticated status" }
  ])("accepts $name as authenticated evidence", async ({ body }) => {
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot()),
      respondingTransport(makeResponse(JSON.stringify(body)))
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("active")
      expect(result.success.session.kind).toBe("authenticated")
    }
  })

  it("lets explicit deauthentication evidence override contradictory positive evidence", async () => {
    const fake = respondingTransport(
      makeResponse(JSON.stringify({ authenticated: true, customer: { anonymous: true } }))
    )
    const result = await runWith(checkSessionHealth(makeAuthenticatedSnapshot()), fake)

    expect(Result.isSuccess(result)).toBe(true)
    expect(fake.requests).toHaveLength(1)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("reauth-required")
    }
  })

  it.each([
    { body: { isAuthenticated: false }, name: "top-level isAuthenticated" },
    { body: { customer: { authenticated: false } }, name: "customer authenticated" },
    { body: { customer: { anonymous: true } }, name: "customer anonymous" }
  ])("requires reauthentication for negative $name evidence", async ({ body }) => {
    const fake = respondingTransport(makeResponse(JSON.stringify(body)))
    const result = await runWith(checkSessionHealth(makeAuthenticatedSnapshot()), fake)

    expect(Result.isSuccess(result)).toBe(true)
    expect(fake.requests).toHaveLength(1)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("reauth-required")
    }
  })

  it("requires reauthentication when only anonymous cart session identifiers are returned", async () => {
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot()),
      sequenceTransport([
        makeResponse(JSON.stringify({ cartId: "sanitized-cart-id", regionId: "sanitized-region-id", type: "CART" })),
        homepageResponse(false)
      ])
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("reauth-required")
      expect(result.success.session.kind).toBe("authenticated")
    }
  })

  it("uses homepage login state instead of a stored authenticated cookie for ambiguous responses", async () => {
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedCookieSnapshot()),
      sequenceTransport([
        makeResponse(JSON.stringify({ cartId: "sanitized-cart-id", regionId: "sanitized-region-id", type: "CART" })),
        homepageResponse(true)
      ])
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("active")
      expect(result.success.session.kind).toBe("authenticated")
    }
  })

  it("reports homepage schema drift while confirming ambiguous authentication", async () => {
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot()),
      sequenceTransport([
        makeResponse(JSON.stringify({ cartId: "sanitized-cart-id", regionId: "sanitized-region-id" })),
        makeResponse("<html>missing initial state</html>")
      ])
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("schema-changed")
    }
  })

  it.each([
    { expectedStatus: "reauth-required", homepageStatus: 401 },
    { expectedStatus: "reauth-required", homepageStatus: 403 },
    { expectedStatus: "retry", homepageStatus: 500 }
  ])(
    "maps ambiguous authentication homepage status $homepageStatus to $expectedStatus",
    async ({ expectedStatus, homepageStatus }) => {
      const result = await runWith(
        checkSessionHealth(makeAuthenticatedSnapshot()),
        sequenceTransport([
          makeResponse(JSON.stringify({ cartId: "sanitized-cart-id", regionId: "sanitized-region-id" })),
          makeResponse("", homepageStatus)
        ])
      )

      expect(Result.isSuccess(result)).toBe(true)

      if (Result.isSuccess(result)) {
        expect(result.success.status).toBe(expectedStatus)

        if (result.success.status === "retry") {
          expect(result.success.reason).toBe("server")
        }
      }
    }
  )

  it.each([
    { error: connectionFailure(), name: "connection failure" },
    { error: requestDeadlineExceeded(1_000), name: "deadline" },
    { error: responseReadFailure(), name: "response read failure" }
  ])("maps homepage $name during ambiguous authentication to network retry", async ({ error }) => {
    let requestCount = 0
    const fake = stubTransport(() => {
      requestCount += 1

      return requestCount === 1
        ? Effect.succeed(makeResponse(JSON.stringify({ cartId: "sanitized-cart-id", regionId: "sanitized-region-id" })))
        : Effect.fail(error)
    })
    const result = await runWith(checkSessionHealth(makeAuthenticatedSnapshot()), fake)

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result) && result.success.status === "retry") {
      expect(result.success.reason).toBe("network")
    }
  })

  it("requires reauthentication when an authenticated session loses authenticated evidence", async () => {
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot()),
      respondingTransport(
        makeResponse(JSON.stringify({ authenticated: false }), 200, {
          "set-cookie": "reauth-session=after; Path=/; Secure"
        })
      )
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("reauth-required")
      expect(result.success.session.kind).toBe("authenticated")

      if (result.success.session.kind === "authenticated") {
        expect(result.success.session.state).toBe("reauth-required")
        expect(result.success.session.account?.emailHint).toBe(secretAccountHint)
        expect(getSessionCookieHeader(result.success.session.session)).toContain("reauth-session=after")
      }
    }
  })

  it("maps unauthorized authenticated sessions to reauthentication-required", async () => {
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot()),
      respondingTransport(makeResponse("{}", 401, { "set-cookie": "unauthorized-session=after; Path=/; Secure" }))
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("reauth-required")
      expect(result.success.session.kind).toBe("authenticated")

      if (result.success.session.kind === "authenticated") {
        expect(result.success.session.state).toBe("reauth-required")
        expect(getSessionCookieHeader(result.success.session.session)).toContain("unauthorized-session=after")
      }
    }
  })

  it("maps unauthorized guest sessions to unauthorized", async () => {
    const result = await runWith(
      checkSessionHealth(makeGuestSnapshot()),
      respondingTransport(makeResponse("{}", 403, { "set-cookie": "guest-unauthorized=after; Path=/; Secure" }))
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("unauthorized")
      expect(result.success.session.kind).toBe("guest")
      expect(getSessionCookieHeader(result.success.session.session)).toContain("guest-unauthorized=after")
    }
  })

  it("rejects impossible public session health DTO states", () => {
    assertDecodeFailure(SessionHealthSchema, { session: makeReauthSnapshot(), status: "active" })
    assertDecodeFailure(SessionHealthSchema, { session: makeAuthenticatedSnapshot(), status: "reauth-required" })
    assertDecodeFailure(SessionHealthSchema, { session: makeAuthenticatedSnapshot(), status: "unauthorized" })
  })

  it.each([
    { body: "{", name: "malformed JSON" },
    { body: "[]", name: "schema drift" }
  ])("maps $name to schema-changed health", async ({ body }) => {
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot()),
      respondingTransport(makeResponse(body))
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("schema-changed")
    }
  })

  it("maps missing CSRF to reauthentication-required for authenticated sessions", async () => {
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot(" ")),
      respondingTransport(makeResponse(JSON.stringify({ authenticated: true })))
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("reauth-required")
    }
  })

  it.each([
    { expectedReason: "network", name: "refused connections", transport: connectionFailureTransport() },
    { expectedReason: "network", name: "abandoned deadlines", transport: deadlineExceededTransport() },
    { expectedReason: "network", name: "unreadable response bodies", transport: responseReadFailureTransport() },
    { expectedReason: "server", name: "server failures", transport: respondingTransport(makeResponse("{}", 500)) },
    {
      expectedReason: "persistence",
      name: "cookie persistence failures",
      transport: respondingTransport(
        makeResponse(JSON.stringify({ authenticated: true }), 200, {
          "set-cookie": "fresh-session=after; Path=/; Secure"
        })
      )
    },
    {
      expectedReason: "persistence",
      name: "malformed response cookie failures",
      transport: respondingTransport(
        makeResponse(JSON.stringify({ authenticated: true }), 200, { "set-cookie": "bad cookie value" })
      )
    }
  ])("maps $name to retry health", async ({ expectedReason, name, transport }) => {
    const result = await runWith(
      checkSessionHealth(
        makeAuthenticatedSnapshot(),
        name === "cookie persistence failures" ? failingSerializeCookieJarPort : undefined
      ),
      transport
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("retry")

      if (result.success.status === "retry") {
        expect(result.success.reason).toBe(expectedReason)
      }
    }
  })

  it("maps an unreadable restored jar to retry health before network I/O", async () => {
    const fake = respondingTransport(makeResponse(JSON.stringify({ authenticated: true })))
    const result = await runWith(checkSessionHealth(makeAuthenticatedSnapshot(), asyncStoreCookieJarPort), fake)

    expect(Result.isSuccess(result)).toBe(true)
    expect(fake.requests).toEqual([])

    if (Result.isSuccess(result) && result.success.status === "retry") {
      expect(result.success.reason).toBe("persistence")
    }
  })

  it("maps cookie jar restoration failures to retry health before network I/O", async () => {
    const fake = respondingTransport(makeResponse(JSON.stringify({ authenticated: true })))
    const result = await runWith(checkSessionHealth(makeAuthenticatedSnapshot(), failingDeserializeCookieJarPort), fake)

    expect(Result.isSuccess(result)).toBe(true)
    expect(fake.requests).toEqual([])

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("retry")

      if (result.success.status === "retry") {
        expect(result.success.reason).toBe("persistence")
      }

      expect(JSON.stringify(result.success)).not.toContain(secretTransportPayload)
    }
  })

  it("maps cookie jar restoration failures during Set-Cookie application to retry health", async () => {
    const fake = respondingTransport(
      makeResponse(JSON.stringify({ authenticated: true }), 200, {
        "set-cookie": "fresh-session=after; Path=/; Secure"
      })
    )
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot(), makeFailingSecondDeserializeCookieJarPort()),
      fake
    )

    expect(Result.isSuccess(result)).toBe(true)
    expect(fake.requests).toHaveLength(1)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("retry")

      if (result.success.status === "retry") {
        expect(result.success.reason).toBe("persistence")
      }

      expect(JSON.stringify(result.success)).not.toContain(secretTransportPayload)
    }
  })

  it("maps cookie restoration failures during homepage authentication confirmation to retry health", async () => {
    const fake = respondingTransport(makeResponse(JSON.stringify({})))
    const result = await runWith(
      checkSessionHealth(makeAuthenticatedSnapshot(), makeFailingSecondDeserializeCookieJarPort()),
      fake
    )

    expect(Result.isSuccess(result)).toBe(true)
    expect(fake.requests).toHaveLength(1)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("retry")

      if (result.success.status === "retry") {
        expect(result.success.reason).toBe("persistence")
      }
    }
  })

  it("maps guest network failures to retry health", async () => {
    const result = await runWith(checkSessionHealth(makeGuestSnapshot()), connectionFailureTransport())

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("retry")
      expect(result.success.session.kind).toBe("guest")

      if (result.success.status === "retry") {
        expect(result.success.reason).toBe("network")
      }
    }
  })
})
