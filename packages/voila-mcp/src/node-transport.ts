import { NodeHttpClient } from "@effect/platform-node"
import {
  connectionFailure,
  getHeaderValues,
  requestDeadlineExceeded,
  responseReadFailure,
  VoilaTransport,
  type VoilaTransportRequest,
  type VoilaTransportResponse
} from "@firfi/voila-sdk"

import { Effect, Layer } from "effect"
import { HttpBody as Body, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"

import topDesktopUserAgents from "top-user-agents/desktop"

/**
 * How long one Voila request may take before it is abandoned. A request runs
 * inside the session file cycle and holds that file's lock while it does, so
 * an unbounded request is not one slow tool call — it is every tool call in
 * the process waiting behind it. Generous enough for the slowest observed
 * endpoints (decorated order details, large category pages); Node's own
 * defaults are roughly ten times this.
 */
export const defaultRequestTimeoutMs = 30_000

const contentTypeHeader = "content-type"

const getMostPopularUserAgent = (): string => {
  const [mostPopularUserAgent] = topDesktopUserAgents

  if (mostPopularUserAgent === undefined) {
    throw new Error("top-user-agents/desktop returned an empty list")
  }

  return mostPopularUserAgent
}

const withUserAgent = (
  headers: VoilaTransportRequest["headers"],
  configuredUserAgent?: string
): Readonly<Record<string, string>> =>
  Object.keys(headers).some((name) => name.toLowerCase() === "user-agent")
    ? headers
    : { ...headers, "user-agent": configuredUserAgent ?? getMostPopularUserAgent() }

/**
 * The body carries the content type, because the client applies the body after
 * the headers and a body built without one rewrites `content-type` to
 * `text/plain` — which Voila answers with a 400 on every JSON write.
 */
const makeRequestBody = (request: VoilaTransportRequest, body: string): Body.HttpBody => {
  const [contentType] = getHeaderValues(request.headers, contentTypeHeader)

  return contentType === undefined ? Body.text(body) : Body.text(body, contentType)
}

const makeClientRequest = (
  request: VoilaTransportRequest,
  configuredUserAgent?: string
): HttpClientRequest.HttpClientRequest =>
  HttpClientRequest.make(request.method)(request.url, {
    ...(request.body === undefined ? {} : { body: makeRequestBody(request, request.body) }),
    headers: withUserAgent(request.headers, configuredUserAgent)
  })

const makeTransportResponse = (
  response: HttpClientResponse.HttpClientResponse,
  body: string
): VoilaTransportResponse => ({ body, headers: response.headers, status: response.status })

/**
 * The transport, over Effect's unstable `HttpClient`. The body is read under
 * the same deadline as the headers: a response whose headers arrive and whose
 * body then stalls is the same held lock as one that never answers at all.
 *
 * The deadline is an Effect timeout, so it runs on the Effect Clock (a test
 * drives it with `TestClock`, never wall-clock) and interrupting the waiting
 * fiber aborts the underlying request rather than leaving it in flight.
 */
export const voilaTransportLayer = (
  configuredUserAgent?: string,
  timeoutMs: number = defaultRequestTimeoutMs
): Layer.Layer<VoilaTransport, never, HttpClient.HttpClient> =>
  Layer.effect(
    VoilaTransport,
    Effect.map(HttpClient.HttpClient, (client) => ({
      request: (request: VoilaTransportRequest) =>
        client.execute(makeClientRequest(request, configuredUserAgent)).pipe(
          Effect.mapError(connectionFailure),
          Effect.flatMap((response) =>
            Effect.map(Effect.mapError(response.text, responseReadFailure), (body) =>
              makeTransportResponse(response, body)
            )
          ),
          Effect.scoped,
          Effect.timeoutOrElse({
            duration: `${timeoutMs} millis`,
            orElse: () => Effect.fail(requestDeadlineExceeded(timeoutMs))
          })
        )
    }))
  )

export const nodeVoilaTransportLayer = (
  configuredUserAgent?: string,
  timeoutMs?: number
): Layer.Layer<VoilaTransport> =>
  Layer.provide(voilaTransportLayer(configuredUserAgent, timeoutMs), NodeHttpClient.layerNodeHttp)
