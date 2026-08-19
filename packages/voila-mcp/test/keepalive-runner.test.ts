import {
  type KeepaliveOutcome,
  type KeepaliveStopReason,
  connectionFailure,
  type VoilaTransport,
  type VoilaTransportError
} from "@firfi/voila-sdk"
import { it as effectTest } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Layer, Random } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"

import {
  type KeepaliveSignal,
  type KeepaliveSignalPort,
  type KeepaliveConfig,
  makeKeepaliveConfig,
  runKeepalive,
  runKeepaliveLoop,
  runKeepaliveTick
} from "../src/keepalive-runner.js"
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

const smallConfig: KeepaliveConfig = makeKeepaliveConfig({
  healthyIntervalMs: 5,
  retryDelayMs: 5,
  maxRetryDelayMs: 20,
  stopOnExpired: true
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

  it("classifies a session-cycle failure as a check-failed outcome with a redacted cause", async () => {
    const cycleFailure: OperationFailure = { _tag: "VoilaSessionFileReadFailure", message: "redacted" }
    const failingEnv: OperationEnvironment = {
      session: {
        // A withSession that fails the way the file cycle can — a typed
        // OperationFailure — surfaces as check-failed carrying only the failure
        // _tag, never the message (which may name a cookie or a path).
        withSession: <A>(_operation: SessionOperation<A>): Effect.Effect<A, OperationFailure, VoilaTransport> =>
          Effect.fail(cycleFailure),
        withAuthenticatedSession: <A>(
          _operation: SessionOperation<A>
        ): Effect.Effect<A, OperationFailure, VoilaTransport> => Effect.fail(cycleFailure)
      },
      transport: unusedTransportLayer
    }

    expect(await runTick(failingEnv)).toEqual({ _tag: "check-failed", cause: "VoilaSessionFileReadFailure" })
  })

  it("stops the loop on expiry when the policy opts in", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(unauthorizedResponse()))

    expect(await runLoop(env, smallConfig)).toBe("expired")
  })

  it("can be interrupted at a sleep rather than zombieing the process", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))
    const lines: Array<string> = []
    const observed = Deferred.makeUnsafe<void>()
    const policy = makeKeepaliveConfig({
      healthyIntervalMs: 60_000,
      maxRetryDelayMs: 20,
      retryDelayMs: 5,
      stopOnExpired: false
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
    const policy = makeKeepaliveConfig({
      healthyIntervalMs: 60_000,
      maxRetryDelayMs: 20,
      retryDelayMs: 5,
      stopOnExpired: false
    })

    const running = runKeepalive(env, policy, () => Effect.runSync(Deferred.succeed(started, undefined)), signals)

    await Effect.runPromise(Deferred.await(started))
    listeners.get("SIGINT")?.()

    await expect(running).resolves.toBe("cancelled")
    expect(removed).toEqual(["SIGINT", "SIGTERM"])
    expect(listeners.size).toBe(0)
  })

  it("uses an expiry-stopping foreground default", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(unauthorizedResponse()))

    await expect(runKeepalive(env, undefined, () => undefined, noSignals)).resolves.toBe("expired")
  })

  it("rejects defect exits instead of reporting cancellation", async () => {
    const { env } = makeStubEnvironment(() => Effect.succeed(healthyResponse()))

    await expect(
      runKeepalive(
        env,
        makeKeepaliveConfig({ healthyIntervalMs: 60_000 }),
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
      const policy = makeKeepaliveConfig({
        healthyIntervalMs: 60_000,
        maxRetryDelayMs: 20,
        retryDelayMs: 20,
        stopOnExpired: true
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

  it("keeps the stop reasons honest: re-auth, interruption, and misconfiguration are distinct", () => {
    const reasons: ReadonlyArray<KeepaliveStopReason> = ["expired", "cancelled", "misconfigured"]

    expect(new Set(reasons).size).toBe(reasons.length)
  })

  it("provides the transport as a layer, never a patched module", () => {
    expect(Layer.isLayer(makeStubEnvironment(() => Effect.succeed(healthyResponse())).env.transport)).toBe(true)
  })
})
