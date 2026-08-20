import { Schema, SchemaGetter } from "effect"

const millisecondsPerSecond = 1_000

/** The operator-facing minimum interval keeps the session check a background task. */
export const minimumKeepaliveIntervalSeconds = 3_600

/**
 * The largest whole-second interval that can be converted to milliseconds
 * without leaving JavaScript's safe-integer range.
 */
const maximumKeepaliveIntervalSeconds = Math.floor(Number.MAX_SAFE_INTEGER / millisecondsPerSecond)

const positiveMillisecondsSchema = Schema.Finite.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThan(0))
)

const intervalSecondsNumberSchema = Schema.Finite.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(minimumKeepaliveIntervalSeconds)),
  Schema.check(Schema.isLessThanOrEqualTo(maximumKeepaliveIntervalSeconds))
)

/**
 * Whole seconds accepted at the operator boundary. The encoded form is a
 * canonical decimal string so a fractional value, exponent, whitespace, or
 * unsafe conversion cannot sneak through environment parsing.
 */
export const KeepaliveIntervalSecondsSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)$/)),
  Schema.decodeTo(intervalSecondsNumberSchema, {
    decode: SchemaGetter.transform(Number),
    encode: SchemaGetter.transform(String)
  }),
  Schema.brand("KeepaliveIntervalSeconds")
)

export type KeepaliveIntervalSeconds = Schema.Schema.Type<typeof KeepaliveIntervalSecondsSchema>

/** Healthy polling interval in positive, safe whole milliseconds. */
export const KeepaliveHealthyIntervalMsSchema = positiveMillisecondsSchema.pipe(
  Schema.brand("KeepaliveHealthyIntervalMs")
)

export type KeepaliveHealthyIntervalMs = Schema.Schema.Type<typeof KeepaliveHealthyIntervalMsSchema>

/** Initial retry delay in positive, safe whole milliseconds. */
export const KeepaliveRetryDelayMsSchema = positiveMillisecondsSchema.pipe(Schema.brand("KeepaliveRetryDelayMs"))

export type KeepaliveRetryDelayMs = Schema.Schema.Type<typeof KeepaliveRetryDelayMsSchema>

/** Retry cap in positive, safe whole milliseconds. */
export const KeepaliveMaxRetryDelayMsSchema = positiveMillisecondsSchema.pipe(Schema.brand("KeepaliveMaxRetryDelayMs"))

export type KeepaliveMaxRetryDelayMs = Schema.Schema.Type<typeof KeepaliveMaxRetryDelayMsSchema>

/** Whether an expired session stops this keepalive owner or remains backgrounded. */
export const KeepaliveExpiryPolicySchema = Schema.Literals(["continue", "stop"])

export type KeepaliveExpiryPolicy = Schema.Schema.Type<typeof KeepaliveExpiryPolicySchema>

/** Runtime keepalive timing and expiry policy owned by the SDK domain schema. */
export const KeepaliveConfigSchema = Schema.Struct({
  healthyIntervalMs: KeepaliveHealthyIntervalMsSchema,
  maxRetryDelayMs: KeepaliveMaxRetryDelayMsSchema,
  retryDelayMs: KeepaliveRetryDelayMsSchema,
  expiryPolicy: KeepaliveExpiryPolicySchema
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (config) => config.maxRetryDelayMs >= config.retryDelayMs || "maxRetryDelayMs must be at least retryDelayMs"
    )
  )
)

export type KeepaliveConfig = Schema.Schema.Type<typeof KeepaliveConfigSchema>

/** Convert an already parsed interval to milliseconds, retaining a checked brand. */
export const keepaliveIntervalMsFromSeconds = (seconds: KeepaliveIntervalSeconds): KeepaliveHealthyIntervalMs =>
  Schema.decodeUnknownSync(KeepaliveHealthyIntervalMsSchema)(seconds * millisecondsPerSecond)
