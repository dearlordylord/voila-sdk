import { Effect, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  BrowserLoginErrorSchema,
  BrowserLoginResultSchema,
  BrowserLoginTimeoutMsSchema,
  type BrowserLoginPortError
} from "../../src/domain/schemas/index.js"
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

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token: secretCsrfToken }, cookieJar.success)

  if (Result.isFailure(session)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return session.success
}

const makePort = (
  result: Result.Result<unknown, BrowserLoginPortError>
): { readonly port: BrowserLoginPort; readonly requests: ReadonlyArray<unknown> } => {
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
  it("constrains browser-login timeouts to positive safe milliseconds", () => {
    expect(Schema.decodeUnknownSync(BrowserLoginTimeoutMsSchema)(1)).toBe(1)

    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => Schema.decodeUnknownSync(BrowserLoginTimeoutMsSchema)(value)).toThrow()
    }
  })

  it("captures an authenticated session through an injected browser port without password input", async () => {
    const fake = makePort(
      Result.succeed({ account: { emailHint: secretEmailHint }, authenticated: true, session: makeSession(true) })
    )

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(fake.port, { timeoutMs: 30_000 })))

    expect(Result.isSuccess(result)).toBe(true)
    expect(fake.requests).toHaveLength(1)
    expect(JSON.stringify(fake.requests[0])).not.toContain("password")
    expect(JSON.stringify(fake.requests[0])).not.toContain("secret")
    expect(fake.requests[0]).toEqual({ loginUrl: voilaUrl, timeoutMs: 30_000 })

    if (Result.isSuccess(result)) {
      expect(Result.isSuccess(Schema.decodeUnknownResult(BrowserLoginResultSchema)(result.success))).toBe(true)
      expect(result.success.session.kind).toBe("authenticated")
      expect(result.success.session.state).toBe("authenticated")
      expect(result.success.session.account?.emailHint).toBe(secretEmailHint)
    }
  })

  it("returns a typed cancellation error from the injected browser port", async () => {
    const fake = makePort(
      Result.fail({
        _tag: "BrowserLoginUserCancelled",
        message: `User cancelled interactive browser login with ${secretCookieValue}`
      })
    )

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(fake.port)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(Result.isSuccess(Schema.decodeUnknownResult(BrowserLoginErrorSchema)(result.failure))).toBe(true)
      expect(result.failure._tag).toBe("BrowserLoginUserCancelled")
      expect(JSON.stringify(result.failure)).not.toContain(secretCookieValue)
    }
  })

  it("returns a typed timeout error from the injected browser port", async () => {
    const fake = makePort(
      Result.fail({
        _tag: "BrowserLoginTimedOut",
        message: `Interactive browser login timed out with ${secretCookieValue}`
      })
    )

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(fake.port, { timeoutMs: 1 })))

    expect(Result.isFailure(result)).toBe(true)
    expect(fake.requests).toEqual([{ loginUrl: voilaUrl, timeoutMs: 1 }])

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginTimedOut")
      expect(JSON.stringify(result.failure)).not.toContain(secretCookieValue)
    }
  })

  it("rejects completed browser captures that do not include session cookies", async () => {
    const fake = makePort(Result.succeed({ authenticated: true, session: makeSession(false) }))

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(fake.port)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginMissingCookies")
      expect(JSON.stringify(result.failure)).not.toContain(secretCsrfToken)
    }
  })

  it("rejects completed browser captures without authenticated account evidence", async () => {
    const fake = makePort(Result.succeed({ authenticated: false, session: makeSession(true) }))

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(fake.port)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginNotAuthenticated")
      expect(JSON.stringify(result.failure)).not.toContain(secretCookieValue)
    }
  })

  it("rejects invalid browser login options before invoking the port", async () => {
    const fake = makePort(Result.succeed({ session: makeSession(true) }))

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(fake.port, { timeoutMs: 0 })))

    expect(Result.isFailure(result)).toBe(true)
    expect(fake.requests).toEqual([])

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginOptionsInvalid")
    }
  })

  it("rejects malformed browser capture payloads without leaking captured secrets", async () => {
    const fake = makePort(Result.succeed({ session: { csrf: { token: secretCsrfToken } } }))

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(fake.port)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginCaptureInvalid")
      expect(JSON.stringify(result.failure)).not.toContain(secretCsrfToken)
    }
  })

  it("redacts thrown adapter failures into typed errors", async () => {
    const port: BrowserLoginPort = {
      captureSession: async () => {
        throw new Error(secretAdapterPayload)
      }
    }

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(port)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.failure)).not.toContain(secretAdapterPayload)
    }
  })

  it("redacts malformed non-Result adapter results into typed errors", async () => {
    const port: BrowserLoginPort = { captureSession: async () => secretAdapterPayload }

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(port)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginAdapterFailure")
      expect(result.failure.message).toBe("Browser login adapter failed before returning a typed result")
      expect(JSON.stringify(result.failure)).not.toContain(secretAdapterPayload)
    }
  })

  it.each([undefined, null])("redacts missing adapter result %s into typed errors", async (adapterResult) => {
    const port: BrowserLoginPort = { captureSession: async () => adapterResult }

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(port)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginAdapterFailure")
      expect(result.failure.message).toBe("Browser login adapter failed before returning a typed result")
    }
  })

  it("redacts malformed adapter-left errors into typed errors", async () => {
    const port: BrowserLoginPort = {
      captureSession: async () => Result.fail({ _tag: "UnexpectedAdapterFailure", message: secretAdapterPayload })
    }

    const result = await Effect.runPromise(Effect.result(loginWithBrowser(port)))

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("BrowserLoginAdapterFailure")
      expect(result.failure.message).toBe("Browser login adapter failed before returning a typed result")
      expect(JSON.stringify(result.failure)).not.toContain(secretAdapterPayload)
    }
  })
})
