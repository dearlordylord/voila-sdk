import { FetchHttpClient } from "@effect/platform"
import { VoilaTransport } from "@firfi/voila-sdk"
import { Effect, Either, Layer } from "effect"
import { describe, expect, it } from "vitest"

import { makeNodeOperationEnvironment } from "../src/node-env.js"

const sessionPath = "/tmp/voila-node-env-test.json"

describe("Node operation environment", () => {
  it("accepts a configured user-agent and session path", () => {
    const environment = makeNodeOperationEnvironment({
      VOILA_AUTH_SESSION_PATH: sessionPath,
      VOILA_USER_AGENT: "configured-agent/1.0"
    })

    expect(Either.isRight(environment)).toBe(true)

    if (Either.isRight(environment)) {
      expect(environment.right.authGuidance?.mcpEnv.VOILA_AUTH_SESSION_PATH).toBe(sessionPath)
    }
  })

  it("wires the configured user-agent into the transport the environment carries", async () => {
    const environment = makeNodeOperationEnvironment({ VOILA_USER_AGENT: "configured-agent/1.0" })

    if (Either.isLeft(environment)) {
      throw new Error("Expected a valid environment")
    }

    const sent: Array<string | null> = []
    // the platform's fetch is a Reference: substituting it exercises the real
    // transport the environment built, rather than a second one a test wired up
    const recordingFetch = Layer.succeed(FetchHttpClient.Fetch, async (input, init) => {
      sent.push(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("user-agent"))

      return new Response("{}", { status: 200 })
    })

    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(VoilaTransport, (transport) =>
          transport.request({ headers: {}, method: "GET", url: new URL("https://voila.ca/api/example") })
        ),
        Layer.provide(environment.right.transport, recordingFetch)
      )
    )

    expect(sent).toEqual(["configured-agent/1.0"])
  })

  it("rejects an empty configured user-agent", () => {
    expect(Either.isLeft(makeNodeOperationEnvironment({ VOILA_USER_AGENT: " " }))).toBe(true)
  })

  it("rejects a relative session path", () => {
    expect(Either.isLeft(makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: "relative.json" }))).toBe(true)
  })

  it("offers no auth guidance in guest mode, where there is no session to log into", () => {
    const environment = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: sessionPath, VOILA_GUEST: "1" })

    expect(Either.isRight(environment)).toBe(true)

    if (Either.isRight(environment)) {
      expect(environment.right.authGuidance).toBeUndefined()
    }
  })
})
