import { Either, Schema } from "effect"
import { CookieJar, Store } from "tough-cookie"
import { describe, expect, it } from "vitest"

import type {
  CookieJarPort,
  CookieJarPortError,
  SessionSnapshot,
  VoilaHttpRequest,
  VoilaTransportResponse
} from "../../src/index.js"
import {
  makeSessionSnapshot,
  requestVoilaJson,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"
import {
  connectionFailureTransport,
  deadlineExceededTransport,
  respondingTransport,
  responseReadFailureTransport,
  runWith
} from "../helpers/transport.js"

const OkResponseSchema = Schema.Struct({ ok: Schema.Boolean })

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

const okResponse = { body: '{"ok":true}', headers: {}, status: 200 } satisfies VoilaTransportResponse

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

/**
 * A jar whose store is asynchronous: tough-cookie's synchronous read throws
 * rather than returning, which is the defect path the pipeline must turn into
 * a typed failure.
 */
const asyncStoreCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: () => Either.right(new CookieJar(new Store())),
  serialize: toughCookieJarPort.serialize
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
    const fake = respondingTransport({
      body: '{"ok":true}',
      headers: { "Set-Cookie": ["fresh-cookie=after; Path=/; Secure"] },
      status: 200
    })

    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      fake
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests

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
      const fake = respondingTransport(okResponse)

      expect(Either.isRight(session)).toBe(true)

      if (Either.isRight(session)) {
        const result = await runWith(
          requestVoilaJson(OkResponseSchema, session.right, { method: "GET", url: voilaUrl }),
          fake
        )
        const [request] = fake.requests

        expect(Either.isRight(result)).toBe(true)
        expect(request?.headers.cookie).toBeUndefined()
      }
    }
  })

  it("accepts a single set-cookie header value", async () => {
    const fake = respondingTransport({
      body: '{"ok":true}',
      headers: { "set-cookie": "single-cookie=after; Path=/; Secure" },
      status: 200
    })

    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "POST", url: voilaUrl }),
      fake
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(getRestoredCookieString(result.right.session)).toContain("single-cookie=after")
    }
  })

  it("forwards request bodies to the injected transport", async () => {
    const fake = respondingTransport(okResponse)
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { body: '{"query":"milk"}', method: "POST", url: voilaUrl }),
      fake
    )
    const [request] = fake.requests

    expect(Either.isRight(result)).toBe(true)
    expect(request?.body).toBe('{"query":"milk"}')
  })

  it("ignores undefined set-cookie header values", async () => {
    const fake = respondingTransport({ body: '{"ok":true}', headers: { "set-cookie": undefined }, status: 200 })

    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      fake
    )

    expect(Either.isRight(result)).toBe(true)
  })

  it("returns a typed redacted error for malformed set-cookie header values", async () => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      respondingTransport({ body: '{"ok":true}', headers: { "set-cookie": "bad cookie value" }, status: 200 })
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSessionPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain("bad cookie value")
    }
  })

  it("returns a typed error when CSRF is missing", async () => {
    const fake = respondingTransport(okResponse)
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(" "), { method: "GET", url: voilaUrl }),
      fake
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMissingCsrfToken")
    }
  })

  it("returns a typed error for non-Voila origins", async () => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: new URL("https://example.com/api") }),
      respondingTransport(okResponse)
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaUnsupportedOrigin")
    }
  })

  it("returns a typed error for cookie jar restore failures", async () => {
    const result = await runWith(
      requestVoilaJson(
        OkResponseSchema,
        makeSession(),
        { method: "GET", url: voilaUrl },
        failingDeserializeCookieJarPort
      ),
      respondingTransport(okResponse)
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSessionPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain("secret-cookie")
    }
  })

  it("returns a typed error when the restored jar cannot be read synchronously", async () => {
    const transport = respondingTransport(okResponse)
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }, asyncStoreCookieJarPort),
      transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSessionPersistenceFailure")
    }

    // the failure happens before the request: nothing is sent with no cookie
    expect(transport.requests).toEqual([])
  })

  it("returns a typed error for cookie jar persistence failures", async () => {
    const result = await runWith(
      requestVoilaJson(
        OkResponseSchema,
        makeSession(),
        { method: "GET", url: voilaUrl },
        failingSerializeCookieJarPort
      ),
      respondingTransport(okResponse)
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSessionPersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain("csrf-token")
    }
  })

  it("surfaces each transport failure with its own tag and no request material", async () => {
    const request: VoilaHttpRequest = {
      method: "GET",
      url: new URL("/api/orders/secret-order-id?token=secret-query", VOILA_BASE_URL)
    }
    const cases = [
      { expected: "VoilaConnectionFailure", transport: connectionFailureTransport() },
      { expected: "VoilaRequestDeadlineExceeded", transport: deadlineExceededTransport() },
      { expected: "VoilaResponseReadFailure", transport: responseReadFailureTransport() }
    ] as const

    for (const { expected, transport } of cases) {
      const result = await runWith(requestVoilaJson(OkResponseSchema, makeSession(), request), transport)

      expect(Either.isLeft(result)).toBe(true)

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe(expected)
        expect(JSON.stringify(result.left)).not.toContain("secret-order-id")
        expect(JSON.stringify(result.left)).not.toContain("secret-query")
        expect(JSON.stringify(result.left)).not.toContain(csrfToken)
      }
    }
  })

  it.each([401, 403])("returns a typed error for unauthorized status %s", async (status) => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      respondingTransport({ body: "{}", headers: {}, status })
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaUnauthorizedSession")
    }
  })

  it.each([403, 503])("returns redacted WAF diagnostics for a known blocked response at status %s", async (status) => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), {
        method: "GET",
        url: new URL("/api/orders/secret-order-id/decorated?token=secret-query", VOILA_BASE_URL)
      }),
      respondingTransport({
        body: "<HTML><HEAD><TITLE>ERROR: The request could not be satisfied</TITLE></HEAD><BODY><H1>403 ERROR</H1>Request blocked.</BODY></HTML>",
        headers: { "set-cookie": "secret-cookie=must-not-leak", "x-amz-cf-id": "safe-edge-request-id" },
        status
      })
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaRequestBlocked")

      if (result.left._tag === "VoilaRequestBlocked") {
        expect(result.left).toEqual({
          _tag: "VoilaRequestBlocked",
          edgeRequestId: "safe-edge-request-id",
          message: "Voila request was blocked",
          method: "GET",
          status
        })
        expect(JSON.stringify(result.left)).not.toContain("secret-cookie")
        expect(JSON.stringify(result.left)).not.toContain("secret-order-id")
        expect(JSON.stringify(result.left)).not.toContain("secret-query")
      }
    }
  })

  it.each([
    [403, "VoilaUnauthorizedSession"],
    [503, "VoilaNon2xxResponse"]
  ])("does not classify a generic blocked phrase as a WAF response at status %s", async (status, expectedTag) => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      respondingTransport({ body: "The request blocked a downstream operation", headers: {}, status })
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(expectedTag)
    }
  })

  it("does not classify the known WAF body at an undocumented status", async () => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      respondingTransport({
        body: "<HTML><HEAD><TITLE>ERROR: The request could not be satisfied</TITLE></HEAD><BODY>Request blocked.</BODY></HTML>",
        headers: {},
        status: 500
      })
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })

  it("returns a typed error for non-2xx responses", async () => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      respondingTransport({ body: "{}", headers: {}, status: 500 })
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })

  it("returns a typed error for malformed JSON", async () => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      respondingTransport({ body: "{", headers: {}, status: 200 })
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMalformedJson")
    }
  })

  it("returns a typed error for schema decode failures", async () => {
    const result = await runWith(
      requestVoilaJson(OkResponseSchema, makeSession(), { method: "GET", url: voilaUrl }),
      respondingTransport({ body: '{"ok":"yes"}', headers: {}, status: 200 })
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
      expect(JSON.stringify(result.left)).not.toContain("yes")
    }
  })
})
