import { VoilaTransport } from "@firfi/voila-sdk"
import { Effect, Result } from "effect"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"

import { makeKeepaliveConfig, runKeepaliveLoop } from "../src/keepalive-runner.js"
import { makeNodeOperationEnvironment } from "../src/node-env.js"
import { keepaliveConfigFor } from "../src/keepalive-config.js"
import { unusedTransportLayer } from "./helpers/operations.js"

const sessionPath = "/tmp/voila-node-env-test.json"

describe("Node operation environment", () => {
  it("accepts a configured user-agent and session path", () => {
    const environment = makeNodeOperationEnvironment({
      VOILA_AUTH_SESSION_PATH: sessionPath,
      VOILA_USER_AGENT: "configured-agent/1.0"
    })

    expect(Result.isSuccess(environment)).toBe(true)

    if (Result.isSuccess(environment)) {
      expect(environment.success.authGuidance?.mcpEnv.VOILA_AUTH_SESSION_PATH).toBe(sessionPath)
      expect(environment.success.sessionSnapshotPath).toBe(sessionPath)
    }
  })

  it("wires the configured user-agent into the transport the environment carries", async () => {
    const environment = makeNodeOperationEnvironment({ VOILA_USER_AGENT: "configured-agent/1.0" })

    if (Result.isFailure(environment)) {
      throw new Error("Expected a valid environment")
    }

    const sent: Array<string | undefined> = []
    const server = createServer((request, response) => {
      sent.push(request.headers["user-agent"])
      response.statusCode = 200
      response.end("{}")
    })

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })

    try {
      const address = server.address()
      if (address === null || typeof address === "string") {
        throw new Error("Expected the test server to expose a TCP address")
      }

      await Effect.runPromise(
        Effect.provide(
          Effect.flatMap(VoilaTransport, (transport) =>
            transport.request({
              headers: {},
              method: "GET",
              url: new URL(`http://127.0.0.1:${address.port}/api/example`)
            })
          ),
          environment.success.transport
        )
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    }

    expect(sent).toEqual(["configured-agent/1.0"])
  })

  it("rejects an empty configured user-agent", () => {
    expect(Result.isFailure(makeNodeOperationEnvironment({ VOILA_USER_AGENT: " " }))).toBe(true)
  })

  it("rejects a relative session path", () => {
    expect(Result.isFailure(makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: "relative.json" }))).toBe(true)
  })

  it("offers no auth guidance in guest mode, where there is no session to log into", () => {
    const environment = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: sessionPath, VOILA_GUEST: "1" })

    expect(Result.isSuccess(environment)).toBe(true)

    if (Result.isSuccess(environment)) {
      expect(environment.success.authGuidance).toBeUndefined()
      expect(environment.success.sessionSnapshotPath).toBeUndefined()
    }
  })

  it("starts keepalive only for an explicit non-guest session snapshot path", () => {
    const runtime = { keepaliveDisabled: false, keepaliveIntervalMs: 7_200_000 }
    const configured = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: sessionPath })
    const ordinaryGuest = makeNodeOperationEnvironment({})
    const forcedGuest = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: sessionPath, VOILA_GUEST: "1" })

    if (Result.isFailure(configured) || Result.isFailure(ordinaryGuest) || Result.isFailure(forcedGuest)) {
      throw new Error("Expected valid operation environments")
    }

    expect(keepaliveConfigFor(runtime, configured.success)?.healthyIntervalMs).toBe(7_200_000)
    expect(keepaliveConfigFor(runtime, ordinaryGuest.success)).toBeUndefined()
    expect(keepaliveConfigFor(runtime, forcedGuest.success)).toBeUndefined()
    expect(keepaliveConfigFor({ ...runtime, keepaliveDisabled: true }, configured.success)).toBeUndefined()
  })

  it("does not bootstrap a guest when an authenticated session snapshot disappears", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voila-keepalive-node-env-"))
    const missingPath = join(directory, "session.json")

    try {
      const environment = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: missingPath }, unusedTransportLayer)

      if (Result.isFailure(environment)) {
        throw new Error("Expected a valid operation environment")
      }

      const reason = await Effect.runPromise(
        Effect.provide(
          runKeepaliveLoop(
            environment.success,
            makeKeepaliveConfig({ healthyIntervalMs: 1, retryDelayMs: 1, maxRetryDelayMs: 1, stopOnExpired: true })
          ),
          environment.success.transport
        )
      )

      expect(reason).toBe("misconfigured")
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
