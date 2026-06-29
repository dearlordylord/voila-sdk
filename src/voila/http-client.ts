import type { Schema } from "effect"
import { Either } from "effect"

import { parseJson, parseUnknown } from "../domain/parse.js"
import { type SessionSnapshot } from "../domain/schemas/index.js"
import { getHeaderValues, makeVoilaHeaders, type ResponseHeaders } from "./headers.js"
import { type CookieJarPort, type CookieJarPortError, toughCookieJarPort } from "./session-snapshot.js"
import { VOILA_BASE_URL } from "./urls.js"

export type VoilaHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT"

export interface VoilaHttpRequest {
  readonly body?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly method: VoilaHttpMethod
  readonly url: URL
}

export interface VoilaTransportRequest {
  readonly body?: string
  readonly headers: Readonly<Record<string, string>>
  readonly method: VoilaHttpMethod
  readonly url: URL
}

export interface VoilaTransportResponse {
  readonly body: string
  readonly headers: ResponseHeaders
  readonly status: number
}

export interface VoilaTransport {
  readonly request: (request: VoilaTransportRequest) => Promise<Either.Either<VoilaTransportResponse, unknown>>
}

export interface VoilaJsonResult<A> {
  readonly session: SessionSnapshot
  readonly value: A
}

export type VoilaSdkError =
  | {
    readonly _tag: "VoilaMissingCsrfToken"
    readonly message: string
  }
  | {
    readonly _tag: "VoilaUnsupportedOrigin"
    readonly message: string
    readonly origin: string
  }
  | {
    readonly _tag: "VoilaSessionPersistenceFailure"
    readonly message: string
  }
  | {
    readonly _tag: "VoilaNetworkFailure"
    readonly message: string
  }
  | {
    readonly _tag: "VoilaUnauthorizedSession"
    readonly message: string
    readonly status: 401 | 403
  }
  | {
    readonly _tag: "VoilaNon2xxResponse"
    readonly message: string
    readonly status: number
  }
  | {
    readonly _tag: "VoilaMalformedJson"
    readonly message: string
  }
  | {
    readonly _tag: "VoilaSchemaDecodeFailure"
    readonly message: string
  }

const emptyStringLength = 0
const unauthorizedStatus = 401
const forbiddenStatus = 403
const successStatusMin = 200
const successStatusMax = 300
const setCookieHeader = "set-cookie"

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

const networkFailure = (_cause: unknown): VoilaSdkError => ({
  _tag: "VoilaNetworkFailure",
  message: "Voila network request failed"
})

const unauthorizedSession = (status: 401 | 403): VoilaSdkError => ({
  _tag: "VoilaUnauthorizedSession",
  message: "Voila session is unauthorized or expired",
  status
})

const non2xxResponse = (status: number): VoilaSdkError => ({
  _tag: "VoilaNon2xxResponse",
  message: "Voila returned a non-success response",
  status
})

const malformedJson = (): VoilaSdkError => ({
  _tag: "VoilaMalformedJson",
  message: "Voila returned malformed JSON"
})

const schemaDecodeFailure = (): VoilaSdkError => ({
  _tag: "VoilaSchemaDecodeFailure",
  message: "Voila response JSON does not match the SDK schema"
})

const isSuccessStatus = (status: number): boolean => status >= successStatusMin && status < successStatusMax

const isUnauthorizedStatus = (status: number): status is 401 | 403 =>
  status === unauthorizedStatus || status === forbiddenStatus

const makeRequestHeaders = (
  request: VoilaHttpRequest,
  session: SessionSnapshot,
  cookieHeader: string
): Readonly<Record<string, string>> => {
  const cookieHeaders = cookieHeader.length === emptyStringLength ? {} : { cookie: cookieHeader }

  return {
    ...request.headers,
    ...makeVoilaHeaders(session.metadata, session.csrf.token),
    ...cookieHeaders
  }
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
        (cookieJarSnapshot) =>
          Either.right({
            ...session,
            cookieJar: cookieJarSnapshot
          })
      )
    }
  )

export const requestVoilaJson = async <A, I>(
  schema: Schema.Schema<A, I, never>,
  session: SessionSnapshot,
  request: VoilaHttpRequest,
  transport: VoilaTransport,
  cookieJarPort: CookieJarPort = toughCookieJarPort
): Promise<Either.Either<VoilaJsonResult<A>, VoilaSdkError>> => {
  if (session.csrf.token.trim().length === emptyStringLength) {
    return Either.left(missingCsrfToken())
  }

  if (request.url.origin !== VOILA_BASE_URL) {
    return Either.left(unsupportedOrigin(request.url.origin))
  }

  const cookieJar = cookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(cookieJar)) {
    return Either.left(sessionPersistenceFailure(cookieJar.left))
  }

  const cookieHeader = cookieJar.right.getCookieStringSync(request.url.href)
  const transportRequestBase = {
    headers: makeRequestHeaders(request, session, cookieHeader),
    method: request.method,
    url: request.url
  }
  const transportRequest: VoilaTransportRequest = request.body === undefined
    ? transportRequestBase
    : {
      ...transportRequestBase,
      body: request.body
    }

  let response: Either.Either<VoilaTransportResponse, unknown>

  try {
    response = await transport.request(transportRequest)
  } catch (error) {
    return Either.left(networkFailure(error))
  }

  if (Either.isLeft(response)) {
    return Either.left(networkFailure(response.left))
  }

  if (isUnauthorizedStatus(response.right.status)) {
    return Either.left(unauthorizedSession(response.right.status))
  }

  if (!isSuccessStatus(response.right.status)) {
    return Either.left(non2xxResponse(response.right.status))
  }

  const updatedSession = applySetCookieHeaders(cookieJarPort, session, response.right, request.url)

  if (Either.isLeft(updatedSession)) {
    return Either.left(updatedSession.left)
  }

  return Either.flatMap(
    Either.mapLeft(parseJson(response.right.body), malformedJson),
    (payload) =>
      Either.map(
        Either.mapLeft(parseUnknown(schema, payload), schemaDecodeFailure),
        (value) => ({
          session: updatedSession.right,
          value
        })
      )
  )
}
