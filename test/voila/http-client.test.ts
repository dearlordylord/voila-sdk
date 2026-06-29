import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"

import type {
  CookieJarPort,
  CookieJarPortError,
  SessionSnapshot,
  VoilaTransport,
  VoilaTransportRequest,
  VoilaTransportResponse
} from "../../src/index.js"
import {
  makeSessionSnapshot,
  requestVoilaJson,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"

const OkResponseSchema = Schema.Struct({
  ok: Schema.Boolean
})

const voilaUrl = new URL("/api/example", VOILA_BASE_URL)
const csrfToken = "csrf-token"
const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const cookieImportFailure = {
  _tag: "CookieJarSnapshotImportFailed",
  message: "cannot import jar with voila-session=secret-cookie"
} satisfies CookieJarPortError

const cookieSerializationFailure = {
  _tag: "CookieJarSerializationFailed",
  message: "cannot serialize jar with csrf-token"
} satisfies CookieJarPortError

const okResponse = {
  body: "{\"ok\":true}",
  headers: {},
  status: 200
} satisfies VoilaTransportResponse

const makeSession = (token: string = csrfToken): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=before; Path=/; Secure", VOILA_BASE_URL)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const snapshot = makeSessionSnapshot(sampleMetadata, { token }, cookieJar.right)

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return snapshot.right
}

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
  deserialize: () => Either.left(cookieImportFailure),
  serialize: toughCookieJarPort.serialize
}

const failingSerializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: toughCookieJarPort.deserialize,
  serialize: () => Either.left(cookieSerializationFailure)
}

const getRestoredCookieString = (session: SessionSnapshot): string => {
  const jar = toughCookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    throw new Error("Expected cookie jar deserialization to succeed")
  }

  return jar.right.getCookieStringSync(VOILA_BASE_URL)
}

describe("requestVoilaJson", () => {
  it("sends Voila headers and cookies, decodes JSON, and persists set-cookie values", async () => {
    const fake = makeResponseTransport({
      body: "{\"ok\":true}",
      headers: {
        "Set-Cookie": ["fresh-cookie=after; Path=/; Secure"]
      },
      status: 200
    })

    const result = await requestVoilaJson(OkResponseSchema, makeSession(), {
      method: "GET",
      url: voilaUrl
    }, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(result.right.value).toEqual({ ok: true })
      expect(request?.headers["X-CSRF-TOKEN"]).toBe(csrfToken)
      expect(request?.headers["client-route-id"]).toBe(sampleMetadata.clientRouteId)
      expect(request?.headers.cookie).toContain("voila-session=before")
      expect(getRestoredCookieString(result.right.session)).toContain("fresh-cookie=after")
    }
  })

  it("omits the cookie header when the session jar has no cookies", async () => {
    const emptyCookieJar = serializeCookieJar(toughCookieJarPort.create())

    expect(Either.isRight(emptyCookieJar)).toBe(true)

    if (Either.isRight(emptyCookieJar)) {
      const session = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, emptyCookieJar.right)
      const fake = makeResponseTransport(okResponse)

      expect(Either.isRight(session)).toBe(true)

      if (Either.isRight(session)) {
        const result = await requestVoilaJson(OkResponseSchema, session.right, {
          method: "GET",
          url: voilaUrl
        }, fake.transport)
        const [request] = fake.requests()

        expect(Either.isRight(result)).toBe(true)
        expect(request?.headers.cookie).toBeUndefined()
      }
    }
  })

  it("accepts a single set-cookie header value", async () => {
    const fake = makeResponseTransport({
      body: "{\"ok\":true}",
      headers: {
        "set-cookie": "single-cookie=after; Path=/; Secure"
      },
      status: 200
    })

    const result = await requestVoilaJson(OkResponseSchema, makeSession(), {
      method: "POST",
      url: voilaUrl
    }, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(getRestoredCookieString(result.right.session)).toContain("single-cookie=after")
    }
  })

  it("forwards request bodies to the injected transport", async () => {
    const fake = makeResponseTransport(okResponse)
    const result = await requestVoilaJson(OkResponseSchema, makeSession(), {
      body: "{\"query\":\"milk\"}",
      method: "POST",
      url: voilaUrl
    }, fake.transport)
    const [request] = fake.requests()

    expect(Either.isRight(result)).toBe(true)
    expect(request?.body).toBe("{\"query\":\"milk\"}")
  })

  it("ignores undefined set-cookie header values", async () => {
    const fake = makeResponseTransport({
      body: "{\"ok\":true}",
      headers: {
        "set-cookie": undefined
      },
      status: 200
    })

    const result = await requestVoilaJson(OkResponseSchema, makeSession(), {
      method: "GET",
      url: voilaUrl
    }, fake.transport)

    expect(Either.isRight(result)).toBe(true)
  })

  it("returns a typed redacted error for malformed set-cookie header values", async () => {
    const result = await requestVoilaJson(
      OkResponseSchema,
      makeSession(),
      {
        method: "GET",
        url: voilaUrl
      },
      makeResponseTransport({
        body: "{\"ok\":true}",
        headers: {
          "set-cookie": "bad cookie value"
        },
        status: 200
      }).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSessionPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain("bad cookie value")
    }
  })

  it("returns a typed error when CSRF is missing", async () => {
    const fake = makeResponseTransport(okResponse)
    const result = await requestVoilaJson(OkResponseSchema, makeSession(" "), {
      method: "GET",
      url: voilaUrl
    }, fake.transport)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMissingCsrfToken")
    }
  })

  it("returns a typed error for non-Voila origins", async () => {
    const result = await requestVoilaJson(OkResponseSchema, makeSession(), {
      method: "GET",
      url: new URL("https://example.com/api")
    }, makeResponseTransport(okResponse).transport)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaUnsupportedOrigin")
    }
  })

  it("returns a typed error for cookie jar restore failures", async () => {
    const result = await requestVoilaJson(
      OkResponseSchema,
      makeSession(),
      {
        method: "GET",
        url: voilaUrl
      },
      makeResponseTransport(okResponse).transport,
      failingDeserializeCookieJarPort
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSessionPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain("secret-cookie")
    }
  })

  it("returns a typed error for cookie jar persistence failures", async () => {
    const result = await requestVoilaJson(
      OkResponseSchema,
      makeSession(),
      {
        method: "GET",
        url: voilaUrl
      },
      makeResponseTransport(okResponse).transport,
      failingSerializeCookieJarPort
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSessionPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain("csrf-token")
    }
  })

  it("returns a typed error when the transport throws", async () => {
    const result = await requestVoilaJson(OkResponseSchema, makeSession(), {
      method: "GET",
      url: voilaUrl
    }, makeThrowingTransport(new Error("socket failed")))

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNetworkFailure")
      expect(result.left.message).toBe("Voila network request failed")
      expect(JSON.stringify(result.left)).not.toContain("socket failed")
    }
  })

  it("returns a typed error when the transport returns a failure", async () => {
    const result = await requestVoilaJson(OkResponseSchema, makeSession(), {
      method: "GET",
      url: voilaUrl
    }, makeLeftTransport("secret transport payload"))

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNetworkFailure")
      expect(result.left.message).toBe("Voila network request failed")
      expect(JSON.stringify(result.left)).not.toContain("secret transport payload")
    }
  })

  it.each([401, 403])("returns a typed error for unauthorized status %s", async (status) => {
    const result = await requestVoilaJson(
      OkResponseSchema,
      makeSession(),
      {
        method: "GET",
        url: voilaUrl
      },
      makeResponseTransport({
        body: "{}",
        headers: {},
        status
      }).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaUnauthorizedSession")
    }
  })

  it("returns a typed error for non-2xx responses", async () => {
    const result = await requestVoilaJson(
      OkResponseSchema,
      makeSession(),
      {
        method: "GET",
        url: voilaUrl
      },
      makeResponseTransport({
        body: "{}",
        headers: {},
        status: 500
      }).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })

  it("returns a typed error for malformed JSON", async () => {
    const result = await requestVoilaJson(
      OkResponseSchema,
      makeSession(),
      {
        method: "GET",
        url: voilaUrl
      },
      makeResponseTransport({
        body: "{",
        headers: {},
        status: 200
      }).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMalformedJson")
    }
  })

  it("returns a typed error for schema decode failures", async () => {
    const result = await requestVoilaJson(
      OkResponseSchema,
      makeSession(),
      {
        method: "GET",
        url: voilaUrl
      },
      makeResponseTransport({
        body: "{\"ok\":\"yes\"}",
        headers: {},
        status: 200
      }).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
      expect(JSON.stringify(result.left)).not.toContain("yes")
    }
  })
})
