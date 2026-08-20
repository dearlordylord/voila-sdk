import { KeepaliveConfigSchema, type KeepaliveHealthyIntervalMs } from "@firfi/voila-sdk"
import { Match, Result, Schema } from "effect"

import { makeKeepaliveConfig, type KeepaliveConfigFailure } from "./keepalive-runner.js"
import { StateFilePathSchema } from "@firfi/voila-session-store"

export const NodeEnvironmentSchema = Schema.Struct({
  VOILA_AUTH_SESSION_PATH: Schema.optionalKey(StateFilePathSchema),
  VOILA_GUEST: Schema.optionalKey(Schema.Literal("1")),
  VOILA_USER_AGENT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty()))
})

export type NodeEnvironmentConfig = Schema.Schema.Type<typeof NodeEnvironmentSchema>

/** Operator choice for an otherwise eligible authenticated startup. */
const KeepaliveOperatorModeSchema = Schema.Literals(["enabled", "disabled"])

export type KeepaliveOperatorMode = Schema.Schema.Type<typeof KeepaliveOperatorModeSchema>

/** Eligibility describes why the startup environment can or cannot own a loop. */
const KeepaliveEligibilitySchema = Schema.Literals(["authenticated-session", "guest", "missing-session"])

type KeepaliveEligibility = Schema.Schema.Type<typeof KeepaliveEligibilitySchema>

const KeepaliveIneligibleReasonSchema = Schema.Literals(["guest", "missing-session"])

/**
 * Startup owns exactly one state: disabled by policy, ineligible by
 * environment, or enabled with the fully validated loop configuration.
 */
export const KeepaliveStartupStateSchema = Schema.TaggedUnion({
  disabled: { reason: Schema.Literal("operator") },
  ineligible: { reason: KeepaliveIneligibleReasonSchema },
  enabled: { config: KeepaliveConfigSchema }
})

export type KeepaliveStartupState = Schema.Schema.Type<typeof KeepaliveStartupStateSchema>

interface KeepaliveStartupInput {
  readonly mode: KeepaliveOperatorMode
  readonly eligibility: KeepaliveEligibility
  readonly healthyIntervalMs?: KeepaliveHealthyIntervalMs
}

/** Keepalive is an authenticated startup concern, not an operation concern. */
export const keepaliveEligibilityFor = (config: NodeEnvironmentConfig): KeepaliveEligibility => {
  if (config.VOILA_GUEST === "1") {
    return "guest"
  }

  return config.VOILA_AUTH_SESSION_PATH === undefined ? "missing-session" : "authenticated-session"
}

const enabledState = (input: KeepaliveStartupInput): Result.Result<KeepaliveStartupState, KeepaliveConfigFailure> => {
  const config =
    input.healthyIntervalMs === undefined
      ? makeKeepaliveConfig()
      : makeKeepaliveConfig({ healthyIntervalMs: input.healthyIntervalMs })

  return Result.map(config, (value) => ({ _tag: "enabled", config: value }))
}

const disabledState = (): KeepaliveStartupState => ({ _tag: "disabled", reason: "operator" })
const guestState = (): KeepaliveStartupState => ({ _tag: "ineligible", reason: "guest" })
const missingSessionState = (): KeepaliveStartupState => ({ _tag: "ineligible", reason: "missing-session" })

/** Resolve startup inputs to an exhaustive, schema-owned state. */
const enabledStartupStateFor = (
  input: KeepaliveStartupInput
): Result.Result<KeepaliveStartupState, KeepaliveConfigFailure> =>
  Match.value(input.eligibility).pipe(
    Match.when("guest", () => Result.succeed(guestState())),
    Match.when("missing-session", () => Result.succeed(missingSessionState())),
    Match.when("authenticated-session", () => enabledState(input)),
    Match.exhaustive
  )

export const keepaliveStartupStateFor = (
  input: KeepaliveStartupInput
): Result.Result<KeepaliveStartupState, KeepaliveConfigFailure> =>
  Match.value(input.mode).pipe(
    Match.when("disabled", () => Result.succeed(disabledState())),
    Match.when("enabled", () => enabledStartupStateFor(input)),
    Match.exhaustive
  )
