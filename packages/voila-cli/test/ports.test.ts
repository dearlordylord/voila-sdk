import {
  type OperationEnvironment,
  type OperationSessionPort,
  type OperationFailure,
  type OperationExecutionResult,
  type SessionOperation
} from "@firfi/voila-mcp"
import { KeepaliveIntervalSecondsSchema, VoilaTransport } from "@firfi/voila-sdk"
import { StateFilePathSchema } from "@firfi/voila-session-store"
import { Effect, Layer, Result } from "effect"
import { describe, expect, it } from "vitest"

import { nodeCliPorts } from "../src/ports.js"
import { makeNodeCliPorts, makeProductionRuntime, type NodeCliRuntime } from "../src/ports-factory.js"
import { BrowserPollDelayMsSchema } from "../src/cli-model.js"

const sessionPath = StateFilePathSchema.make("/tmp/voila-cli-ports-session.json")

const operationFailure = (): OperationFailure => ({ _tag: "OperationFailed", message: "failed" })

const operationSession: OperationSessionPort = {
  withAuthenticatedSession: <A>(_operation: SessionOperation<A>) => Effect.fail(operationFailure()),
  withSession: <A>(_operation: SessionOperation<A>) => Effect.fail(operationFailure())
}

const environment: OperationEnvironment = {
  session: operationSession,
  transport: Layer.succeed(VoilaTransport, { request: () => Effect.die("not used") })
}

const success = (value: unknown): OperationExecutionResult => ({ ok: true, value })

const makeRuntime = (overrides: Partial<NodeCliRuntime> = {}): NodeCliRuntime => ({
  makeEnvironment: () => Result.succeed(environment),
  runOperation: async () => success("operation-result"),
  runKeepalive: async () => "expired",
  login: async () => success("login-result"),
  delay: async () => undefined,
  writeStderr: () => undefined,
  ...overrides
})

describe("node CLI ports", () => {
  it("adapts injected Effect operation and keepalive runtimes", async () => {
    const runtime = makeProductionRuntime(
      (_name, _input, _env) => Effect.succeed(success("effect-result")),
      async () => "expired"
    )
    const ports = makeNodeCliPorts(runtime)

    await expect(ports.runOperation("voila_get_cart", {}, { sessionPath })).resolves.toEqual(success("effect-result"))
    await expect(ports.keepalive({ sessionPath })).resolves.toBe("expired")

    const failedRuntime = makeProductionRuntime((_name, _input, _env) =>
      Effect.fail({ error: operationFailure(), ok: false })
    )
    await expect(makeNodeCliPorts(failedRuntime).runOperation("voila_get_cart", {}, { sessionPath })).resolves.toEqual({
      error: operationFailure(),
      ok: false
    })
  })

  it("runs operations and keeps the typed environment behind the port", async () => {
    const names: Array<string> = []
    const runtime = makeRuntime({
      runOperation: async (name, input, env) => {
        names.push(`${name}:${String(input)}:${String(env === environment)}`)
        return success("ran")
      }
    })
    const ports = makeNodeCliPorts(runtime)

    await expect(ports.runOperation("voila_get_cart", { page: 1 }, { sessionPath })).resolves.toEqual(success("ran"))
    expect(names).toEqual(["voila_get_cart:[object Object]:true"])
  })

  it("translates environment failures without executing operations or keepalive", async () => {
    let operationCalls = 0
    let keepaliveCalls = 0
    const runtime = makeRuntime({
      makeEnvironment: () => Result.fail({ _tag: "VoilaEnvironmentInvalid", message: "invalid" }),
      runOperation: async () => {
        operationCalls += 1
        return success("unreached")
      },
      runKeepalive: async () => {
        keepaliveCalls += 1
        return "expired"
      }
    })
    const ports = makeNodeCliPorts(runtime)

    await expect(ports.runOperation("voila_get_cart", {}, { sessionPath })).resolves.toEqual({
      error: { _tag: "VoilaEnvironmentInvalid", message: "invalid" },
      ok: false
    })
    await expect(ports.keepalive({ sessionPath })).resolves.toBe("misconfigured")
    expect(operationCalls).toBe(0)
    expect(keepaliveCalls).toBe(0)
  })

  it("builds keepalive configuration with and without an explicit interval", async () => {
    const intervals: Array<number | undefined> = []
    const runtime = makeRuntime({
      runKeepalive: async (_env, config) => {
        intervals.push(config.healthyIntervalMs)
        return "cancelled"
      }
    })
    const ports = makeNodeCliPorts(runtime)

    await expect(ports.keepalive({ sessionPath })).resolves.toBe("cancelled")
    await expect(
      ports.keepalive({ intervalSeconds: KeepaliveIntervalSecondsSchema.make(3600), sessionPath })
    ).resolves.toBe("cancelled")
    expect(intervals).toHaveLength(2)
    expect(intervals[0]).toBeDefined()
    expect(intervals[1]).toBeDefined()
  })

  it("keeps the process wiring callable without invoking external services", async () => {
    await expect(nodeCliPorts.delay(BrowserPollDelayMsSchema.make(0))).resolves.toBeUndefined()
    nodeCliPorts.writeStderr("")
  })
})
