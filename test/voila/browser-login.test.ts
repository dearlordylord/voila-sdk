import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { BrowserLoginPortError } from "../../src/domain/schemas/index.js"
import type { BrowserLoginPort } from "../../src/voila/browser-login.js"
import { loginWithBrowser } from "../../src/voila/browser-login.js"
import { makeSessionSnapshot, serializeCookieJar, toughCookieJarPort } from "../../src/voila/session-snapshot.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "secret-cookie-value"
const secretCsrfToken = "secret-csrf-token"
const secretEmailHint = "secret@example.test"
const secretAdapterPayload = "adapter-secret-payload"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const makeSession = (withCookies: boolean) => {
  const jar = toughCookieJarPort.create()

  if (withCookies) {
    jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)
  }

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

const makePort = (
  result: Either.Either<unknown, BrowserLoginPortError>
): {
  readonly port: BrowserLoginPort
  readonly requests: ReadonlyArray<unknown>
} => {
  const requests: Array<unknown> = []

  return {
    port: {
      captureSession: async (request) => {
        requests.push(request)

        return result
      }
    },
    requests
  }
}

describe("browser login port", () => {
  it("captures an authenticated session through an injected browser port without password input", async () => {
    const fake = makePort(Either.right({
      account: {
        emailHint: secretEmailHint
      },
      authenticated: true,
      session: makeSession(true)
    }))

    const result = await loginWithBrowser(fake.port, { timeoutMs: 30_000 })

    expect(Either.isRight(result)).toBe(true)
    expect(fake.requests).toHaveLength(1)
    expect(JSON.stringify(fake.requests[0])).not.toContain("password")
    expect(JSON.stringify(fake.requests[0])).not.toContain("secret")
    expect(fake.requests[0]).toEqual({
      loginUrl: voilaUrl,
      timeoutMs: 30_000
    })

    if (Either.isRight(result)) {
      expect(result.right.session.kind).toBe("authenticated")
      expect(result.right.session.state).toBe("authenticated")
      expect(result.right.session.account?.emailHint).toBe(secretEmailHint)
    }
  })

  it("returns a typed cancellation error from the injected browser port", async () => {
    const fake = makePort(Either.left({
      _tag: "BrowserLoginUserCancelled",
      message: `User cancelled interactive browser login with ${secretCookieValue}`
    }))

    const result = await loginWithBrowser(fake.port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginUserCancelled")
      expect(JSON.stringify(result.left)).not.toContain(secretCookieValue)
    }
  })

  it("returns a typed timeout error from the injected browser port", async () => {
    const fake = makePort(Either.left({
      _tag: "BrowserLoginTimedOut",
      message: `Interactive browser login timed out with ${secretCookieValue}`
    }))

    const result = await loginWithBrowser(fake.port, { timeoutMs: 1 })

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests).toEqual([{
      loginUrl: voilaUrl,
      timeoutMs: 1
    }])

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginTimedOut")
      expect(JSON.stringify(result.left)).not.toContain(secretCookieValue)
    }
  })

  it("rejects completed browser captures that do not include session cookies", async () => {
    const fake = makePort(Either.right({
      authenticated: true,
      session: makeSession(false)
    }))

    const result = await loginWithBrowser(fake.port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginMissingCookies")
      expect(JSON.stringify(result.left)).not.toContain(secretCsrfToken)
    }
  })

  it("rejects completed browser captures without authenticated account evidence", async () => {
    const fake = makePort(Either.right({
      authenticated: false,
      session: makeSession(true)
    }))

    const result = await loginWithBrowser(fake.port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginNotAuthenticated")
      expect(JSON.stringify(result.left)).not.toContain(secretCookieValue)
    }
  })

  it("rejects invalid browser login options before invoking the port", async () => {
    const fake = makePort(Either.right({
      session: makeSession(true)
    }))

    const result = await loginWithBrowser(fake.port, { timeoutMs: 0 })

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests).toEqual([])

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginOptionsInvalid")
    }
  })

  it("rejects malformed browser capture payloads without leaking captured secrets", async () => {
    const fake = makePort(Either.right({
      session: {
        csrf: {
          token: secretCsrfToken
        }
      }
    }))

    const result = await loginWithBrowser(fake.port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginCaptureInvalid")
      expect(JSON.stringify(result.left)).not.toContain(secretCsrfToken)
    }
  })

  it("redacts thrown adapter failures into typed errors", async () => {
    const port: BrowserLoginPort = {
      captureSession: async () => {
        throw new Error(secretAdapterPayload)
      }
    }

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretAdapterPayload)
    }
  })

  it("redacts malformed non-Either adapter results into typed errors", async () => {
    const port: BrowserLoginPort = {
      captureSession: async () => secretAdapterPayload
    }

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(result.left.message).toBe("Browser login adapter failed before returning a typed result")
      expect(JSON.stringify(result.left)).not.toContain(secretAdapterPayload)
    }
  })

  it.each([undefined, null])("redacts missing adapter result %s into typed errors", async (adapterResult) => {
    const port: BrowserLoginPort = {
      captureSession: async () => adapterResult
    }

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(result.left.message).toBe("Browser login adapter failed before returning a typed result")
    }
  })

  it("redacts malformed adapter-left errors into typed errors", async () => {
    const port: BrowserLoginPort = {
      captureSession: async () =>
        Either.left({
          _tag: "UnexpectedAdapterFailure",
          message: secretAdapterPayload
        })
    }

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(result.left.message).toBe("Browser login adapter failed before returning a typed result")
      expect(JSON.stringify(result.left)).not.toContain(secretAdapterPayload)
    }
  })
})
