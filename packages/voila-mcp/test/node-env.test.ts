import { Either } from "effect"
import topDesktopUserAgents from "top-user-agents/desktop"
import { describe, expect, it } from "vitest"

import { makeFetchVoilaTransport, makeNodeOperationEnvironment, type NodeFetchPort } from "../src/node-env.js"

const requestUrl = new URL("https://voila.ca/api/example")

const firstDesktopUserAgent = (): string => {
  const [userAgent] = topDesktopUserAgents

  if (userAgent === undefined) {
    throw new Error("Expected the desktop user-agent dataset to be non-empty")
  }

  return userAgent
}

const makeRecordingFetch = (): {
  readonly fetchPort: NodeFetchPort
  readonly requestHeaders: () => Headers | undefined
} => {
  let headers: Headers | undefined

  return {
    fetchPort: async (_input, init) => {
      headers = new Headers(init.headers)

      return new Response("{}", { status: 200 })
    },
    requestHeaders: () => headers
  }
}

describe("Node Voila transport", () => {
  it("uses the first desktop user-agent by default and preserves unrelated headers", async () => {
    const recording = makeRecordingFetch()
    const transport = makeFetchVoilaTransport(undefined, recording.fetchPort)

    await transport.request({
      headers: { "x-request-context": "preserved" },
      method: "GET",
      url: requestUrl
    })

    expect(recording.requestHeaders()?.get("user-agent")).toBe(firstDesktopUserAgent())
    expect(recording.requestHeaders()?.get("x-request-context")).toBe("preserved")
  })

  it("uses the configured user-agent from the typed startup environment", async () => {
    const recording = makeRecordingFetch()
    const environment = makeNodeOperationEnvironment(
      { VOILA_USER_AGENT: "configured-agent/1.0" },
      undefined,
      recording.fetchPort
    )

    expect(Either.isRight(environment)).toBe(true)

    if (Either.isRight(environment)) {
      await environment.right.transport.request({
        headers: {},
        method: "GET",
        url: requestUrl
      })
    }

    expect(recording.requestHeaders()?.get("user-agent")).toBe("configured-agent/1.0")
  })

  it("lets an explicit request user-agent override configuration case-insensitively", async () => {
    const recording = makeRecordingFetch()
    const transport = makeFetchVoilaTransport("configured-agent/1.0", recording.fetchPort)

    await transport.request({
      headers: {
        "User-Agent": "request-agent/2.0",
        "x-request-context": "preserved"
      },
      method: "GET",
      url: requestUrl
    })

    expect(recording.requestHeaders()?.get("user-agent")).toBe("request-agent/2.0")
    expect(recording.requestHeaders()?.get("x-request-context")).toBe("preserved")
  })

  it("rejects an empty configured user-agent", () => {
    const environment = makeNodeOperationEnvironment({ VOILA_USER_AGENT: " " })

    expect(Either.isLeft(environment)).toBe(true)
  })
})
