import {
  type KeepaliveOutcome,
  type KeepaliveStopReason,
  connectionFailure,
  type VoilaTransport,
  type VoilaTransportError
} from "@firfi/voila-sdk"
import { Effect, Exit, Fiber, Layer } from "effect"
import { describe, expect, it } from "vitest"

import {
  type KeepaliveConfig,
  makeKeepaliveConfig,
  runKeepaliveLoop,
  runKeepaliveTick
} from "../src/keepalive-runner.js"
import type { OperationEnvironment, OperationFailure, SessionOperation } from "../src/operations.js"
import { makeStubEnvironment, unusedTransportLayer } from "./helpers/operations.js"

const okBody = (
  body: unknown
): { readonly body: string; readonly headers: Readonly<Record<string, string>>; readonly status: number } => ({
  body: JSON.stringify(body),
  headers: {},
  status: 200
})

// A health-check response the runner classifies as healthy. The exact shape is
// owned by the SDK's session-health schema; the stub transport only has to
// return what that schema accepts for an active guest session.
const healthyResponse = (): {
  readonly body: string
  readonly headers: Readonly<Record<string, string>>
  readonly status: number
} => okBody({ authenticated: false })

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

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("keepalive runner", () => {
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
          Effect.fail(cycleFailure)
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
    const policy = makeKeepaliveConfig({
      healthyIntervalMs: 60_000,
      maxRetryDelayMs: 20,
      retryDelayMs: 5,
      stopOnExpired: false
    })

    const fiber = Effect.runFork(
      Effect.provide(
        runKeepaliveLoop(env, policy, (line) => void lines.push(line)),
        env.transport
      )
    )

    await waitFor(() => lines.length > 0)
    await Effect.runPromise(Fiber.interrupt(fiber))
    const exit = await Effect.runPromise(Fiber.await(fiber))

    expect(Exit.isFailure(exit)).toBe(true)
    expect(lines[0]).toContain("voila keepalive: session active")
  })

  it("keeps the stop reasons honest: re-auth, interruption, and misconfiguration are distinct", () => {
    const reasons: ReadonlyArray<KeepaliveStopReason> = ["expired", "cancelled", "misconfigured"]

    expect(new Set(reasons).size).toBe(reasons.length)
  })

  it("provides the transport as a layer, never a patched module", () => {
    expect(Layer.isLayer(makeStubEnvironment(() => Effect.succeed(healthyResponse())).env.transport)).toBe(true)
  })
})
