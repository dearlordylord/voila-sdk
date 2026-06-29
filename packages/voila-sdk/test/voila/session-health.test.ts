import { Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  checkSessionHealth,
  type CookieJarPort,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  serializeCookieJar,
  SessionHealthSchema,
  type SessionSnapshot,
  toughCookieJarPort,
  VOILA_BASE_URL,
  type VoilaTransport,
  type VoilaTransportRequest,
  type VoilaTransportResponse
} from "../../src/index.js"
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

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token }, cookieJar.right)

  if (Either.isLeft(session)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return session.right
}

const makeEmptyCookieSession = (): SessionSnapshot => {
  const cookieJar = serializeCookieJar(toughCookieJarPort.create())

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected empty cookie jar serialization to succeed")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, cookieJar.right)

  if (Either.isLeft(session)) {
    throw new Error("Expected empty-cookie session snapshot creation to succeed")
  }

  return session.right
}

const makeGuestSnapshot = (): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeSession())

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected guest SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeEmptyCookieGuestSnapshot = (): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeEmptyCookieSession())

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected empty-cookie guest SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeAuthenticatedSnapshot = (token: string = csrfToken): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeSession(token), "unknown-expiry", {
    emailHint: secretAccountHint
  })

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeAuthenticatedCookieSnapshot = (): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeSession(csrfToken, "redacted-user"), "unknown-expiry", {
    emailHint: secretAccountHint
  })

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeReauthSnapshot = (): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeSession(), "reauth-required", {
    emailHint: secretAccountHint
  })

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected reauth SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeResponse = (
  body: string,
  status: number = 200,
  headers: VoilaTransportResponse["headers"] = {}
): VoilaTransportResponse => ({
  body,
  headers,
  status
})

const makeResponseTransport = (response: VoilaTransportResponse): {
  readonly requests: () => ReadonlyArray<VoilaTransportRequest>
  readonly transport: VoilaTransport
} => {
  const requests: Array<VoilaTransportRequest> = []

  return {
    requests: () => requests,
    transport: {
      request: async (request) => {
        requests.push(request)

        return Either.right(response)
      }
    }
  }
}

const makeLeftTransport = (failure: unknown): VoilaTransport => ({
  request: async () => Either.left(failure)
})

const makeThrowingTransport = (failure: unknown): VoilaTransport => ({
  request: async () => {
    throw failure
  }
})

const failingDeserializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: () =>
    Either.left({
      _tag: "CookieJarSnapshotImportFailed",
      message: secretTransportPayload
    }),
  serialize: toughCookieJarPort.serialize
}

const failingSerializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: toughCookieJarPort.deserialize,
  serialize: () =>
    Either.left({
      _tag: "CookieJarSerializationFailed",
      message: secretTransportPayload
    })
}

const makeFailingSecondDeserializeCookieJarPort = (): CookieJarPort => {
  let deserializeCount = 0

  return {
    create: toughCookieJarPort.create,
    deserialize: (snapshot) => {
      deserializeCount = deserializeCount + 1

      return deserializeCount === 1
        ? toughCookieJarPort.deserialize(snapshot)
        : Either.left({
          _tag: "CookieJarSnapshotImportFailed",
          message: secretTransportPayload
        })
    },
    serialize: toughCookieJarPort.serialize
  }
}

const getSessionCookieHeader = (session: SessionSnapshot): string => {
  const jar = toughCookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    throw new Error("Expected cookie jar deserialization to succeed")
  }

  return jar.right.getCookieStringSync(VOILA_BASE_URL)
}

describe("session health", () => {
  it("checks an active authenticated session and preserves account summary", async () => {
    const fake = makeResponseTransport(makeResponse(
      JSON.stringify({
        authenticated: true
      }),
      200,
      {
        "set-cookie": "fresh-session=after; Path=/; Secure"
      }
    ))

    const result = await checkSessionHealth(makeAuthenticatedSnapshot(), fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("GET")
      expect(request?.url.href).toBe(`${VOILA_BASE_URL}/api/customersessions/v2/sessions/active`)
      expect(request?.headers.cookie).toContain(`voila-session=${secretCookieValue}`)
      expect(result.right.status).toBe("active")
      expect(result.right.session.kind).toBe("authenticated")

      if (result.right.session.kind === "authenticated") {
        expect(result.right.session.state).toBe("authenticated")
        expect(result.right.session.account?.emailHint).toBe(secretAccountHint)
        expect(getSessionCookieHeader(result.right.session.session)).toContain("fresh-session=after")
      }
    }
  })

  it("checks an active guest session", async () => {
    const result = await checkSessionHealth(
      makeGuestSnapshot(),
      makeResponseTransport(makeResponse(JSON.stringify({
        authenticated: false
      }))).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("active")
      expect(result.right.session.kind).toBe("guest")
    }
  })

  it("checks an active guest session without sending a cookie header when the jar is empty", async () => {
    const fake = makeResponseTransport(makeResponse(JSON.stringify({
      authenticated: false
    })))
    const result = await checkSessionHealth(
      makeEmptyCookieGuestSnapshot(),
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.headers.cookie).toBeUndefined()
      expect(result.right.status).toBe("active")
      expect(result.right.session.kind).toBe("guest")
    }
  })

  it.each([
    {
      body: {
        isAuthenticated: true
      },
      name: "top-level isAuthenticated"
    },
    {
      body: {
        customer: {
          authenticated: true
        }
      },
      name: "customer authenticated"
    },
    {
      body: {
        status: "AUTHENTICATED"
      },
      name: "authenticated status"
    }
  ])("accepts $name as authenticated evidence", async ({ body }) => {
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(),
      makeResponseTransport(makeResponse(JSON.stringify(body))).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("active")
      expect(result.right.session.kind).toBe("authenticated")
    }
  })

  it("accepts active cart session identifiers for an authenticated snapshot", async () => {
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(),
      makeResponseTransport(makeResponse(
        JSON.stringify({
          cartId: "sanitized-cart-id",
          regionId: "sanitized-region-id",
          type: "CART"
        })
      )).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("active")
      expect(result.right.session.kind).toBe("authenticated")
    }
  })

  it("preserves authenticated cookie sessions when active cart identifiers are returned", async () => {
    const result = await checkSessionHealth(
      makeAuthenticatedCookieSnapshot(),
      makeResponseTransport(makeResponse(
        JSON.stringify({
          cartId: "sanitized-cart-id",
          regionId: "sanitized-region-id",
          type: "CART"
        })
      )).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("active")
      expect(result.right.session.kind).toBe("authenticated")
    }
  })

  it("requires reauthentication when an authenticated session loses authenticated evidence", async () => {
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(),
      makeResponseTransport(makeResponse(
        JSON.stringify({
          authenticated: false
        }),
        200,
        {
          "set-cookie": "reauth-session=after; Path=/; Secure"
        }
      )).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("reauth-required")
      expect(result.right.session.kind).toBe("authenticated")

      if (result.right.session.kind === "authenticated") {
        expect(result.right.session.state).toBe("reauth-required")
        expect(result.right.session.account?.emailHint).toBe(secretAccountHint)
        expect(getSessionCookieHeader(result.right.session.session)).toContain("reauth-session=after")
      }
    }
  })

  it("maps unauthorized authenticated sessions to reauthentication-required", async () => {
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(),
      makeResponseTransport(makeResponse("{}", 401, {
        "set-cookie": "unauthorized-session=after; Path=/; Secure"
      })).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("reauth-required")
      expect(result.right.session.kind).toBe("authenticated")

      if (result.right.session.kind === "authenticated") {
        expect(result.right.session.state).toBe("reauth-required")
        expect(getSessionCookieHeader(result.right.session.session)).toContain("unauthorized-session=after")
      }
    }
  })

  it("maps unauthorized guest sessions to unauthorized", async () => {
    const result = await checkSessionHealth(
      makeGuestSnapshot(),
      makeResponseTransport(makeResponse("{}", 403, {
        "set-cookie": "guest-unauthorized=after; Path=/; Secure"
      })).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("unauthorized")
      expect(result.right.session.kind).toBe("guest")
      expect(getSessionCookieHeader(result.right.session.session)).toContain("guest-unauthorized=after")
    }
  })

  it("rejects impossible public session health DTO states", () => {
    assertDecodeFailure(SessionHealthSchema, {
      session: makeReauthSnapshot(),
      status: "active"
    })
    assertDecodeFailure(SessionHealthSchema, {
      session: makeAuthenticatedSnapshot(),
      status: "reauth-required"
    })
    assertDecodeFailure(SessionHealthSchema, {
      session: makeAuthenticatedSnapshot(),
      status: "unauthorized"
    })
  })

  it.each([
    { body: "{", name: "malformed JSON" },
    { body: "[]", name: "schema drift" }
  ])("maps $name to schema-changed health", async ({ body }) => {
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(),
      makeResponseTransport(makeResponse(body)).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("schema-changed")
    }
  })

  it("maps missing CSRF to reauthentication-required for authenticated sessions", async () => {
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(" "),
      makeResponseTransport(makeResponse(JSON.stringify({
        authenticated: true
      }))).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("reauth-required")
    }
  })

  it.each([
    {
      expectedReason: "network",
      name: "network failures",
      transport: makeLeftTransport(secretTransportPayload)
    },
    {
      expectedReason: "network",
      name: "thrown network failures",
      transport: makeThrowingTransport(secretTransportPayload)
    },
    {
      expectedReason: "server",
      name: "server failures",
      transport: makeResponseTransport(makeResponse("{}", 500)).transport
    },
    {
      expectedReason: "persistence",
      name: "cookie persistence failures",
      transport: makeResponseTransport(makeResponse(
        JSON.stringify({
          authenticated: true
        }),
        200,
        {
          "set-cookie": "fresh-session=after; Path=/; Secure"
        }
      )).transport
    },
    {
      expectedReason: "persistence",
      name: "malformed response cookie failures",
      transport: makeResponseTransport(makeResponse(
        JSON.stringify({
          authenticated: true
        }),
        200,
        {
          "set-cookie": "bad cookie value"
        }
      )).transport
    }
  ])("maps $name to retry health", async ({ expectedReason, name, transport }) => {
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(),
      transport,
      name === "cookie persistence failures" ? failingSerializeCookieJarPort : undefined
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("retry")

      if (result.right.status === "retry") {
        expect(result.right.reason).toBe(expectedReason)
      }
    }
  })

  it("maps cookie jar restoration failures to retry health before network I/O", async () => {
    const fake = makeResponseTransport(makeResponse(JSON.stringify({
      authenticated: true
    })))
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(),
      fake.transport,
      failingDeserializeCookieJarPort
    )

    expect(Either.isRight(result)).toBe(true)
    expect(fake.requests()).toEqual([])

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("retry")

      if (result.right.status === "retry") {
        expect(result.right.reason).toBe("persistence")
      }

      expect(JSON.stringify(result.right)).not.toContain(secretTransportPayload)
    }
  })

  it("maps cookie jar restoration failures during Set-Cookie application to retry health", async () => {
    const fake = makeResponseTransport(makeResponse(
      JSON.stringify({
        authenticated: true
      }),
      200,
      {
        "set-cookie": "fresh-session=after; Path=/; Secure"
      }
    ))
    const result = await checkSessionHealth(
      makeAuthenticatedSnapshot(),
      fake.transport,
      makeFailingSecondDeserializeCookieJarPort()
    )

    expect(Either.isRight(result)).toBe(true)
    expect(fake.requests()).toHaveLength(1)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("retry")

      if (result.right.status === "retry") {
        expect(result.right.reason).toBe("persistence")
      }

      expect(JSON.stringify(result.right)).not.toContain(secretTransportPayload)
    }
  })

  it("maps guest network failures to retry health", async () => {
    const result = await checkSessionHealth(
      makeGuestSnapshot(),
      makeLeftTransport(secretTransportPayload)
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.status).toBe("retry")
      expect(result.right.session.kind).toBe("guest")

      if (result.right.status === "retry") {
        expect(result.right.reason).toBe("network")
      }
    }
  })
})
