import {
  KeepaliveHealthyIntervalMsSchema,
  KeepaliveMaxRetryDelayMsSchema,
  KeepaliveRetryDelayMsSchema,
  type KeepaliveOutcome,
  type KeepaliveExpiryPolicy,
  type KeepaliveStopReason,
  connectionFailure,
  type VoilaTransport,
  type VoilaTransportError
} from "@firfi/voila-sdk"
import { it as effectTest } from "@effect/vitest"
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Random, Result, Schedule } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"

import {
  type KeepaliveSignal,
  type KeepaliveSignalPort,
  runKeepalive,
  runKeepaliveLoop,
  runKeepaliveLoopWithRuntime,
  runKeepaliveTick
} from "../src/keepalive-runner.js"
import { type KeepaliveConfig, type KeepaliveConfigFailure, makeKeepaliveConfig } from "../src/index.js"
import type { OperationEnvironment, OperationFailure, SessionOperation } from "../src/operations.js"
import { makeStubEnvironment, stubTransportLayer, unusedTransportLayer } from "./helpers/operations.js"

const okBody = (
  body: unknown
): { readonly body: string; readonly headers: Readonly<Record<string, string>>; readonly status: number } => ({
  body: JSON.stringify(body),
  headers: {},
  status: 200
})

// A health-check response the runner classifies as healthy. The exact shape is
// owned by the SDK's session-health schema; the stub transport only has to
// return what that schema accepts for an active authenticated session.
const healthyResponse = (): {
  readonly body: string
  readonly headers: Readonly<Record<string, string>>
  readonly status: number
} => okBody({ authenticated: true })

const unauthorizedResponse = (): {
  readonly body: string
  readonly headers: Readonly<Record<string, string>>
  readonly status: number
} => ({ body: "{}", headers: {}, status: 401 })

interface TestKeepaliveConfigOverrides {
  readonly healthyIntervalMs?: number
  readonly maxRetryDelayMs?: number
  readonly retryDelayMs?: number
  readonly expiryPolicy?: KeepaliveExpiryPolicy
}

const makeTestKeepaliveConfig = (overrides: TestKeepaliveConfigOverrides = {}): KeepaliveConfig => {
  const config = makeKeepaliveConfig({
    ...(overrides.healthyIntervalMs === undefined
      ? {}
      : { healthyIntervalMs: KeepaliveHealthyIntervalMsSchema.make(overrides.healthyIntervalMs) }),
    ...(overrides.maxRetryDelayMs === undefined
      ? {}
      : { maxRetryDelayMs: KeepaliveMaxRetryDelayMsSchema.make(overrides.maxRetryDelayMs) }),
    ...(overrides.retryDelayMs === undefined
      ? {}
      : { retryDelayMs: KeepaliveRetryDelayMsSchema.make(overrides.retryDelayMs) }),
    ...(overrides.expiryPolicy === undefined ? {} : { expiryPolicy: overrides.expiryPolicy })
  })

  if (Result.isFailure(config)) {
    throw new Error(config.failure.message)
  }

  return config.success
}

const smallConfig: KeepaliveConfig = makeTestKeepaliveConfig({
  healthyIntervalMs: 5,
  retryDelayMs: 5,
  maxRetryDelayMs: 20,
  expiryPolicy: "stop"
})

const runTick = (env: OperationEnvironment): Promise<KeepaliveOutcome> =>
  Effect.runPromise(Effect.provide(runKeepaliveTick(env), env.transport))

const runLoop = (
  env: OperationEnvironment,
  config: KeepaliveConfig,
  writeLine: (line: string) => void = () => undefined
): Promise<KeepaliveStopReason> =>
  Effect.runPromise(Effect.provide(runKeepaliveLoop(env, config, writeLine), env.transport))

describe("keepalive runner", () => {
  const noSignals: KeepaliveSignalPort = { add: () => undefined, remove: () => undefined }

  it("returns a typed failure for a retry cap below the initial delay", () => {
    const result = makeKeepaliveConfig({
      retryDelayMs: KeepaliveRetryDelayMsSchema.make(10_000),
      maxRetryDelayMs: KeepaliveMaxRetryDelayMsSchema.make(5_000)
    })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      const failure: KeepaliveConfigFailure = result.failure

      expect(failure).toEqual({
        _tag: "KeepaliveConfigInvalid",
        message: "Keepalive configuration is invalid: maxRetryDelayMs must be at least retryDelayMs"
      })
    }
  })

  it("classifies an active session as healthy", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))

    expect((await runTick(env))._tag).toBe("healthy")
  })

  it("classifies an unauthorized session as expired", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(unauthorizedResponse()))

    expect((await runTick(env))._tag).toBe("expired")
  })

  it("classifies a changed active-session schema as schema-changed", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed({ body: "not-json", headers: {}, status: 200 }))

    expect((await runTick(env))._tag).toBe("schema-changed")
  })

  it("classifies a transport failure as a retryable transient outcome", async () => {
    const { env } = makeStubEnvironment(() => Effect.fail<VoilaTransportError>(connectionFailure()))

    expect((await runTick(env))._tag).toBe("transient")
  })

  it("classifies a typed health-check failure as a redacted check-failed outcome", async () => {
    const { env: base } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))
    const env: OperationEnvironment = {
      ...base,
      health: {
        check: () => Effect.fail({ _tag: "SessionHealthSnapshotInvalid", message: "snapshot details stay private" })
      }
    }

    expect(await runTick(env)).toEqual({ _tag: "check-failed", cause: "VoilaOperationFailed" })
  })

  it("classifies a session-cycle failure as a check-failed outcome with a redacted cause", async () => {
    const cycleFailure: OperationFailure = { _tag: "secret-cookie-value", message: "redacted" }
    const failingEnv: OperationEnvironment = {
      session: {
        // A withSession that fails the way the file cycle can — a typed
        // OperationFailure — surfaces as check-failed carrying only the failure
        // closed category, never an arbitrary tag or message (which may name a
        // cookie or a path).
        withSession: <A>(_operation: SessionOperation<A>): Effect.Effect<A, OperationFailure, VoilaTransport> =>
          Effect.fail(cycleFailure),
        withAuthenticatedSession: <A>(
          _operation: SessionOperation<A>
        ): Effect.Effect<A, OperationFailure, VoilaTransport> => Effect.fail(cycleFailure)
      },
      transport: unusedTransportLayer
    }

    expect(await runTick(failingEnv)).toEqual({ _tag: "check-failed", cause: "VoilaOperationFailed" })
  })

  effectTest.effect("settles transient and schema-changed retries before the next cadence", () =>
    Effect.gen(function* () {
      let requests = 0
      const { env } = makeStubEnvironment(() =>
        Effect.sync(() => {
          requests += 1
          return requests === 1
            ? { body: "{}", headers: {}, status: 503 }
            : requests === 2
              ? { body: "not-json", headers: {}, status: 200 }
              : unauthorizedResponse()
        })
      )
      const policy = makeTestKeepaliveConfig({ healthyIntervalMs: 10, expiryPolicy: "stop" })
      const finiteRetrySchedule = Schedule.recurs(-1).pipe(Schedule.map(() => Duration.millis(1)))
      const fiber = yield* Effect.forkChild(
        runKeepaliveLoopWithRuntime(env, policy, {
          logger: { writeLine: () => undefined },
          retrySchedule: finiteRetrySchedule
        }).pipe(Effect.provide(env.transport))
      )

      yield* Effect.yieldNow
      expect(requests).toBe(1)
      yield* TestClock.adjust("10 millis")
      yield* Effect.yieldNow
      expect(requests).toBe(2)
      yield* TestClock.adjust("10 millis")
      expect(yield* Fiber.join(fiber)).toBe("expired")
      expect(requests).toBe(3)
    })
  )

  effectTest.effect("continues after a settled check-failed tick", () =>
    Effect.gen(function* () {
      const observed = yield* Deferred.make<void>()
      const lines: Array<string> = []
      const cycleFailure: OperationFailure = { _tag: "VoilaCycleFailure", message: "session cycle failed" }
      const { env: base } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))
      const env: OperationEnvironment = {
        ...base,
        session: {
          withSession: base.session.withSession,
          withAuthenticatedSession: <A>(
            _operation: SessionOperation<A>
          ): Effect.Effect<A, OperationFailure, VoilaTransport> => Effect.fail(cycleFailure)
        }
      }
      const policy = makeTestKeepaliveConfig({ healthyIntervalMs: 10, expiryPolicy: "continue" })
      const finiteRetrySchedule = Schedule.recurs(0).pipe(Schedule.map(() => Duration.millis(1)))
      const fiber = yield* Effect.forkChild(
        runKeepaliveLoopWithRuntime(env, policy, {
          logger: {
            writeLine: (line) => {
              lines.push(line)
              if (lines.length === 1) {
                Effect.runSync(Deferred.succeed(observed, undefined))
              }
            }
          },
          retrySchedule: finiteRetrySchedule
        }).pipe(Effect.provide(env.transport))
      )

      yield* Deferred.await(observed)
      yield* TestClock.adjust("9 millis")
      yield* Effect.yieldNow
      expect(lines).toHaveLength(1)

      yield* TestClock.adjust("1 millis")
      yield* Effect.yieldNow
      expect(lines).toHaveLength(2)

      yield* Fiber.interrupt(fiber)
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
    })
  )

  effectTest.effect("continues after expiry when the policy remains backgrounded", () =>
    Effect.gen(function* () {
      const observed = yield* Deferred.make<void>()
      const { env } = makeStubEnvironment(() => Effect.succeed(unauthorizedResponse()))
      const policy = makeTestKeepaliveConfig({ healthyIntervalMs: 10, expiryPolicy: "continue" })
      const fiber = yield* Effect.forkChild(
        runKeepaliveLoop(env, policy, (line) => {
          if (line.includes("session requires re-authentication")) {
            Effect.runSync(Deferred.succeed(observed, undefined))
          }
        }).pipe(Effect.provide(env.transport))
      )

      yield* Deferred.await(observed)
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
    })
  )

  it("stops the loop on expiry when the policy opts in", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(unauthorizedResponse()))

    expect(await runLoop(env, smallConfig)).toBe("expired")
  })

  it("can be interrupted at a sleep rather than zombieing the process", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))
    const lines: Array<string> = []
    const observed = Deferred.makeUnsafe<void>()
    const policy = makeTestKeepaliveConfig({
      healthyIntervalMs: 60_000,
      maxRetryDelayMs: 20,
      retryDelayMs: 5,
      expiryPolicy: "continue"
    })

    const fiber = Effect.runFork(
      Effect.provide(
        runKeepaliveLoop(env, policy, (line) => {
          lines.push(line)
          Effect.runSync(Deferred.succeed(observed, undefined))
        }),
        env.transport
      )
    )

    await Effect.runPromise(Deferred.await(observed))
    await Effect.runPromise(Fiber.interrupt(fiber))
    const exit = await Effect.runPromise(Fiber.await(fiber))

    expect(Exit.isFailure(exit)).toBe(true)
    expect(lines[0]).toContain("voila keepalive: session active")
  })

  effectTest.effect("waits exactly the configured healthy interval between settled checks", () =>
    Effect.gen(function* () {
      const firstAttempt = yield* Deferred.make<void>()
      const secondAttempt = yield* Deferred.make<void>()
      let requests = 0
      const { env } = makeStubEnvironment(() =>
        Effect.sync(() => {
          requests += 1

          if (requests === 1) {
            Effect.runSync(Deferred.succeed(firstAttempt, undefined))

            return healthyResponse()
          }

          Effect.runSync(Deferred.succeed(secondAttempt, undefined))

          return unauthorizedResponse()
        })
      )
      const policy = makeTestKeepaliveConfig({
        healthyIntervalMs: 100,
        retryDelayMs: 10,
        maxRetryDelayMs: 100,
        expiryPolicy: "stop"
      })
      const fiber = yield* Effect.forkChild(runKeepaliveLoop(env, policy).pipe(Effect.provide(env.transport)))

      yield* Deferred.await(firstAttempt)
      yield* TestClock.adjust("99 millis")
      yield* Effect.yieldNow
      expect(Deferred.isDoneUnsafe(secondAttempt)).toBe(false)

      yield* TestClock.adjust("1 millis")
      yield* Deferred.await(secondAttempt)
      expect(yield* Fiber.join(fiber)).toBe("expired")
    })
  )

  effectTest.effect("progresses retries with jittered exponential backoff", () =>
    Effect.gen(function* () {
      const attempts: Array<Deferred.Deferred<void>> = [
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>()
      ]
      const attemptSignal = (index: number) => {
        const signal = attempts.at(index)

        if (signal === undefined) {
          throw new Error(`Missing attempt signal ${index}`)
        }

        return signal
      }
      let requests = 0
      const transport = stubTransportLayer(() =>
        Effect.sync(() => {
          const attempt = requests
          requests += 1
          Effect.runSync(Deferred.succeed(attemptSignal(attempt), undefined))

          return attempt === 2 ? unauthorizedResponse() : { body: "{}", headers: {}, status: 503 }
        })
      )
      const base = makeStubEnvironment(() => Effect.succeed(healthyResponse())).env
      const env: OperationEnvironment = { ...base, transport }
      const policy = makeTestKeepaliveConfig({
        healthyIntervalMs: 100,
        retryDelayMs: 10,
        maxRetryDelayMs: 100,
        expiryPolicy: "stop"
      })
      const fiber = yield* Effect.forkChild(
        runKeepaliveLoop(env, policy).pipe(Effect.provide(env.transport), Random.withSeed("retry-progression"))
      )

      yield* Deferred.await(attemptSignal(0))
      yield* TestClock.adjust("7 millis")
      yield* Effect.yieldNow
      expect(Deferred.isDoneUnsafe(attemptSignal(1))).toBe(false)
      yield* TestClock.adjust("6 millis")
      yield* Deferred.await(attemptSignal(1))

      yield* TestClock.adjust("10 millis")
      yield* Effect.yieldNow
      expect(Deferred.isDoneUnsafe(attemptSignal(2))).toBe(false)
      yield* TestClock.adjust("20 millis")
      yield* Deferred.await(attemptSignal(2))
      expect(yield* Fiber.join(fiber)).toBe("expired")
    })
  )

  effectTest.effect("resets retry progression after a healthy recovery", () =>
    Effect.gen(function* () {
      const attempts: Array<Deferred.Deferred<void>> = [
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>()
      ]
      const attemptSignal = (index: number) => {
        const signal = attempts.at(index)

        if (signal === undefined) {
          throw new Error(`Missing attempt signal ${index}`)
        }

        return signal
      }
      let requests = 0
      const transport = stubTransportLayer(() =>
        Effect.sync(() => {
          const attempt = requests
          requests += 1
          Effect.runSync(Deferred.succeed(attemptSignal(attempt), undefined))

          return attempt === 0 || attempt === 2
            ? { body: "{}", headers: {}, status: 503 }
            : attempt === 1
              ? healthyResponse()
              : unauthorizedResponse()
        })
      )
      const base = makeStubEnvironment(() => Effect.succeed(healthyResponse())).env
      const env: OperationEnvironment = { ...base, transport }
      const policy = makeTestKeepaliveConfig({
        healthyIntervalMs: 100,
        retryDelayMs: 10,
        maxRetryDelayMs: 100,
        expiryPolicy: "stop"
      })
      const fiber = yield* Effect.forkChild(
        runKeepaliveLoop(env, policy).pipe(Effect.provide(env.transport), Random.withSeed("retry-reset"))
      )

      yield* Deferred.await(attemptSignal(0))
      yield* TestClock.adjust("13 millis")
      yield* Deferred.await(attemptSignal(1))
      yield* TestClock.adjust("100 millis")
      yield* Deferred.await(attemptSignal(2))

      yield* TestClock.adjust("7 millis")
      yield* Effect.yieldNow
      expect(Deferred.isDoneUnsafe(attemptSignal(3))).toBe(false)
      yield* TestClock.adjust("6 millis")
      yield* Deferred.await(attemptSignal(3))
      expect(yield* Fiber.join(fiber)).toBe("expired")
    })
  )

  effectTest.effect("interrupts while a retry is sleeping", () =>
    Effect.gen(function* () {
      const firstAttempt = yield* Deferred.make<void>()
      let requests = 0
      const transport = stubTransportLayer(() =>
        Effect.sync(() => {
          requests += 1
          Effect.runSync(Deferred.succeed(firstAttempt, undefined))

          return { body: "{}", headers: {}, status: 503 }
        })
      )
      const base = makeStubEnvironment(() => Effect.succeed(healthyResponse())).env
      const env: OperationEnvironment = { ...base, transport }
      const policy = makeTestKeepaliveConfig({
        healthyIntervalMs: 100,
        retryDelayMs: 10,
        maxRetryDelayMs: 100,
        expiryPolicy: "continue"
      })
      const fiber = yield* Effect.forkChild(runKeepaliveLoop(env, policy).pipe(Effect.provide(env.transport)))

      yield* Deferred.await(firstAttempt)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(requests).toBe(1)
    })
  )

  it("stops as misconfigured when the authenticated session snapshot is missing", async () => {
    const missing: OperationFailure = {
      _tag: "VoilaSessionSnapshotMissing",
      message: "Configured authenticated session snapshot is missing or not authenticated"
    }
    const env: OperationEnvironment = {
      session: { withAuthenticatedSession: () => Effect.fail(missing), withSession: () => Effect.fail(missing) },
      transport: unusedTransportLayer
    }

    expect(await runLoop(env, smallConfig)).toBe("misconfigured")
  })

  it("bridges SIGINT into cancellation and removes both signal listeners", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))
    const started = Deferred.makeUnsafe<void>()
    const listeners = new Map<KeepaliveSignal, () => void>()
    const removed: Array<KeepaliveSignal> = []
    const signals: KeepaliveSignalPort = {
      add: (signal, listener) => listeners.set(signal, listener),
      remove: (signal) => {
        removed.push(signal)
        listeners.delete(signal)
      }
    }
    const policy = makeTestKeepaliveConfig({
      healthyIntervalMs: 60_000,
      maxRetryDelayMs: 20,
      retryDelayMs: 5,
      expiryPolicy: "continue"
    })

    const running = runKeepalive(env, policy, () => Effect.runSync(Deferred.succeed(started, undefined)), signals)

    await Effect.runPromise(Deferred.await(started))
    listeners.get("SIGINT")?.()

    await expect(running).resolves.toBe("cancelled")
    expect(removed).toEqual(["SIGINT", "SIGTERM"])
    expect(listeners.size).toBe(0)
  })

  it("bridges SIGTERM into cancellation and removes both signal listeners", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))
    const started = Deferred.makeUnsafe<void>()
    const listeners = new Map<KeepaliveSignal, () => void>()
    const removed: Array<KeepaliveSignal> = []
    const signals: KeepaliveSignalPort = {
      add: (signal, listener) => listeners.set(signal, listener),
      remove: (signal) => {
        removed.push(signal)
        listeners.delete(signal)
      }
    }
    const policy = makeTestKeepaliveConfig({ healthyIntervalMs: 60_000, expiryPolicy: "continue" })

    const running = runKeepalive(env, policy, () => Effect.runSync(Deferred.succeed(started, undefined)), signals)

    await Effect.runPromise(Deferred.await(started))
    listeners.get("SIGTERM")?.()

    await expect(running).resolves.toBe("cancelled")
    expect(removed).toEqual(["SIGINT", "SIGTERM"])
    expect(listeners.size).toBe(0)
  })

  it("cleans up a partially registered signal set", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))
    const removed: Array<KeepaliveSignal> = []
    const signals: KeepaliveSignalPort = {
      add: (signal) => {
        if (signal === "SIGTERM") {
          throw new Error("signal registration failed")
        }
      },
      remove: (signal) => {
        removed.push(signal)
      }
    }

    await expect(
      runKeepalive(env, makeTestKeepaliveConfig({ healthyIntervalMs: 60_000 }), () => undefined, signals)
    ).rejects.toThrow("signal registration failed")
    expect(removed).toEqual(["SIGINT"])
  })

  it("does not remove a signal that failed to register", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))
    const removed: Array<KeepaliveSignal> = []
    const signals: KeepaliveSignalPort = {
      add: (signal) => {
        if (signal === "SIGINT") {
          throw new Error("signal registration failed")
        }
      },
      remove: (signal) => {
        removed.push(signal)
      }
    }

    await expect(
      runKeepalive(env, makeTestKeepaliveConfig({ healthyIntervalMs: 60_000 }), () => undefined, signals)
    ).rejects.toThrow("signal registration failed")
    expect(removed).toEqual([])
  })

  it("uses an expiry-stopping foreground default", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(unauthorizedResponse()))

    await expect(runKeepalive(env, undefined, () => undefined, noSignals)).resolves.toBe("expired")
  })

  it("uses the process signal port and default stderr writer for a settled expiry", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(unauthorizedResponse()))

    await expect(runKeepalive(env, smallConfig)).resolves.toBe("expired")
  })

  it("rejects defect exits instead of reporting cancellation", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))

    await expect(
      runKeepalive(
        env,
        makeTestKeepaliveConfig({ healthyIntervalMs: 60_000 }),
        () => {
          throw new Error("secret defect")
        },
        noSignals
      )
    ).rejects.toThrow("Voila keepalive failed")
  })

  effectTest.effect("never schedules a jittered retry beyond maxRetryDelayMs", () =>
    Effect.gen(function* () {
      const firstAttempt = yield* Deferred.make<void>()
      const secondAttempt = yield* Deferred.make<void>()
      let requests = 0
      const transport = stubTransportLayer(() =>
        Effect.sync(() => {
          requests += 1

          if (requests === 1) {
            Effect.runSync(Deferred.succeed(firstAttempt, undefined))

            return { body: "{}", headers: {}, status: 503 }
          }

          Effect.runSync(Deferred.succeed(secondAttempt, undefined))

          return { body: "{}", headers: {}, status: 401 }
        })
      )
      const base = makeStubEnvironment(() => Effect.succeed(healthyResponse())).env
      const env: OperationEnvironment = { ...base, transport }
      const policy = makeTestKeepaliveConfig({
        healthyIntervalMs: 60_000,
        maxRetryDelayMs: 20,
        retryDelayMs: 20,
        expiryPolicy: "stop"
      })
      const fiber = yield* Effect.forkChild(
        runKeepaliveLoop(env, policy).pipe(Effect.provide(env.transport), Random.withSeed("seed-1"))
      )

      yield* Deferred.await(firstAttempt)
      yield* TestClock.adjust("20 millis")
      yield* Effect.yieldNow
      const secondAttemptAtCap = Deferred.isDoneUnsafe(secondAttempt)

      yield* TestClock.adjust("20 millis")
      const reason = yield* Fiber.join(fiber)

      expect(secondAttemptAtCap).toBe(true)
      expect(reason).toBe("expired")
    })
  )

  it("provides the transport as a layer, never a patched module", () => {
    expect(Layer.isLayer(makeStubEnvironment(() => Effect.succeed(healthyResponse())).env.transport)).toBe(true)
  })
})
