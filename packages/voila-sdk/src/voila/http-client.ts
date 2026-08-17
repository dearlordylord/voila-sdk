import { Effect, Either, Schema } from "effect"

import { parseJson, parseUnknown } from "../domain/parse.js"
import { type SessionSnapshot } from "../domain/schemas/index.js"
import { getHeaderValues, makeVoilaHeaders } from "./headers.js"
import {
  type CookieJarPort,
  type CookieJarPortError,
  readCookieHeader,
  toughCookieJarPort
} from "./session-snapshot.js"
import {
  VoilaTransport,
  type VoilaHttpMethod,
  type VoilaTransportRequest,
  type VoilaTransportResponse
} from "./transport.js"
import type { VoilaTransportError } from "./transport-error.js"
import { VOILA_BASE_URL } from "./urls.js"

export interface VoilaHttpRequest {
  readonly body?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly method: VoilaHttpMethod
  readonly url: URL
}

export interface VoilaJsonResult<A> {
  readonly session: SessionSnapshot
  readonly value: A
}

export const VoilaRequestBlockedSchema = Schema.Struct({
  _tag: Schema.Literal("VoilaRequestBlocked"),
  edgeRequestId: Schema.optionalWith(Schema.String, { exact: true }),
  message: Schema.String,
  method: Schema.Literal("DELETE", "GET", "PATCH", "POST", "PUT"),
  status: Schema.Number
})

export type VoilaRequestBlocked = Schema.Schema.Type<typeof VoilaRequestBlockedSchema>

export type VoilaSdkError =
  | { readonly _tag: "VoilaMissingCsrfToken"; readonly message: string }
  | { readonly _tag: "VoilaUnsupportedOrigin"; readonly message: string; readonly origin: string }
  | { readonly _tag: "VoilaSessionPersistenceFailure"; readonly message: string }
  | VoilaTransportError
  | { readonly _tag: "VoilaUnauthorizedSession"; readonly message: string; readonly status: 401 | 403 }
  | VoilaRequestBlocked
  | { readonly _tag: "VoilaNon2xxResponse"; readonly message: string; readonly status: number }
  | { readonly _tag: "VoilaMalformedJson"; readonly message: string }
  | { readonly _tag: "VoilaSchemaDecodeFailure"; readonly message: string }

const emptyStringLength = 0
const unauthorizedStatus = 401
const forbiddenStatus = 403
const serviceUnavailableStatus = 503
const successStatusMin = 200
const successStatusMax = 300
const setCookieHeader = "set-cookie"
const blockedBodyMarkers = ["error: the request could not be satisfied", "request blocked."]
const edgeRequestIdHeader = "x-amz-cf-id"

const missingCsrfToken = (): VoilaSdkError => ({
  _tag: "VoilaMissingCsrfToken",
  message: "Session snapshot is missing a CSRF token"
})

const unsupportedOrigin = (origin: string): VoilaSdkError => ({
  _tag: "VoilaUnsupportedOrigin",
  message: "Only same-origin Voila requests are supported",
  origin
})

const sessionPersistenceFailure = (_cause: CookieJarPortError): VoilaSdkError => ({
  _tag: "VoilaSessionPersistenceFailure",
  message: "Session cookies could not be restored or persisted"
})

const setCookiePersistenceFailure = (): VoilaSdkError => ({
  _tag: "VoilaSessionPersistenceFailure",
  message: "Session cookies could not be restored or persisted"
})

const unauthorizedSession = (status: 401 | 403): VoilaSdkError => ({
  _tag: "VoilaUnauthorizedSession",
  message: "Voila session is unauthorized or expired",
  status
})

const requestBlocked = (response: VoilaTransportResponse, request: VoilaHttpRequest): VoilaRequestBlocked => {
  const [edgeRequestId] = getHeaderValues(response.headers, edgeRequestIdHeader)

  return {
    _tag: "VoilaRequestBlocked",
    ...(edgeRequestId === undefined ? {} : { edgeRequestId }),
    message: "Voila request was blocked",
    method: request.method,
    status: response.status
  }
}

const non2xxResponse = (status: number): VoilaSdkError => ({
  _tag: "VoilaNon2xxResponse",
  message: "Voila returned a non-success response",
  status
})

const malformedJson = (): VoilaSdkError => ({ _tag: "VoilaMalformedJson", message: "Voila returned malformed JSON" })

const schemaDecodeFailure = (): VoilaSdkError => ({
  _tag: "VoilaSchemaDecodeFailure",
  message: "Voila response JSON does not match the SDK schema"
})

const isSuccessStatus = (status: number): boolean => status >= successStatusMin && status < successStatusMax

const isUnauthorizedStatus = (status: number): status is 401 | 403 =>
  status === unauthorizedStatus || status === forbiddenStatus

const isBlockedResponse = (response: VoilaTransportResponse): boolean => {
  if (response.status !== forbiddenStatus && response.status !== serviceUnavailableStatus) {
    return false
  }

  const normalizedBody = response.body.toLowerCase()

  return blockedBodyMarkers.every((marker) => normalizedBody.includes(marker))
}

const makeRequestHeaders = (
  request: VoilaHttpRequest,
  session: SessionSnapshot,
  cookieHeader: string
): Readonly<Record<string, string>> => {
  const cookieHeaders = cookieHeader.length === emptyStringLength ? {} : { cookie: cookieHeader }

  return { ...request.headers, ...makeVoilaHeaders(session.metadata, session.csrf.token), ...cookieHeaders }
}

const applySetCookieHeaders = (
  cookieJarPort: CookieJarPort,
  session: SessionSnapshot,
  response: VoilaTransportResponse,
  url: URL
): Either.Either<SessionSnapshot, VoilaSdkError> =>
  Either.flatMap(
    Either.mapLeft(cookieJarPort.deserialize(session.cookieJar), sessionPersistenceFailure),
    (cookieJar) => {
      for (const cookie of getHeaderValues(response.headers, setCookieHeader)) {
        try {
          cookieJar.setCookieSync(cookie, url.href)
        } catch {
          return Either.left(setCookiePersistenceFailure())
        }
      }

      return Either.flatMap(
        Either.mapLeft(cookieJarPort.serialize(cookieJar), sessionPersistenceFailure),
        (cookieJarSnapshot) => Either.right({ ...session, cookieJar: cookieJarSnapshot })
      )
    }
  )

const classifyResponse = (
  response: VoilaTransportResponse,
  request: VoilaHttpRequest
): Either.Either<VoilaTransportResponse, VoilaSdkError> => {
  if (!isSuccessStatus(response.status) && isBlockedResponse(response)) {
    return Either.left(requestBlocked(response, request))
  }

  if (isUnauthorizedStatus(response.status)) {
    return Either.left(unauthorizedSession(response.status))
  }

  return isSuccessStatus(response.status) ? Either.right(response) : Either.left(non2xxResponse(response.status))
}

const decodeBody = <A, I>(
  schema: Schema.Schema<A, I, never>,
  session: SessionSnapshot,
  body: string
): Either.Either<VoilaJsonResult<A>, VoilaSdkError> =>
  Either.flatMap(Either.mapLeft(parseJson(body), malformedJson), (payload) =>
    Either.map(Either.mapLeft(parseUnknown(schema, payload), schemaDecodeFailure), (value) => ({ session, value }))
  )

const makeTransportRequest = (
  request: VoilaHttpRequest,
  session: SessionSnapshot,
  cookieHeader: string
): VoilaTransportRequest => {
  const base = { headers: makeRequestHeaders(request, session, cookieHeader), method: request.method, url: request.url }

  return request.body === undefined ? base : { ...base, body: request.body }
}

/**
 * The request pipeline: guard, send, classify, fold cookies back, decode. The
 * order is the contract — the Set-Cookie fold-back happens before the body is
 * decoded, so a response that refreshes the session but fails to parse still
 * fails the operation rather than silently dropping the refresh onto a caller
 * that never gets it (ADR-0002).
 */
export const requestVoilaJson = <A, I>(
  schema: Schema.Schema<A, I, never>,
  session: SessionSnapshot,
  request: VoilaHttpRequest,
  cookieJarPort: CookieJarPort = toughCookieJarPort
): Effect.Effect<VoilaJsonResult<A>, VoilaSdkError, VoilaTransport> =>
  Effect.gen(function* () {
    if (session.csrf.token.trim().length === emptyStringLength) {
      return yield* Effect.fail(missingCsrfToken())
    }

    if (request.url.origin !== VOILA_BASE_URL) {
      return yield* Effect.fail(unsupportedOrigin(request.url.origin))
    }

    const cookieJar = yield* Either.mapLeft(cookieJarPort.deserialize(session.cookieJar), sessionPersistenceFailure)
    const transport = yield* VoilaTransport
    const cookieHeader = yield* Either.mapLeft(readCookieHeader(cookieJar, request.url.href), sessionPersistenceFailure)
    const response = yield* transport.request(makeTransportRequest(request, session, cookieHeader))
    const classified = yield* classifyResponse(response, request)
    const updatedSession = yield* applySetCookieHeaders(cookieJarPort, session, classified, request.url)

    return yield* decodeBody(schema, updatedSession, classified.body)
  })
