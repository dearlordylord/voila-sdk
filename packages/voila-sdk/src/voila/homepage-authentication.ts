import { Effect, Match } from "effect"

import type { RetryableSessionHealth, SessionSnapshot } from "../domain/schemas/index.js"
import { type CsrfRefreshError, refreshSessionCsrf } from "./csrf-refresh.js"
import type { CookieJarPort } from "./session-snapshot.js"
import { type VoilaTransport } from "./transport.js"

type HomepageAuthenticationResult =
  | { readonly _tag: "HomepageAuthenticated"; readonly session: SessionSnapshot }
  | { readonly _tag: "HomepageDeauthenticated"; readonly session: SessionSnapshot }
  | {
      readonly _tag: "HomepageAuthenticationRetry"
      readonly reason: RetryableSessionHealth["reason"]
      readonly session: SessionSnapshot
    }
  | { readonly _tag: "HomepageAuthenticationSchemaChanged"; readonly session: SessionSnapshot }

const unauthorizedStatuses: ReadonlySet<number> = new Set([401, 403])

const authenticated = (session: SessionSnapshot): HomepageAuthenticationResult => ({
  _tag: "HomepageAuthenticated",
  session
})

const deauthenticated = (session: SessionSnapshot): HomepageAuthenticationResult => ({
  _tag: "HomepageDeauthenticated",
  session
})

const retry = (session: SessionSnapshot, reason: RetryableSessionHealth["reason"]): HomepageAuthenticationResult => ({
  _tag: "HomepageAuthenticationRetry",
  reason,
  session
})

const schemaChanged = (session: SessionSnapshot): HomepageAuthenticationResult => ({
  _tag: "HomepageAuthenticationSchemaChanged",
  session
})

const classifyFailure = (session: SessionSnapshot, error: CsrfRefreshError): HomepageAuthenticationResult =>
  Match.typeTags<CsrfRefreshError>()({
    CsrfRefreshAuthenticationMismatch: () => schemaChanged(session),
    CsrfRefreshInitialStateMalformed: () => schemaChanged(session),
    CsrfRefreshNon2xxResponse: ({ status }) =>
      unauthorizedStatuses.has(status) ? deauthenticated(session) : retry(session, "server"),
    CsrfRefreshPersistenceFailure: () => retry(session, "persistence"),
    CsrfRefreshSessionDeauthenticated: () => deauthenticated(session),
    CsrfRefreshTokenUnchanged: () => authenticated(session),
    VoilaConnectionFailure: () => retry(session, "network"),
    VoilaRequestDeadlineExceeded: () => retry(session, "network"),
    VoilaResponseReadFailure: () => retry(session, "network")
  })(error)

export const confirmHomepageAuthentication = (
  session: SessionSnapshot,
  cookieJarPort: CookieJarPort
): Effect.Effect<HomepageAuthenticationResult, never, VoilaTransport> =>
  Effect.match(refreshSessionCsrf(session, "authenticated", cookieJarPort), {
    onFailure: (error) => classifyFailure(session, error),
    onSuccess: authenticated
  })
