import type { SessionHealth } from "../domain/schemas/index.js"

/**
 * Keepalive functional core.
 *
 * Voila sessions have no OAuth-style refresh token; authentication is carried by
 * the cookie jar (with server-side sliding expiry) plus the CSRF token. Every
 * request folds `Set-Cookie` back into the persisted snapshot, so periodically
 * re-running the active-session health check keeps the stored cookies warm and
 * detects when the account has dropped to a re-auth-required state.
 *
 * This module contains only pure decisions. All time and I/O are supplied by the
 * caller through the injected ports below, so the loop stays deterministic and
 * testable without touching the real clock.
 */

// Boundary-adjacent type: derived from the SDK SessionHealth contract rather than
// re-declared, so keepalive classification cannot drift from the health schema.
export type SessionHealthStatus = SessionHealth["status"]

export type KeepaliveOutcome =
  | { readonly _tag: "healthy" }
  | { readonly _tag: "transient" }
  | { readonly _tag: "schema-changed" }
  | { readonly _tag: "expired" }
  | { readonly _tag: "check-failed" }

export interface KeepalivePolicy {
  readonly healthyIntervalMs: number
  readonly retryDelayMs: number
  readonly stopOnExpired: boolean
}

export type KeepaliveStopReason = "expired" | "cancelled"

export type KeepaliveDecision =
  | { readonly _tag: "wait"; readonly delayMs: number }
  | { readonly _tag: "stop"; readonly reason: "expired" }

const secondsPerDay = 86_400
const millisecondsPerSecond = 1_000
const defaultHealthyIntervalMs = secondsPerDay * millisecondsPerSecond
const defaultRetryDelayMs = 30_000

export const defaultKeepalivePolicy: KeepalivePolicy = {
  healthyIntervalMs: defaultHealthyIntervalMs,
  retryDelayMs: defaultRetryDelayMs,
  stopOnExpired: false
}

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
  }
}

export const decideKeepaliveStep = (policy: KeepalivePolicy, outcome: KeepaliveOutcome): KeepaliveDecision => {
  switch (outcome._tag) {
    case "healthy":
    case "schema-changed":
      return { _tag: "wait", delayMs: policy.healthyIntervalMs }
    case "transient":
    case "check-failed":
      return { _tag: "wait", delayMs: policy.retryDelayMs }
    case "expired":
      return policy.stopOnExpired
        ? { _tag: "stop", reason: "expired" }
        : { _tag: "wait", delayMs: policy.healthyIntervalMs }
  }
}

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
      return "session keepalive check failed; will retry"
  }
}

export interface KeepaliveLoopDeps {
  readonly isCancelled: () => boolean
  readonly log: (message: string) => void
  readonly sleep: (delayMs: number) => Promise<void>
  readonly tick: () => Promise<KeepaliveOutcome>
}

export const runKeepaliveLoop = async (
  policy: KeepalivePolicy,
  deps: KeepaliveLoopDeps
): Promise<KeepaliveStopReason> => {
  for (;;) {
    if (deps.isCancelled()) {
      return "cancelled"
    }

    const outcome = await deps.tick()
    deps.log(describeKeepaliveOutcome(outcome))

    const decision = decideKeepaliveStep(policy, outcome)

    if (decision._tag === "stop") {
      return decision.reason
    }

    // sleep resolves early when cancelled; the loop head re-checks isCancelled.
    await deps.sleep(decision.delayMs)
  }
}
