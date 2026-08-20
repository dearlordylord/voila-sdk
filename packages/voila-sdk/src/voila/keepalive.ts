import { Match, Schema } from "effect"

import type { SessionHealth } from "../domain/schemas/index.js"

/**
 * Keepalive functional core.
 *
 * Voila sessions have no OAuth-style refresh token; authentication is carried by
 * the cookie jar (with server-side sliding expiry) plus the CSRF token. Each
 * keepalive tick re-runs the active-session health check inside the session
 * port's atomic read-modify-write cycle, so the rotated cookies land on disk
 * through the same guarded path every other operation uses — and a re-login
 * that lands between two ticks is adopted rather than reverted.
 *
 * This module holds only the pure decisions that classify a session-health
 * status and describe a tick outcome. The loop itself — sequencing, sleeps, and
 * backoff — lives in the Effect-native runner, where Effect's `Schedule` can own
 * the retry backoff and the loop can be run as a supervised, interruptible
 * fiber. Keeping these classifiers pure means they stay deterministic and
 * testable without touching the real clock or transport.
 */

// Boundary-adjacent type: derived from the SDK SessionHealth contract rather than
// re-declared, so keepalive classification cannot drift from the health schema.
export type SessionHealthStatus = SessionHealth["status"]

/**
 * What one keepalive tick produced. `check-failed` carries one closed,
 * redacted category so logs can describe a retry without exposing an arbitrary
 * error tag, cookie, token, or path.
 */
export const KeepaliveOutcomeSchema = Schema.TaggedUnion({
  healthy: {},
  transient: {},
  "schema-changed": {},
  expired: {},
  "check-failed": { cause: Schema.Literal("VoilaOperationFailed") }
})

export type KeepaliveOutcome = Schema.Schema.Type<typeof KeepaliveOutcomeSchema>

/**
 * Why the loop stopped. `"expired"` means the session needs re-authentication;
 * `"cancelled"` means the loop was interrupted (Ctrl-C, scope shutdown); and
 * `"misconfigured"` means it never started cleanly — the session file is absent
 * or the environment is invalid, neither of which is fixed by re-authenticating.
 */
export const KeepaliveStopReasonSchema = Schema.Literals(["expired", "cancelled", "misconfigured"])

export type KeepaliveStopReason = Schema.Schema.Type<typeof KeepaliveStopReasonSchema>

/**
 * Map a session-health status to a keepalive outcome. This is the schema-drift
 * boundary the project cares about: an exhaustive matcher means a future
 * `SessionHealth["status"]` fails to compile here rather than silently
 * returning `undefined` at runtime.
 */
const healthyOutcome = (): KeepaliveOutcome => ({ _tag: "healthy" })
const transientOutcome = (): KeepaliveOutcome => ({ _tag: "transient" })
const schemaChangedOutcome = (): KeepaliveOutcome => ({ _tag: "schema-changed" })
const expiredOutcome = (): KeepaliveOutcome => ({ _tag: "expired" })

export const classifyHealthStatus = Match.type<SessionHealthStatus>().pipe(
  Match.when("active", healthyOutcome),
  Match.when("retry", transientOutcome),
  Match.when("schema-changed", schemaChangedOutcome),
  Match.when("reauth-required", expiredOutcome),
  Match.when("unauthorized", expiredOutcome),
  Match.exhaustive
)

/**
 * Describe a tick outcome for the stderr log. The `check-failed` description
 * folds in the redacted cause when present, so an operator can see why the loop
 * is retrying without the cause having to cross this boundary as a raw error.
 */
export const describeKeepaliveOutcome = KeepaliveOutcomeSchema.match({
  healthy: () => "session active; cookies refreshed",
  transient: () => "transient error during session check; will retry",
  "schema-changed": () => "active-session endpoint schema changed; session still refreshed",
  expired: () => "session requires re-authentication; run `voila auth login`",
  "check-failed": ({ cause }) => `session keepalive check failed (${cause}); will retry`
})
