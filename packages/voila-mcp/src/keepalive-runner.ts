import {
  checkSessionHealth,
  classifyHealthStatus,
  describeKeepaliveOutcome,
  type KeepaliveOutcome,
  type KeepaliveStopReason,
  type VoilaTransport
} from "@firfi/voila-sdk"
import { Cause, Duration, Effect, Exit, Fiber, Schedule, Schema } from "effect"

import { type OperationEnvironment, type OperationFailure } from "./operations.js"

const millisecondsPerSecond = 1_000
const secondsPerDay = 86_400
const secondsPerMinute = 60
const retryDelaySeconds = 30
const maxRetryDelayMinutes = 5

/**
 * What the keepalive loop waits for. The healthy interval is a fixed gap; the
 * retry delay backs off exponentially with jitter, capped at `maxRetryDelayMs`,
 * so a persistent outage is polite to an unofficial API rather than pinging it
 * every 30 s forever.
 */
export interface KeepaliveConfig {
  readonly healthyIntervalMs: number
  readonly maxRetryDelayMs: number
  readonly retryDelayMs: number
  readonly stopOnExpired: boolean
}

const defaultKeepaliveConfig: KeepaliveConfig = {
  healthyIntervalMs: secondsPerDay * millisecondsPerSecond,
  maxRetryDelayMs: maxRetryDelayMinutes * secondsPerMinute * millisecondsPerSecond,
  retryDelayMs: retryDelaySeconds * millisecondsPerSecond,
  stopOnExpired: false
}

const defaultForegroundKeepaliveConfig: KeepaliveConfig = { ...defaultKeepaliveConfig, stopOnExpired: true }

const makeConfig = (overrides: Partial<KeepaliveConfig> = {}): KeepaliveConfig => ({
  ...defaultKeepaliveConfig,
  ...overrides
})

/**
 * The redacted cause for a failed tick: only the failure `_tag` is surfaced, so
 * a cookie, token, or path can never reach the stderr log. The operation layer
 * already strips errors to a fixed `_tag`/`message` pair before they get here;
 * this keeps the boundary honest without re-deriving that redaction.
 */
const redactedCause = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string") {
    return error._tag
  }

  return "VoilaOperationFailed"
}

const checkFailed = (error: unknown): KeepaliveOutcome => ({ _tag: "check-failed", cause: redactedCause(error) })

const KeepaliveMisconfiguredErrorSchema = Schema.Struct({
  _tag: Schema.Literal("KeepaliveMisconfigured"),
  message: Schema.String
})

type KeepaliveMisconfiguredError = Schema.Schema.Type<typeof KeepaliveMisconfiguredErrorSchema>

type KeepaliveTickResult = KeepaliveOutcome | { readonly _tag: "misconfigured" }

const keepaliveMisconfigured = (): KeepaliveMisconfiguredError => ({
  _tag: "KeepaliveMisconfigured",
  message: "Configured authenticated session snapshot is missing or not authenticated"
})

const isMissingAuthenticatedSnapshot = (error: OperationFailure): boolean =>
  error._tag === "VoilaSessionSnapshotMissing"

const isRetryable = (outcome: KeepaliveOutcome): boolean =>
  outcome._tag === "transient" || outcome._tag === "check-failed"

/**
 * One keepalive tick: run the active-session health check inside the session
 * port's atomic read-modify-write cycle, so the rotated cookies persist through
 * the same guarded path every operation uses. A session-cycle failure or a
 * health-check failure is folded into a `check-failed` outcome carrying a
 * redacted cause; a missing or guest-shaped configured snapshot remains a typed
 * misconfiguration failure.
 */
export const runKeepaliveTick = (
  env: OperationEnvironment
): Effect.Effect<KeepaliveOutcome, KeepaliveMisconfiguredError, VoilaTransport> =>
  // The match folds ordinary session-cycle and health-check failures into a
  // retryable outcome, while the dedicated missing-snapshot failure remains a
  // typed error so the loop can stop as misconfigured instead of bootstrapping
  // a guest.
  Effect.matchEffect(
    env.session.withAuthenticatedSession((current) =>
      Effect.match(checkSessionHealth(current), {
        onFailure: (error) => ({ value: checkFailed(error) }),
        onSuccess: (health) => ({ refreshed: health.session, value: classifyHealthStatus(health.status) })
      })
    ),
    {
      onFailure: (error) =>
        isMissingAuthenticatedSnapshot(error)
          ? Effect.fail(keepaliveMisconfigured())
          : Effect.succeed(checkFailed(error)),
      onSuccess: Effect.succeed
    }
  )

const retrySchedule = (config: KeepaliveConfig): Schedule.Schedule<Duration.Duration, KeepaliveOutcome> =>
  // Capped, jittered exponential backoff: `min(exponential, spaced-cap)` grows
  // the delay on consecutive transient/failed ticks but never exceeds the cap,
  // and `jittered` spreads retries so a single outage does not synchronize.
  // The schedule is driven fresh on every settled episode, so a session that
  // recovers does not inherit the previous outage's delay.
  Schedule.min([Schedule.exponential(config.retryDelayMs), Schedule.spaced(config.maxRetryDelayMs)]).pipe(
    Schedule.jittered,
    // `Schedule.jittered` scales by 0.8..1.2, so applying it after the cap can
    // exceed `maxRetryDelayMs`. Clamp the actual post-jitter duration again at
    // the schedule boundary; this is the delay Effect.sleep observes.
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(Duration.millis(Math.min(Duration.toMillis(duration), config.maxRetryDelayMs)))
    )
  )

/**
 * The keepalive loop: tick, log, and wait. Transient and failed ticks back off
 * via `Effect.retry` with the capped, jittered schedule; settled ticks
 * (healthy, schema-changed, expired) end the retry episode, and the loop sleeps
 * for the healthy interval before the next one. The Effect is interruptible at
 * every `Effect.sleep`, so a supervising scope can stop it without a zombie.
 */
export const runKeepaliveLoop = (
  env: OperationEnvironment,
  config: KeepaliveConfig = defaultKeepaliveConfig,
  writeLine: (line: string) => void = (line) => void process.stderr.write(line)
): Effect.Effect<KeepaliveStopReason, never, VoilaTransport> => {
  const log = (outcome: KeepaliveOutcome): Effect.Effect<void> =>
    Effect.sync(() => writeLine(`voila keepalive: ${describeKeepaliveOutcome(outcome)}\n`))

  const misconfigured: KeepaliveTickResult = { _tag: "misconfigured" }
  const tickAndLog: Effect.Effect<KeepaliveTickResult, never, VoilaTransport> = Effect.matchEffect(
    runKeepaliveTick(env),
    {
      onFailure: () =>
        Effect.sync(() => writeLine("voila keepalive: configured authenticated session snapshot is missing\n")).pipe(
          Effect.as(misconfigured)
        ),
      onSuccess: (outcome) => Effect.map(log(outcome), () => outcome)
    }
  )

  const retryableTick: Effect.Effect<KeepaliveTickResult, KeepaliveOutcome, VoilaTransport> = Effect.flatMap(
    tickAndLog,
    (outcome): Effect.Effect<KeepaliveTickResult, KeepaliveOutcome> =>
      outcome._tag === "misconfigured"
        ? Effect.succeed(outcome)
        : isRetryable(outcome)
          ? Effect.fail(outcome)
          : Effect.succeed(outcome)
  )

  const retriedTick = Effect.retry<Duration.Duration, KeepaliveOutcome, never, never>(retrySchedule(config))(
    retryableTick
  )

  // The schedule recurs forever, so this is unreachable; folding the residual
  // error back to a settled outcome keeps the loop's error channel honest and
  // documents what a (never-occurring) exhaustion would surface.
  const settledTick: Effect.Effect<KeepaliveTickResult, never, VoilaTransport> = Effect.catch(
    retriedTick,
    (outcome: KeepaliveOutcome) => Effect.succeed<KeepaliveTickResult>(outcome)
  )

  return Effect.gen(function* () {
    const expired: KeepaliveStopReason = "expired"

    for (;;) {
      const settled = yield* settledTick

      if (settled._tag === "misconfigured") {
        return "misconfigured"
      }

      if (settled._tag === "expired" && config.stopOnExpired) {
        return expired
      }

      yield* Effect.sleep(config.healthyIntervalMs)
    }
  })
}

export type KeepaliveSignal = "SIGINT" | "SIGTERM"

export interface KeepaliveSignalPort {
  readonly add: (signal: KeepaliveSignal, listener: () => void) => void
  readonly remove: (signal: KeepaliveSignal, listener: () => void) => void
}

const processKeepaliveSignals: KeepaliveSignalPort = {
  add: (signal, listener) => {
    process.on(signal, listener)
  },
  remove: (signal, listener) => {
    process.off(signal, listener)
  }
}

/**
 * CLI wiring: run the keepalive loop in the foreground and translate the Effect
 * outcome into a stop reason. `Exit` inspection keeps the semantics honest — an
 * interrupted loop (Ctrl-C) is `"cancelled"`, a settled `"expired"` is
 * re-auth, and anything the loop returns is surfaced as-is.
 */
export const runKeepalive = async (
  env: OperationEnvironment,
  config: KeepaliveConfig = defaultForegroundKeepaliveConfig,
  writeLine: (line: string) => void = (line) => void process.stderr.write(line),
  signals: KeepaliveSignalPort = processKeepaliveSignals
): Promise<KeepaliveStopReason> => {
  const loopFiber = Effect.runFork(runKeepaliveLoop(env, config, writeLine).pipe(Effect.provide(env.transport)))
  const onSignal = (): void => {
    Effect.runFork(Fiber.interrupt(loopFiber))
  }

  let sigintAdded = false
  let sigtermAdded = false
  try {
    signals.add("SIGINT", onSignal)
    sigintAdded = true
    signals.add("SIGTERM", onSignal)
    sigtermAdded = true

    const exit = await Effect.runPromiseExit(Fiber.join(loopFiber))

    if (Exit.isSuccess(exit)) {
      return exit.value
    }

    if (Cause.hasInterruptsOnly(exit.cause)) {
      return "cancelled"
    }

    throw new Error("Voila keepalive failed")
  } finally {
    if (sigintAdded) {
      signals.remove("SIGINT", onSignal)
    }

    if (sigtermAdded) {
      signals.remove("SIGTERM", onSignal)
    }

    await Effect.runPromise(Fiber.interrupt(loopFiber))
  }
}

export { makeConfig as makeKeepaliveConfig }
