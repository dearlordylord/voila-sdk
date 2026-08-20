import { Effect, Result } from "effect"
import type { CookieJar } from "tough-cookie"

import { parseUnknown } from "../domain/parse.js"
import { type InitialStateSession, InitialStateSessionSchema, type SessionSnapshot } from "../domain/schemas/index.js"
import { getHeaderValues } from "./headers.js"
import { extractInitialStatePayload } from "./initial-state.js"
import { type CookieJarPort, makeSessionSnapshot, readCookieHeader, toughCookieJarPort } from "./session-snapshot.js"
import { VoilaTransport, type VoilaTransportResponse } from "./transport.js"
import type { VoilaTransportError } from "./transport-error.js"
import { VOILA_BASE_URL } from "./urls.js"

export type CsrfRefreshError =
  | VoilaTransportError
  | { readonly _tag: "CsrfRefreshNon2xxResponse"; readonly message: string; readonly status: number }
  | { readonly _tag: "CsrfRefreshInitialStateMalformed"; readonly message: string }
  | { readonly _tag: "CsrfRefreshTokenUnchanged"; readonly message: string }
  | { readonly _tag: "CsrfRefreshSessionDeauthenticated"; readonly message: string }
  | { readonly _tag: "CsrfRefreshAuthenticationMismatch"; readonly message: string }
  | { readonly _tag: "CsrfRefreshPersistenceFailure"; readonly message: string }

export type CsrfRefreshAuthentication = "authenticated" | "guest"

const homepageUrl = new URL("/", VOILA_BASE_URL)
const emptyStringLength = 0
const successStatusMin = 200
const successStatusMax = 300
const setCookieHeader = "set-cookie"

const non2xxResponse = (status: number): CsrfRefreshError => ({
  _tag: "CsrfRefreshNon2xxResponse",
  message: "Voila homepage returned a non-success response",
  status
})

const initialStateMalformed = (): CsrfRefreshError => ({
  _tag: "CsrfRefreshInitialStateMalformed",
  message: "Voila homepage initial state could not be decoded"
})

const tokenUnchanged = (): CsrfRefreshError => ({
  _tag: "CsrfRefreshTokenUnchanged",
  message: "Voila homepage returned the CSRF token the session already carries"
})

const sessionDeauthenticated = (): CsrfRefreshError => ({
  _tag: "CsrfRefreshSessionDeauthenticated",
  message: "Voila homepage no longer recognizes the session as authenticated"
})

const authenticationMismatch = (): CsrfRefreshError => ({
  _tag: "CsrfRefreshAuthenticationMismatch",
  message: "Voila homepage authentication state does not match the session kind"
})

const persistenceFailure = (): CsrfRefreshError => ({
  _tag: "CsrfRefreshPersistenceFailure",
  message: "Refreshed session cookies could not be restored or persisted"
})

const isSuccessStatus = (status: number): boolean => status >= successStatusMin && status < successStatusMax

const foldSetCookies = (jar: CookieJar, response: VoilaTransportResponse): Result.Result<void, CsrfRefreshError> => {
  for (const cookie of getHeaderValues(response.headers, setCookieHeader)) {
    try {
      jar.setCookieSync(cookie, homepageUrl.href)
    } catch {
      return Result.fail(persistenceFailure())
    }
  }

  return Result.succeed(undefined)
}

const readInitialStateSession = (html: string): Result.Result<InitialStateSession, CsrfRefreshError> =>
  Result.flatMap(Result.mapError(extractInitialStatePayload(html), initialStateMalformed), (payload) =>
    Result.mapError(parseUnknown(InitialStateSessionSchema, payload), initialStateMalformed)
  )

/**
 * The refreshed session keeps the jar it started from, with the homepage's own
 * Set-Cookie folded on top. Replacing the jar is what a guest bootstrap does,
 * and doing it here would turn a rotated token into a silent downgrade to a
 * guest cart.
 */
const makeRefreshedSession = (
  cookieJarPort: CookieJarPort,
  jar: CookieJar,
  session: SessionSnapshot,
  response: VoilaTransportResponse,
  authentication: CsrfRefreshAuthentication
): Result.Result<SessionSnapshot, CsrfRefreshError> => {
  if (!isSuccessStatus(response.status)) {
    return Result.fail(non2xxResponse(response.status))
  }

  return Result.flatMap(readInitialStateSession(response.body), (initialState) => {
    if (authentication === "authenticated" && !initialState.session.isLoggedIn) {
      return Result.fail(sessionDeauthenticated())
    }

    if (authentication === "guest" && initialState.session.isLoggedIn) {
      return Result.fail(authenticationMismatch())
    }

    if (initialState.session.csrf.token.trim().length === emptyStringLength) {
      return Result.fail(initialStateMalformed())
    }

    if (initialState.session.csrf.token === session.csrf.token) {
      return Result.fail(tokenUnchanged())
    }

    return Result.flatMap(foldSetCookies(jar, response), () => {
      return Result.flatMap(Result.mapError(cookieJarPort.serialize(jar), persistenceFailure), (cookieJar) =>
        Result.mapError(
          makeSessionSnapshot(initialState.session.metadata, initialState.session.csrf, cookieJar),
          persistenceFailure
        )
      )
    })
  })
}

/**
 * Voila rotates the CSRF token independently of the session cookies, and only
 * writes are checked against it — so a snapshot captured at login keeps reading
 * fine long after every write it makes is answered with a 403. Re-reading the
 * server-rendered homepage is how the web app itself gets a current token.
 */
export const refreshSessionCsrf = (
  session: SessionSnapshot,
  authentication: CsrfRefreshAuthentication,
  cookieJarPort: CookieJarPort = toughCookieJarPort
): Effect.Effect<SessionSnapshot, CsrfRefreshError, VoilaTransport> =>
  Effect.gen(function* () {
    const jar = yield* Effect.fromResult(
      Result.mapError(cookieJarPort.deserialize(session.cookieJar), persistenceFailure)
    )
    const cookieHeader = yield* Effect.fromResult(
      Result.mapError(readCookieHeader(jar, homepageUrl.href), persistenceFailure)
    )
    const transport = yield* VoilaTransport
    const response = yield* transport.request({
      headers: cookieHeader.length === emptyStringLength ? {} : { cookie: cookieHeader },
      method: "GET",
      url: homepageUrl
    })

    return yield* Effect.fromResult(makeRefreshedSession(cookieJarPort, jar, session, response, authentication))
  })
