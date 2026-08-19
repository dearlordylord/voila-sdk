import type { KeepaliveConfig } from "./keepalive-runner.js"
import { makeKeepaliveConfig } from "./keepalive-runner.js"
import { StateFilePathSchema } from "@firfi/voila-session-store"
import { Schema } from "effect"

export const NodeEnvironmentSchema = Schema.Struct({
  VOILA_AUTH_SESSION_PATH: Schema.optionalKey(StateFilePathSchema),
  VOILA_GUEST: Schema.optionalKey(Schema.Literal("1")),
  VOILA_USER_AGENT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty()))
})

export type NodeEnvironmentConfig = Schema.Schema.Type<typeof NodeEnvironmentSchema>

interface KeepaliveStartupRuntime {
  readonly keepaliveDisabled: boolean
  readonly keepaliveIntervalMs: number | undefined
}

/** Keepalive is an authenticated startup concern, not an operation concern. */
export const keepaliveEligibleFor = (config: NodeEnvironmentConfig): boolean =>
  config.VOILA_GUEST !== "1" && config.VOILA_AUTH_SESSION_PATH !== undefined

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
