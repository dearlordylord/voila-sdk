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
 * What one keepalive tick produced. `check-failed` carries a redacted cause so
 * logs show why a retry is happening without leaking cookies or tokens: the
 * message arrives already stripped to a fixed `_tag`/`message` pair by the
 * operation layer's `redactError`.
 */
export type KeepaliveOutcome =
  | { readonly _tag: "healthy" }
  | { readonly _tag: "transient" }
  | { readonly _tag: "schema-changed" }
  | { readonly _tag: "expired" }
  | { readonly _tag: "check-failed"; readonly cause?: string }

/**
 * Why the loop stopped. `"expired"` means the session needs re-authentication;
 * `"cancelled"` means the loop was interrupted (Ctrl-C, scope shutdown); and
 * `"misconfigured"` means it never started cleanly — the session file is absent
 * or the environment is invalid, neither of which is fixed by re-authenticating.
 */
export type KeepaliveStopReason = "expired" | "cancelled" | "misconfigured"

const assertNever = (value: never): never => {
  throw new Error(`Keepalive reached an unexpected state: ${JSON.stringify(value)}`)
}

/**
 * Map a session-health status to a keepalive outcome. This is the schema-drift
 * boundary the project cares about: an exhaustive switch with an `assertNever`
 * default means a future `SessionHealth["status"]` fails to compile here rather
 * than silently returning `undefined` at runtime.
 */
export const classifyHealthStatus = (status: SessionHealthStatus): KeepaliveOutcome => {
  switch (status) {
    case "active":
      return { _tag: "healthy" }
    case "retry":
      return { _tag: "transient" }
    case "schema-changed":
      return { _tag: "schema-changed" }
    case "reauth-required":
    case "unauthorized":
      return { _tag: "expired" }
    default:
      return assertNever(status)
  }
}

/**
 * Describe a tick outcome for the stderr log. The `check-failed` description
 * folds in the redacted cause when present, so an operator can see why the loop
 * is retrying without the cause having to cross this boundary as a raw error.
 */
export const describeKeepaliveOutcome = (outcome: KeepaliveOutcome): string => {
  switch (outcome._tag) {
    case "healthy":
      return "session active; cookies refreshed"
    case "transient":
      return "transient error during session check; will retry"
    case "schema-changed":
      return "active-session endpoint schema changed; session still refreshed"
    case "expired":
      return "session requires re-authentication; run `voila auth login`"
    case "check-failed":
      return outcome.cause === undefined
        ? "session keepalive check failed; will retry"
        : `session keepalive check failed (${outcome.cause}); will retry`
    default:
      return assertNever(outcome)
  }
}
