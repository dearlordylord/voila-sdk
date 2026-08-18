import { VoilaTransport } from "@firfi/voila-sdk"
import { Effect, Result } from "effect"
import { createServer } from "node:http"
import { describe, expect, it } from "vitest"

import { makeNodeOperationEnvironment } from "../src/node-env.js"

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
    }
  })
})
