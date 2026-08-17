import { HttpClient, HttpClientError, HttpClientResponse } from "@effect/platform"
import { VoilaTransport, type VoilaTransportRequest, type VoilaTransportResponse } from "@firfi/voila-sdk"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, TestClock } from "effect"
import topDesktopUserAgents from "top-user-agents/desktop"
import { describe, expect } from "vitest"

import { defaultRequestTimeoutMs, voilaTransportLayer } from "../src/node-transport.js"

const requestUrl = new URL("https://voila.ca/api/example")
const secretCookie = "voila-session=secret-cookie"

const firstDesktopUserAgent = (): string => {
  const userAgent = topDesktopUserAgents.at(0)

  if (userAgent === undefined) throw new Error("Expected the desktop user-agent dataset to be non-empty")

  return userAgent
}

interface RecordingClient {
  readonly layer: Layer.Layer<HttpClient.HttpClient>
  readonly requestHeaders: ReadonlyArray<Readonly<Record<string, string>>>
}

const recordingClient = (body = "{}", status = 200): RecordingClient => {
  const headers: Array<Readonly<Record<string, string>>> = []

  return {
    layer: Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        headers.push(request.headers)

        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status })))
      })
    ),
    requestHeaders: headers
  }
}

const failingClient = (): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.fail(new HttpClientError.RequestError({ description: secretCookie, reason: "Transport", request }))
    )
  )

/**
 * A request that never answers, and that records whether it was cancelled. The
 * canceler is the point of the test: a deadline that only abandons the waiting
 * fiber leaves the socket open, and the held session-file lock with it.
 */
const hangingClient = (
  started: Deferred.Deferred<void>
): { readonly cancellations: ReadonlyArray<boolean>; readonly layer: Layer.Layer<HttpClient.HttpClient> } => {
  const cancellations: Array<boolean> = []

  return {
    cancellations,
    layer: Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() =>
        Effect.async(() => {
          // the deadline starts when the request does, so a test waits for this
          // rather than for the clock to be advanced at a hopeful moment
          Deferred.unsafeDone(started, Effect.void)

          return Effect.sync(() => {
            cancellations.push(true)
          })
        })
      )
    )
  }
}

/**
 * Headers arrive, the body never finishes. The deadline must cover the body
 * read too: a response that stalls after its headers holds the session-file
 * lock exactly as long as one that never answers.
 */
const stallingBodyClient = (started: Deferred.Deferred<void>): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            new ReadableStream({
              start: () => {
                Deferred.unsafeDone(started, Effect.void)
              }
            }),
            { status: 200 }
          )
        )
      )
    )
  )

const runTransport = (client: Layer.Layer<HttpClient.HttpClient>, userAgent?: string, timeoutMs?: number) =>
  runRequest(
    client,
    { headers: { "x-request-context": "preserved" }, method: "GET", url: requestUrl },
    userAgent,
    timeoutMs
  )

const runRequest = (
  client: Layer.Layer<HttpClient.HttpClient>,
  request: VoilaTransportRequest,
  userAgent?: string,
  timeoutMs?: number
) =>
  Effect.flatMap(VoilaTransport, (transport) => transport.request(request)).pipe(
    Effect.provide(Layer.provide(voilaTransportLayer(userAgent, timeoutMs), client))
  )

describe("Effect-native Voila transport", () => {
  it.effect("uses the first desktop user-agent by default and preserves unrelated headers", () =>
    Effect.gen(function* () {
      const client = recordingClient()

      yield* runTransport(client.layer)

      expect(client.requestHeaders[0]?.["user-agent"]).toBe(firstDesktopUserAgent())
      expect(client.requestHeaders[0]?.["x-request-context"]).toBe("preserved")
    })
  )

  it.effect("uses the configured user-agent when one is given", () =>
    Effect.gen(function* () {
      const client = recordingClient()

      yield* runTransport(client.layer, "configured-agent/1.0")

      expect(client.requestHeaders[0]?.["user-agent"]).toBe("configured-agent/1.0")
    })
  )

  it.effect("lets an explicit request user-agent override configuration case-insensitively", () =>
    Effect.gen(function* () {
      const client = recordingClient()

      yield* runRequest(
        client.layer,
        {
          headers: { "User-Agent": "request-agent/2.0", "x-request-context": "preserved" },
          method: "GET",
          url: requestUrl
        },
        "configured-agent/1.0"
      )

      expect(client.requestHeaders[0]?.["user-agent"]).toBe("request-agent/2.0")
      expect(client.requestHeaders[0]?.["x-request-context"]).toBe("preserved")
    })
  )

  it.effect("sends a JSON write with the content type the request asked for", () =>
    Effect.gen(function* () {
      const client = recordingClient()

      yield* runRequest(client.layer, {
        body: '[{"productId":"product-id","quantity":1}]',
        headers: { "content-type": "application/json" },
        method: "POST",
        url: requestUrl
      })

      expect(client.requestHeaders[0]?.["content-type"]).toBe("application/json")
    })
  )

  it.effect("falls back to a text body when a request states no content type", () =>
    Effect.gen(function* () {
      const client = recordingClient()

      yield* runRequest(client.layer, { body: "plain body", headers: {}, method: "POST", url: requestUrl })

      expect(client.requestHeaders[0]?.["content-type"]).toBe("text/plain")
    })
  )

  it.effect("abandons a response whose body stalls after its headers arrive", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const pending = yield* Effect.fork(Effect.flip(runTransport(stallingBodyClient(started), undefined, 500)))

      yield* Deferred.await(started)
      yield* TestClock.adjust("1 second")

      expect((yield* Fiber.join(pending))._tag).toBe("VoilaRequestDeadlineExceeded")
    })
  )

  it.effect("returns the response body, status, and headers", () =>
    Effect.gen(function* () {
      const response: VoilaTransportResponse = yield* runTransport(recordingClient('{"ok":true}', 201).layer)

      expect(response.status).toBe(201)
      expect(response.body).toBe('{"ok":true}')
    })
  )

  it.effect("fails a refused connection with its own tag and no request material", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(runTransport(failingClient()))

      expect(failure._tag).toBe("VoilaConnectionFailure")
      expect(JSON.stringify(failure)).not.toContain(secretCookie)
      expect(JSON.stringify(failure)).not.toContain(requestUrl.href)
    })
  )

  it.effect("abandons a request at its deadline and cancels the underlying request", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const client = hangingClient(started)
      const pending = yield* Effect.fork(Effect.flip(runTransport(client.layer, undefined, 500)))

      yield* Deferred.await(started)
      yield* TestClock.adjust("1 second")

      const failure = yield* Fiber.join(pending)

      expect(failure._tag).toBe("VoilaRequestDeadlineExceeded")
      expect(client.cancellations).toEqual([true])
      expect(JSON.stringify(failure)).not.toContain(requestUrl.href)
    })
  )

  it.effect("does not abandon a request before its deadline", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const client = hangingClient(started)
      const pending = yield* Effect.fork(runTransport(client.layer, undefined, defaultRequestTimeoutMs))

      yield* Deferred.await(started)
      yield* TestClock.adjust(`${defaultRequestTimeoutMs - 1} millis`)

      expect(client.cancellations).toEqual([])

      yield* Fiber.interrupt(pending)
    })
  )
})
