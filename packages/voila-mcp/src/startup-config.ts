import type { KeepaliveConfig } from "./keepalive-runner.js"
import { makeKeepaliveConfig } from "./keepalive-runner.js"

interface KeepaliveStartupRuntime {
  readonly keepaliveDisabled: boolean
  readonly keepaliveIntervalMs: number | undefined
}

/** Keepalive is an authenticated startup concern, not an operation concern. */
export const keepaliveEligibleFor = (env: Readonly<Record<string, string | undefined>>): boolean =>
  env.VOILA_GUEST !== "1" && env.VOILA_AUTH_SESSION_PATH !== undefined

export const keepaliveConfigFor = (
  runtime: KeepaliveStartupRuntime,
  eligible: boolean
): KeepaliveConfig | undefined => {
  if (runtime.keepaliveDisabled || !eligible) {
    return undefined
  }

  return makeKeepaliveConfig({
    ...(runtime.keepaliveIntervalMs === undefined ? {} : { healthyIntervalMs: runtime.keepaliveIntervalMs })
  })
}
