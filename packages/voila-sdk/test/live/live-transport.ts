import { Effect, type Either, Layer } from "effect"

import {
  connectionFailure,
  type ResponseHeaders,
  responseReadFailure,
  VoilaTransport,
  type VoilaTransportRequest
} from "../../src/index.js"

const responseHeadersFromFetch = (headers: Headers): ResponseHeaders => {
  const setCookie = headers.getSetCookie()
  const headerEntries = Object.fromEntries(headers.entries())

  return setCookie.length === 0 ? headerEntries : { ...headerEntries, "set-cookie": setCookie }
}

const sendLiveRequest = (request: VoilaTransportRequest) => {
  const requestInitBase = { headers: request.headers, method: request.method, redirect: "manual" } satisfies RequestInit

  return fetch(request.url, request.body === undefined ? requestInitBase : { ...requestInitBase, body: request.body })
}

/**
 * The transport the live smokes run against: real `fetch`, no deadline, no
 * retry. Smokes are run by hand against a throwaway session, so what matters
 * here is that a failure is typed the way the SDK types it, not that it is
 * fast.
 */
export const liveTransportLayer: Layer.Layer<VoilaTransport> = Layer.succeed(VoilaTransport, {
  request: (request) =>
    Effect.flatMap(Effect.tryPromise({ catch: connectionFailure, try: () => sendLiveRequest(request) }), (response) =>
      Effect.map(Effect.tryPromise({ catch: responseReadFailure, try: () => response.text() }), (body) => ({
        body,
        headers: responseHeadersFromFetch(response.headers),
        status: response.status
      }))
    )
})

/**
 * Runs one live operation and hands back its either: a smoke reports a typed
 * failure and exits non-zero, it does not throw.
 */
export const runLive = <A, E>(effect: Effect.Effect<A, E, VoilaTransport>): Promise<Either.Either<A, E>> =>
  Effect.runPromise(Effect.either(Effect.provide(effect, liveTransportLayer)))
