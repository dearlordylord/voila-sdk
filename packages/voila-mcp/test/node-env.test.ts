import { Either } from "effect"
import topDesktopUserAgents from "top-user-agents/desktop"
import { describe, expect, it } from "vitest"

import {
  makeFetchVoilaTransport,
  makeNodeOperationEnvironment,
  type NodeFetchPort,
  type RequestDeadlinePort
} from "../src/node-env.js"

const requestUrl = new URL("https://voila.ca/api/example")

const firstDesktopUserAgent = (): string => {
  const userAgent = topDesktopUserAgents.at(0)

  if (userAgent === undefined) throw new Error("Expected the desktop user-agent dataset to be non-empty")

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

// A deadline the test decides, so no test waits on wall-clock time to observe
// an abandoned request; production supplies `timeoutDeadline()`.
const controlledDeadline = (): { readonly deadline: RequestDeadlinePort; readonly reached: () => void } => {
  const controller = new AbortController()

  return { deadline: () => controller.signal, reached: () => controller.abort(new Error("deadline reached")) }
}

// a server that accepts the connection and then says nothing: `fetch` rejects
// when the abort signal fires, which is what the transport must survive
const hangingFetch: NodeFetchPort = async (_input, init) =>
  new Promise((_resolve, reject) => {
    // like `fetch`, a signal already aborted when the request starts rejects
    // it at once rather than waiting for an abort that has been and gone
    if (init.signal?.aborted === true) {
      reject(new Error("aborted"))

      return
    }

    init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
  })

// headers arrive, the body never finishes: a real response over a stream that
// only ever ends when the abort signal errors it
const stallingBodyFetch: NodeFetchPort = async (_input, init) =>
  new Response(
    new ReadableStream({
      start: (controller) => {
        init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")))
      }
    }),
    { status: 200 }
  )

describe("Node Voila transport", () => {
  it("uses the first desktop user-agent by default and preserves unrelated headers", async () => {
    const recording = makeRecordingFetch()
    const transport = makeFetchVoilaTransport(undefined, recording.fetchPort)

    await transport.request({ headers: { "x-request-context": "preserved" }, method: "GET", url: requestUrl })

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
      await environment.right.transport.request({ headers: {}, method: "GET", url: requestUrl })
    }

    expect(recording.requestHeaders()?.get("user-agent")).toBe("configured-agent/1.0")
  })

  it("lets an explicit request user-agent override configuration case-insensitively", async () => {
    const recording = makeRecordingFetch()
    const transport = makeFetchVoilaTransport("configured-agent/1.0", recording.fetchPort)

    await transport.request({
      headers: { "User-Agent": "request-agent/2.0", "x-request-context": "preserved" },
      method: "GET",
      url: requestUrl
    })

    expect(recording.requestHeaders()?.get("user-agent")).toBe("request-agent/2.0")
    expect(recording.requestHeaders()?.get("x-request-context")).toBe("preserved")
  })

  it("abandons a request that outlasts its deadline", async () => {
    const { deadline, reached } = controlledDeadline()
    const transport = makeFetchVoilaTransport(undefined, hangingFetch, deadline)

    const pending = transport.request({ headers: {}, method: "GET", url: requestUrl })
    reached()

    const result = await pending

    expect(Either.isLeft(result)).toBe(true)
    // nothing about the request survives into what the caller sees
    expect(JSON.stringify(result)).not.toContain(requestUrl.href)
  })

  it("abandons a response whose body stalls after its headers arrive", async () => {
    const { deadline, reached } = controlledDeadline()
    const transport = makeFetchVoilaTransport(undefined, stallingBodyFetch, deadline)

    const pending = transport.request({ headers: {}, method: "GET", url: requestUrl })
    reached()

    expect(Either.isLeft(await pending)).toBe(true)
  })

  it("bounds a request by the default deadline when none is given", async () => {
    const signals: Array<AbortSignal | null | undefined> = []
    const transport = makeFetchVoilaTransport(undefined, async (_input, init) => {
      signals.push(init.signal)

      return new Response("{}", { status: 200 })
    })

    await transport.request({ headers: {}, method: "GET", url: requestUrl })

    // the production path carries a deadline, rather than none at all
    expect(signals[0]?.aborted).toBe(false)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })

  it("rejects an empty configured user-agent", () => {
    const environment = makeNodeOperationEnvironment({ VOILA_USER_AGENT: " " })

    expect(Either.isLeft(environment)).toBe(true)
  })
})
