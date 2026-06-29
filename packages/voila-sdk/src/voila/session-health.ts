import { Either } from "effect"

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
import type { VoilaTransport, VoilaTransportResponse } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import {
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  toughCookieJarPort
} from "./session-snapshot.js"
import { makeActiveCustomerSessionRequest } from "./urls.js"

export type CheckSessionHealthError = {
  readonly _tag: "SessionHealthSnapshotInvalid"
  readonly message: string
}

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
  | {
    readonly _tag: "ActiveCustomerSessionSchemaChanged"
    readonly session: SessionSnapshot
  }
  | {
    readonly _tag: "ActiveCustomerSessionUnauthorized"
    readonly session: SessionSnapshot
  }

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

const decodeSessionHealth = (health: unknown): Either.Either<SessionHealth, CheckSessionHealthError> =>
  Either.mapLeft(parseUnknown(SessionHealthSchema, health), sessionHealthSnapshotInvalid)

const responseSaysAuthenticated = (response: ActiveCustomerSessionResponse): boolean =>
  response.authenticated === true
  || response.isAuthenticated === true
  || response.customer?.authenticated === true
  || response.status?.toLowerCase() === "authenticated"

const responseSaysActiveCartSession = (response: ActiveCustomerSessionResponse): boolean =>
  typeof response.cartId === "string" && typeof response.regionId === "string"

const sessionHasAuthenticatedCookie = (
  cookieJarPort: CookieJarPort,
  session: SessionSnapshot
): boolean => {
  const jar = cookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    return false
  }

  return jar.right
    .getCookiesSync(makeActiveCustomerSessionRequest().url.href)
    .some((cookie) => cookie.key === authenticatedCookieName)
}

const responseHasAuthenticatedEvidence = (
  cookieJarPort: CookieJarPort,
  response: ActiveCustomerSessionResponse,
  session: SessionSnapshot
): boolean =>
  responseSaysAuthenticated(response)
  || responseSaysActiveCartSession(response)
  || sessionHasAuthenticatedCookie(cookieJarPort, session)

const makeSdkSnapshotWithSession = (
  previous: SdkSessionSnapshot,
  session: SessionSnapshot
): Either.Either<SdkSessionSnapshot, CheckSessionHealthError> =>
  previous.kind === "authenticated"
    ? Either.mapLeft(
      makeAuthenticatedSdkSessionSnapshot(session, previous.state, previous.account),
      sessionHealthSnapshotInvalid
    )
    : Either.mapLeft(makeGuestSdkSessionSnapshot(session), sessionHealthSnapshotInvalid)

const makeActiveSession = (
  cookieJarPort: CookieJarPort,
  previous: SdkSessionSnapshot,
  response: ActiveCustomerSessionResponse,
  session: SessionSnapshot
): Either.Either<SessionHealth, CheckSessionHealthError> => {
  if (previous.kind === "authenticated" && !responseHasAuthenticatedEvidence(cookieJarPort, response, session)) {
    return makeReauthRequired(previous, session)
  }

  return previous.kind === "authenticated"
    ? Either.mapLeft(
      makeAuthenticatedSdkSessionSnapshot(
        session,
        "authenticated",
        previous.account
      ),
      sessionHealthSnapshotInvalid
    ).pipe(
      Either.flatMap((updatedSession) =>
        decodeSessionHealth({
          session: updatedSession,
          status: "active"
        })
      )
    )
    : Either.mapLeft(makeGuestSdkSessionSnapshot(session), sessionHealthSnapshotInvalid).pipe(
      Either.flatMap((updatedSession) =>
        decodeSessionHealth({
          session: updatedSession,
          status: "active"
        })
      )
    )
}

const makeReauthRequired = (
  previous: SdkSessionSnapshot,
  session: SessionSnapshot = previous.session
): Either.Either<SessionHealth, CheckSessionHealthError> =>
  previous.kind === "authenticated"
    ? Either.mapLeft(
      makeAuthenticatedSdkSessionSnapshot(session, "reauth-required", previous.account),
      sessionHealthSnapshotInvalid
    ).pipe(
      Either.flatMap((session) =>
        decodeSessionHealth({
          session,
          status: "reauth-required"
        })
      )
    )
    : Either.flatMap(makeGuestSdkSessionSnapshot(session), (updatedSession) =>
      decodeSessionHealth({
        session: updatedSession,
        status: "unauthorized"
      })).pipe(Either.mapLeft(sessionHealthSnapshotInvalid))

const isSuccessStatus = (status: number): boolean => status >= successStatusMin && status < successStatusMax

const isUnauthorizedStatus = (status: number): boolean => status === unauthorizedStatus || status === forbiddenStatus

const applySetCookieHeaders = (
  cookieJarPort: CookieJarPort,
  session: SessionSnapshot,
  response: VoilaTransportResponse
): Either.Either<SessionSnapshot, "persistence"> => {
  const cookieHeaders = getHeaderValues(response.headers, setCookieHeader)

  if (cookieHeaders.length === emptyStringLength) {
    return Either.right(session)
  }

  const jar = cookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    return Either.left("persistence")
  }

  for (const cookie of cookieHeaders) {
    try {
      jar.right.setCookieSync(cookie, makeActiveCustomerSessionRequest().url.href)
    } catch {
      return Either.left("persistence")
    }
  }

  return Either.map(
    Either.mapLeft(cookieJarPort.serialize(jar.right), () => "persistence" as const),
    (cookieJar) => ({
      ...session,
      cookieJar
    })
  )
}

const makeTransportHeaders = (
  cookieJarPort: CookieJarPort,
  session: SessionSnapshot
): Either.Either<Readonly<Record<string, string>>, "persistence"> => {
  const jar = cookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    return Either.left("persistence")
  }

  const cookieHeader = jar.right.getCookieStringSync(makeActiveCustomerSessionRequest().url.href)

  return Either.right({
    ...makeVoilaHeaders(session.metadata, session.csrf.token),
    ...(cookieHeader.length === emptyStringLength ? {} : { cookie: cookieHeader })
  })
}

const requestActiveCustomerSession = async (
  session: SessionSnapshot,
  transport: VoilaTransport,
  cookieJarPort: CookieJarPort
): Promise<ActiveCustomerSessionRequestResult> => {
  if (session.csrf.token.trim().length === emptyStringLength) {
    return {
      _tag: "ActiveCustomerSessionUnauthorized",
      session
    }
  }

  const headers = makeTransportHeaders(cookieJarPort, session)

  if (Either.isLeft(headers)) {
    return {
      _tag: "ActiveCustomerSessionRetry",
      reason: "persistence",
      session
    }
  }

  const request = makeActiveCustomerSessionRequest()
  let response: Either.Either<VoilaTransportResponse, unknown>

  try {
    response = await transport.request({
      headers: headers.right,
      method: request.method,
      url: request.url
    })
  } catch {
    return {
      _tag: "ActiveCustomerSessionRetry",
      reason: "network",
      session
    }
  }

  if (Either.isLeft(response)) {
    return {
      _tag: "ActiveCustomerSessionRetry",
      reason: "network",
      session
    }
  }

  const updatedSession = applySetCookieHeaders(cookieJarPort, session, response.right)

  if (Either.isLeft(updatedSession)) {
    return {
      _tag: "ActiveCustomerSessionRetry",
      reason: "persistence",
      session
    }
  }

  if (isUnauthorizedStatus(response.right.status)) {
    return {
      _tag: "ActiveCustomerSessionUnauthorized",
      session: updatedSession.right
    }
  }

  if (!isSuccessStatus(response.right.status)) {
    return {
      _tag: "ActiveCustomerSessionRetry",
      reason: "server",
      session: updatedSession.right
    }
  }

  const parsed = Either.flatMap(
    parseJson(response.right.body),
    (payload) => parseUnknown(ActiveCustomerSessionResponseSchema, payload)
  )

  if (Either.isLeft(parsed)) {
    return {
      _tag: "ActiveCustomerSessionSchemaChanged",
      session: updatedSession.right
    }
  }

  return {
    _tag: "ActiveCustomerSessionOk",
    session: updatedSession.right,
    value: parsed.right
  }
}

export const checkSessionHealth = async (
  snapshot: SdkSessionSnapshot,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<SessionHealth, CheckSessionHealthError>> => {
  const result = await requestActiveCustomerSession(snapshot.session, transport, cookieJarPort ?? toughCookieJarPort)

  switch (result._tag) {
    case "ActiveCustomerSessionOk":
      return makeActiveSession(cookieJarPort ?? toughCookieJarPort, snapshot, result.value, result.session)
    case "ActiveCustomerSessionRetry":
      return Either.flatMap(
        makeSdkSnapshotWithSession(snapshot, result.session),
        (updatedSnapshot) =>
          decodeSessionHealth({
            reason: result.reason,
            session: updatedSnapshot,
            status: "retry"
          })
      )
    case "ActiveCustomerSessionSchemaChanged":
      return Either.flatMap(
        makeSdkSnapshotWithSession(snapshot, result.session),
        (updatedSnapshot) =>
          decodeSessionHealth({
            session: updatedSnapshot,
            status: "schema-changed"
          })
      )
    case "ActiveCustomerSessionUnauthorized":
      return makeReauthRequired(snapshot, result.session)
  }
}
