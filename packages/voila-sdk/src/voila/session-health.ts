import { Effect, Result } from "effect"

import { parseJson, parseUnknown } from "../domain/parse.js"
import type {
  ActiveCustomerSessionResponse,
  RetryableSessionHealth,
  SdkSessionSnapshot,
  SessionHealth,
  SessionSnapshot
} from "../domain/schemas/index.js"
import { ActiveCustomerSessionResponseSchema, SessionHealthSchema } from "../domain/schemas/index.js"
import { getHeaderValues, makeVoilaHeaders } from "./headers.js"
import type { CookieJarPort } from "./session-snapshot.js"
import { VoilaTransport, type VoilaTransportResponse } from "./transport.js"
import {
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  readCookieHeader,
  toughCookieJarPort
} from "./session-snapshot.js"
import { makeActiveCustomerSessionRequest } from "./urls.js"

export type CheckSessionHealthError = { readonly _tag: "SessionHealthSnapshotInvalid"; readonly message: string }

type ActiveCustomerSessionRequestResult =
  | {
      readonly _tag: "ActiveCustomerSessionOk"
      readonly session: SessionSnapshot
      readonly value: ActiveCustomerSessionResponse
    }
  | {
      readonly _tag: "ActiveCustomerSessionRetry"
      readonly reason: RetryableSessionHealth["reason"]
      readonly session: SessionSnapshot
    }
  | { readonly _tag: "ActiveCustomerSessionSchemaChanged"; readonly session: SessionSnapshot }
  | { readonly _tag: "ActiveCustomerSessionUnauthorized"; readonly session: SessionSnapshot }

const emptyStringLength = 0
const authenticatedCookieName = "userEmail"
const forbiddenStatus = 403
const setCookieHeader = "set-cookie"
const successStatusMax = 300
const successStatusMin = 200
const unauthorizedStatus = 401

const sessionHealthSnapshotInvalid = (): CheckSessionHealthError => ({
  _tag: "SessionHealthSnapshotInvalid",
  message: "Session health could not build a typed SDK session snapshot"
})

const decodeSessionHealth = (health: unknown): Result.Result<SessionHealth, CheckSessionHealthError> =>
  Result.mapError(parseUnknown(SessionHealthSchema, health), sessionHealthSnapshotInvalid)

const responseSaysAuthenticated = (response: ActiveCustomerSessionResponse): boolean =>
  response.authenticated === true ||
  response.isAuthenticated === true ||
  response.customer?.authenticated === true ||
  response.status?.toLowerCase() === "authenticated"

const responseSaysActiveCartSession = (response: ActiveCustomerSessionResponse): boolean =>
  typeof response.cartId === "string" && typeof response.regionId === "string"

const sessionHasAuthenticatedCookie = (cookieJarPort: CookieJarPort, session: SessionSnapshot): boolean => {
  const jar = cookieJarPort.deserialize(session.cookieJar)

  if (Result.isFailure(jar)) {
    return false
  }

  return jar.success
    .getCookiesSync(makeActiveCustomerSessionRequest().url.href)
    .some((cookie) => cookie.key === authenticatedCookieName)
}

const responseHasAuthenticatedEvidence = (
  cookieJarPort: CookieJarPort,
  response: ActiveCustomerSessionResponse,
  session: SessionSnapshot
): boolean =>
  responseSaysAuthenticated(response) ||
  responseSaysActiveCartSession(response) ||
  sessionHasAuthenticatedCookie(cookieJarPort, session)

const makeSdkSnapshotWithSession = (
  previous: SdkSessionSnapshot,
  session: SessionSnapshot
): Result.Result<SdkSessionSnapshot, CheckSessionHealthError> =>
  previous.kind === "authenticated"
    ? Result.mapError(
        makeAuthenticatedSdkSessionSnapshot(session, previous.state, previous.account),
        sessionHealthSnapshotInvalid
      )
    : Result.mapError(makeGuestSdkSessionSnapshot(session), sessionHealthSnapshotInvalid)

const makeActiveSession = (
  cookieJarPort: CookieJarPort,
  previous: SdkSessionSnapshot,
  response: ActiveCustomerSessionResponse,
  session: SessionSnapshot
): Result.Result<SessionHealth, CheckSessionHealthError> => {
  if (previous.kind === "authenticated" && !responseHasAuthenticatedEvidence(cookieJarPort, response, session)) {
    return makeReauthRequired(previous, session)
  }

  return previous.kind === "authenticated"
    ? Result.mapError(
        makeAuthenticatedSdkSessionSnapshot(session, "authenticated", previous.account),
        sessionHealthSnapshotInvalid
      ).pipe(Result.flatMap((updatedSession) => decodeSessionHealth({ session: updatedSession, status: "active" })))
    : Result.mapError(makeGuestSdkSessionSnapshot(session), sessionHealthSnapshotInvalid).pipe(
        Result.flatMap((updatedSession) => decodeSessionHealth({ session: updatedSession, status: "active" }))
      )
}

const makeReauthRequired = (
  previous: SdkSessionSnapshot,
  session: SessionSnapshot = previous.session
): Result.Result<SessionHealth, CheckSessionHealthError> =>
  previous.kind === "authenticated"
    ? Result.mapError(
        makeAuthenticatedSdkSessionSnapshot(session, "reauth-required", previous.account),
        sessionHealthSnapshotInvalid
      ).pipe(Result.flatMap((session) => decodeSessionHealth({ session, status: "reauth-required" })))
    : Result.flatMap(makeGuestSdkSessionSnapshot(session), (updatedSession) =>
        decodeSessionHealth({ session: updatedSession, status: "unauthorized" })
      ).pipe(Result.mapError(sessionHealthSnapshotInvalid))

const isSuccessStatus = (status: number): boolean => status >= successStatusMin && status < successStatusMax

const isUnauthorizedStatus = (status: number): boolean => status === unauthorizedStatus || status === forbiddenStatus

const applySetCookieHeaders = (
  cookieJarPort: CookieJarPort,
  session: SessionSnapshot,
  response: VoilaTransportResponse
): Result.Result<SessionSnapshot, "persistence"> => {
  const cookieHeaders = getHeaderValues(response.headers, setCookieHeader)

  if (cookieHeaders.length === emptyStringLength) {
    return Result.succeed(session)
  }

  const jar = cookieJarPort.deserialize(session.cookieJar)

  if (Result.isFailure(jar)) {
    return Result.fail("persistence")
  }

  for (const cookie of cookieHeaders) {
    try {
      jar.success.setCookieSync(cookie, makeActiveCustomerSessionRequest().url.href)
    } catch {
      return Result.fail("persistence")
    }
  }

  return Result.map(
    Result.mapError(cookieJarPort.serialize(jar.success), (): "persistence" => "persistence"),
    (cookieJar) => ({ ...session, cookieJar })
  )
}

const makeTransportHeaders = (
  cookieJarPort: CookieJarPort,
  session: SessionSnapshot
): Result.Result<Readonly<Record<string, string>>, "persistence"> => {
  const jar = cookieJarPort.deserialize(session.cookieJar)

  if (Result.isFailure(jar)) {
    return Result.fail("persistence")
  }

  const cookieHeader = readCookieHeader(jar.success, makeActiveCustomerSessionRequest().url.href)

  if (Result.isFailure(cookieHeader)) {
    return Result.fail("persistence")
  }

  return Result.succeed({
    ...makeVoilaHeaders(session.metadata, session.csrf.token),
    ...(cookieHeader.success.length === emptyStringLength ? {} : { cookie: cookieHeader.success })
  })
}

const classifyActiveCustomerSession = (
  session: SessionSnapshot,
  response: VoilaTransportResponse,
  cookieJarPort: CookieJarPort
): ActiveCustomerSessionRequestResult => {
  const updatedSession = applySetCookieHeaders(cookieJarPort, session, response)

  if (Result.isFailure(updatedSession)) {
    return { _tag: "ActiveCustomerSessionRetry", reason: "persistence", session }
  }

  if (isUnauthorizedStatus(response.status)) {
    return { _tag: "ActiveCustomerSessionUnauthorized", session: updatedSession.success }
  }

  if (!isSuccessStatus(response.status)) {
    return { _tag: "ActiveCustomerSessionRetry", reason: "server", session: updatedSession.success }
  }

  const parsed = Result.flatMap(parseJson(response.body), (payload) =>
    parseUnknown(ActiveCustomerSessionResponseSchema, payload)
  )

  if (Result.isFailure(parsed)) {
    return { _tag: "ActiveCustomerSessionSchemaChanged", session: updatedSession.success }
  }

  return { _tag: "ActiveCustomerSessionOk", session: updatedSession.success, value: parsed.success }
}

/**
 * A health check reports rather than fails: every way the request can go wrong
 * — no token, an unusable cookie jar, an unreachable server, a changed schema —
 * is a health verdict a caller can act on, so the transport's typed failures
 * are folded into the retry verdict instead of leaving through the error
 * channel.
 */
const requestActiveCustomerSession = (
  session: SessionSnapshot,
  cookieJarPort: CookieJarPort
): Effect.Effect<ActiveCustomerSessionRequestResult, never, VoilaTransport> => {
  if (session.csrf.token.trim().length === emptyStringLength) {
    return Effect.succeed({ _tag: "ActiveCustomerSessionUnauthorized", session })
  }

  const headers = makeTransportHeaders(cookieJarPort, session)

  if (Result.isFailure(headers)) {
    return Effect.succeed({ _tag: "ActiveCustomerSessionRetry", reason: "persistence", session })
  }

  const request = makeActiveCustomerSessionRequest()

  return Effect.gen(function* () {
    const transport = yield* VoilaTransport
    return yield* Effect.match(
      transport.request({ headers: headers.success, method: request.method, url: request.url }),
      {
        onFailure: (): ActiveCustomerSessionRequestResult => ({
          _tag: "ActiveCustomerSessionRetry",
          reason: "network",
          session
        }),
        onSuccess: (response) => classifyActiveCustomerSession(session, response, cookieJarPort)
      }
    )
  })
}

const makeSessionHealth = (
  snapshot: SdkSessionSnapshot,
  result: ActiveCustomerSessionRequestResult,
  cookieJarPort: CookieJarPort
): Result.Result<SessionHealth, CheckSessionHealthError> => {
  switch (result._tag) {
    case "ActiveCustomerSessionOk":
      return makeActiveSession(cookieJarPort, snapshot, result.value, result.session)
    case "ActiveCustomerSessionRetry":
      return Result.flatMap(makeSdkSnapshotWithSession(snapshot, result.session), (updatedSnapshot) =>
        decodeSessionHealth({ reason: result.reason, session: updatedSnapshot, status: "retry" })
      )
    case "ActiveCustomerSessionSchemaChanged":
      return Result.flatMap(makeSdkSnapshotWithSession(snapshot, result.session), (updatedSnapshot) =>
        decodeSessionHealth({ session: updatedSnapshot, status: "schema-changed" })
      )
    case "ActiveCustomerSessionUnauthorized":
      return makeReauthRequired(snapshot, result.session)
  }
}

export const checkSessionHealth = (
  snapshot: SdkSessionSnapshot,
  cookieJarPort: CookieJarPort = toughCookieJarPort
): Effect.Effect<SessionHealth, CheckSessionHealthError, VoilaTransport> =>
  Effect.flatMap(requestActiveCustomerSession(snapshot.session, cookieJarPort), (result) =>
    Effect.fromResult(makeSessionHealth(snapshot, result, cookieJarPort))
  )
