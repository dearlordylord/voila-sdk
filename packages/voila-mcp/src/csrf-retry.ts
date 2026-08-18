import { refreshSessionCsrf, type SessionSnapshot, type VoilaJsonResult, type VoilaTransport } from "@firfi/voila-sdk"
import { Effect } from "effect"

const unauthorizedTag = "VoilaUnauthorizedSession"

const isUnauthorizedSessionError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === unauthorizedTag

/**
 * Voila rotates the CSRF token while the session cookies stay valid, and only
 * writes are checked against it: the first symptom is a 403 on a cart mutation
 * from a session whose reads all still work. One refresh, one retry — a refresh
 * that fails, or that finds the same token, leaves the original 403 standing,
 * so an expired login still reports as an expired login rather than looping.
 */
export const withCsrfRefreshRetry = (
  session: SessionSnapshot,
  attempt: (session: SessionSnapshot) => Effect.Effect<VoilaJsonResult<unknown>, unknown, VoilaTransport>
): Effect.Effect<VoilaJsonResult<unknown>, unknown, VoilaTransport> =>
  Effect.catch(attempt(session), (error) =>
    isUnauthorizedSessionError(error)
      ? Effect.matchEffect(refreshSessionCsrf(session), { onFailure: () => Effect.fail(error), onSuccess: attempt })
      : Effect.fail(error)
  )
