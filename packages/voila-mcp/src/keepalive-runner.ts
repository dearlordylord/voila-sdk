import {
  checkSessionHealth,
  classifyHealthStatus,
  describeKeepaliveOutcome,
  type KeepaliveOutcome,
  type KeepaliveStopReason,
  type VoilaTransport
} from "@firfi/voila-sdk"
import { type Duration, Effect, Exit, Schedule } from "effect"

import { type OperationEnvironment } from "./operations.js"

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

export const defaultKeepaliveConfig: KeepaliveConfig = {
  healthyIntervalMs: secondsPerDay * millisecondsPerSecond,
  maxRetryDelayMs: maxRetryDelayMinutes * secondsPerMinute * millisecondsPerSecond,
  retryDelayMs: retryDelaySeconds * millisecondsPerSecond,
  stopOnExpired: false
}

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

const isRetryable = (outcome: KeepaliveOutcome): boolean =>
  outcome._tag === "transient" || outcome._tag === "check-failed"

/**
 * One keepalive tick: run the active-session health check inside the session
 * port's atomic read-modify-write cycle, so the rotated cookies persist through
 * the same guarded path every operation uses. The tick never fails: a
 * `withSession` cycle failure or a health-check failure is folded into a
 * `check-failed` outcome carrying a redacted cause, so the loop's retry logic
 * only ever sees a `KeepaliveOutcome`.
 */
export const runKeepaliveTick = (env: OperationEnvironment): Effect.Effect<KeepaliveOutcome, never, VoilaTransport> =>
  // The inner match folds the health check's two channels into a session-cycle
  // outcome; the outer `catch` folds a session-cycle failure into a check-failed
  // outcome on the success channel, so the loop only ever sees a KeepaliveOutcome.
  Effect.catch(
    env.session.withSession((current) =>
      Effect.match(checkSessionHealth(current), {
        onFailure: (error) => ({ value: checkFailed(error) }),
        onSuccess: (health) => ({ refreshed: health.session, value: classifyHealthStatus(health.status) })
      })
    ),
    (cycleError) => Effect.succeed(checkFailed(cycleError))
  )

const retrySchedule = (config: KeepaliveConfig): Schedule.Schedule<Duration.Duration, KeepaliveOutcome> =>
  // Capped, jittered exponential backoff: `min(exponential, spaced-cap)` grows
  // the delay on consecutive transient/failed ticks but never exceeds the cap,
  // and `jittered` spreads retries so a single outage does not synchronize.
  // The schedule is driven fresh on every settled episode, so a session that
  // recovers does not inherit the previous outage's delay.
  Schedule.min([Schedule.exponential(config.retryDelayMs), Schedule.spaced(config.maxRetryDelayMs)]).pipe(
    Schedule.jittered
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

  const tickAndLog = runKeepaliveTick(env).pipe(Effect.tap(log))

  const settledTick = tickAndLog.pipe(
    Effect.flatMap((outcome) => (isRetryable(outcome) ? Effect.fail(outcome) : Effect.succeed(outcome))),
    Effect.retry(retrySchedule(config)),
    // The schedule recurs forever, so this is unreachable; folding the residual
    // error back to a settled outcome keeps the loop's error channel honest and
    // documents what a (never-occurring) exhaustion would surface.
    Effect.catch((outcome: KeepaliveOutcome) => Effect.succeed(outcome))
  )

  return Effect.gen(function* () {
    const expired: KeepaliveStopReason = "expired"

    for (;;) {
      const settled = yield* settledTick

      if (settled._tag === "expired" && config.stopOnExpired) {
        return expired
      }

      yield* Effect.sleep(config.healthyIntervalMs)
    }
  })
}

/**
 * CLI wiring: run the keepalive loop in the foreground and translate the Effect
 * outcome into a stop reason. `Exit` inspection keeps the semantics honest — an
 * interrupted loop (Ctrl-C) is `"cancelled"`, a settled `"expired"` is
 * re-auth, and anything the loop returns is surfaced as-is.
 */
export const runKeepalive = async (
  env: OperationEnvironment,
  config: KeepaliveConfig = defaultKeepaliveConfig,
  writeLine: (line: string) => void = (line) => void process.stderr.write(line)
): Promise<KeepaliveStopReason> => {
  const exit = await Effect.runPromiseExit(runKeepaliveLoop(env, config, writeLine).pipe(Effect.provide(env.transport)))

  if (Exit.isSuccess(exit)) {
    return exit.value
  }

  return "cancelled"
}

export { makeConfig as makeKeepaliveConfig }
