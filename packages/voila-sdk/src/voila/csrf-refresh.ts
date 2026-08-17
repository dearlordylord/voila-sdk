import { Effect, Either } from "effect"
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
  | { readonly _tag: "CsrfRefreshPersistenceFailure"; readonly message: string }

const homepageUrl = new URL("/", VOILA_BASE_URL)
const emptyStringLength = 0
const successStatusMin = 200
const successStatusMax = 300
const setCookieHeader = "set-cookie"
// the cookie the session-health check already treats as evidence of a logged-in
// account: if the homepage hands back a session without it, the refresh is a
// logout, not a token rotation
const authenticatedCookieName = "userEmail"

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

const persistenceFailure = (): CsrfRefreshError => ({
  _tag: "CsrfRefreshPersistenceFailure",
  message: "Refreshed session cookies could not be restored or persisted"
})

const isSuccessStatus = (status: number): boolean => status >= successStatusMin && status < successStatusMax

const hasAuthenticatedCookie = (jar: CookieJar): boolean =>
  jar.getCookiesSync(homepageUrl.href).some((cookie) => cookie.key === authenticatedCookieName)

const foldSetCookies = (jar: CookieJar, response: VoilaTransportResponse): Either.Either<void, CsrfRefreshError> => {
  for (const cookie of getHeaderValues(response.headers, setCookieHeader)) {
    try {
      jar.setCookieSync(cookie, homepageUrl.href)
    } catch {
      return Either.left(persistenceFailure())
    }
  }

  return Either.right(undefined)
}

const readInitialStateSession = (html: string): Either.Either<InitialStateSession, CsrfRefreshError> =>
  Either.flatMap(Either.mapLeft(extractInitialStatePayload(html), initialStateMalformed), (payload) =>
    Either.mapLeft(parseUnknown(InitialStateSessionSchema, payload), initialStateMalformed)
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
  response: VoilaTransportResponse
): Either.Either<SessionSnapshot, CsrfRefreshError> => {
  if (!isSuccessStatus(response.status)) {
    return Either.left(non2xxResponse(response.status))
  }

  return Either.flatMap(readInitialStateSession(response.body), (initialState) => {
    if (initialState.session.csrf.token.trim().length === emptyStringLength) {
      return Either.left(initialStateMalformed())
    }

    if (initialState.session.csrf.token === session.csrf.token) {
      return Either.left(tokenUnchanged())
    }

    const wasAuthenticated = hasAuthenticatedCookie(jar)

    return Either.flatMap(foldSetCookies(jar, response), () => {
      if (wasAuthenticated && !hasAuthenticatedCookie(jar)) {
        return Either.left(sessionDeauthenticated())
      }

      return Either.flatMap(Either.mapLeft(cookieJarPort.serialize(jar), persistenceFailure), (cookieJar) =>
        Either.mapLeft(
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
  cookieJarPort: CookieJarPort = toughCookieJarPort
): Effect.Effect<SessionSnapshot, CsrfRefreshError, VoilaTransport> =>
  Effect.gen(function* () {
    const jar = yield* Either.mapLeft(cookieJarPort.deserialize(session.cookieJar), persistenceFailure)
    const cookieHeader = yield* Either.mapLeft(readCookieHeader(jar, homepageUrl.href), persistenceFailure)
    const transport = yield* VoilaTransport
    const response = yield* transport.request({
      headers: cookieHeader.length === emptyStringLength ? {} : { cookie: cookieHeader },
      method: "GET",
      url: homepageUrl
    })

    return yield* makeRefreshedSession(cookieJarPort, jar, session, response)
  })
