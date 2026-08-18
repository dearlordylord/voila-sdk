import { Effect, type Result, Layer } from "effect"

import {
  connectionFailure,
  requestDeadlineExceeded,
  responseReadFailure,
  VoilaTransport,
  type VoilaTransportError,
  type VoilaTransportRequest,
  type VoilaTransportResponse
} from "../../src/index.js"

export interface StubTransport {
  readonly layer: Layer.Layer<VoilaTransport>
  readonly requests: ReadonlyArray<VoilaTransportRequest>
}

/**
 * The dependency-injection seam every transport-facing test uses: a real
 * implementation of the port, provided through the tag. Recording the requests
 * is the point — a test that cannot see what was sent cannot assert that the
 * CSRF header and the cookie made it onto the wire.
 */
export const stubTransport = (
  respond: (request: VoilaTransportRequest) => Effect.Effect<VoilaTransportResponse, VoilaTransportError>
): StubTransport => {
  const requests: Array<VoilaTransportRequest> = []

  return {
    layer: Layer.succeed(VoilaTransport, {
      request: (request) => {
        requests.push(request)

        return respond(request)
      }
    }),
    requests
  }
}

export const respondingTransport = (response: VoilaTransportResponse): StubTransport =>
  stubTransport(() => Effect.succeed(response))

export const failingTransport = (error: VoilaTransportError): StubTransport => stubTransport(() => Effect.fail(error))

/**
 * Answers each request with the next scripted response. An operation that
 * makes more requests than the script allows fails as a refused connection —
 * a test that asserts on a page count needs the extra page to be visible, not
 * silently answered.
 */
export const sequenceTransport = (responses: ReadonlyArray<VoilaTransportResponse>): StubTransport => {
  const remaining = [...responses]

  return stubTransport(() => {
    const response = remaining.shift()

    return response === undefined ? Effect.fail(connectionFailure()) : Effect.succeed(response)
  })
}

export const deadlineExceededTransport = (timeoutMs = 1_000): StubTransport =>
  failingTransport(requestDeadlineExceeded(timeoutMs))

export const connectionFailureTransport = (): StubTransport => failingTransport(connectionFailure())

export const responseReadFailureTransport = (): StubTransport => failingTransport(responseReadFailure())

/**
 * Runs an operation against a stub transport and hands back the either its
 * caller used to get directly. Tests keep asserting on success and failure
 * together, which is what an operation's contract is.
 */
export const runWith = <A, E>(
  effect: Effect.Effect<A, E, VoilaTransport>,
  transport: StubTransport
): Promise<Result.Result<A, E>> => Effect.runPromise(Effect.result(Effect.provide(effect, transport.layer)))
