import {
  type KeepalivePolicy,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  serializeCookieJar,
  toughCookieJarPort,
  type VoilaTransport
} from "@firfi/voila-sdk"
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { runKeepaliveTick, startKeepalive, startNodeKeepalive } from "../src/keepalive-runner.js"
import type { OperationEnvironment, OperationFailure } from "../src/operations.js"

const voilaUrl = "https://voila.ca/"
const csrfToken = "csrf-token"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const makeGuestSession = (): SdkSessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=sanitized-cookie; Path=/; Secure; HttpOnly", voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, cookieJar.right)

  if (Either.isLeft(session)) {
    throw new Error("Expected session snapshot")
  }

  const snapshot = makeGuestSdkSessionSnapshot(session.right)

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected SDK session snapshot")
  }

  return snapshot.right
}

const makeEnv = (
  transport: VoilaTransport,
  saveResult: Either.Either<undefined, OperationFailure> = Either.right(undefined)
): OperationEnvironment => {
  const initial = makeGuestSession()

  return { session: { load: async () => Either.right(initial), save: async () => saveResult }, transport }
}

const jsonResponse = (body: unknown, status = 200): VoilaTransport => ({
  request: async () => Either.right({ body: JSON.stringify(body), headers: {}, status })
})

const smallPolicy: KeepalivePolicy = { healthyIntervalMs: 5, retryDelayMs: 5, stopOnExpired: true }

const makeDelayRecorder = (): {
  readonly delays: ReadonlyArray<number>
  readonly sleep: (delayMs: number) => Promise<void>
} => {
  const delays: Array<number> = []

  return { delays, sleep: async (delayMs) => void delays.push(delayMs) }
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("keepalive runner", () => {
  it("classifies an active session as healthy", async () => {
    const env = makeEnv(jsonResponse({ authenticated: false }))

    expect((await runKeepaliveTick(env))._tag).toBe("healthy")
  })

  it("classifies an unauthorized session as expired", async () => {
    const env = makeEnv(jsonResponse({}, 401))

    expect((await runKeepaliveTick(env))._tag).toBe("expired")
  })

  it("classifies a failed persistence step as a failed check", async () => {
    const env = makeEnv(jsonResponse({ authenticated: false }), Either.left({ _tag: "SaveFailed", message: "no disk" }))

    expect((await runKeepaliveTick(env))._tag).toBe("check-failed")
  })

  it("classifies a changed active-session schema as schema-changed", async () => {
    const env = makeEnv({ request: async () => Either.right({ body: "not-json", headers: {}, status: 200 }) })

    expect((await runKeepaliveTick(env))._tag).toBe("schema-changed")
  })

  it("stops the loop on expiry when the tick reports expiry", async () => {
    const env = makeEnv(jsonResponse({}, 401))
    const recorder = makeDelayRecorder()

    const reason = await startKeepalive(env, smallPolicy, {
      isCancelled: () => false,
      log: () => undefined,
      sleep: recorder.sleep
    })

    expect(reason).toBe("expired")
    expect(recorder.delays).toEqual([])
  })

  it("runs a node-wired loop that logs and stops on demand", async () => {
    const env = makeEnv(jsonResponse({ authenticated: false }))
    const lines: Array<string> = []
    const policy: KeepalivePolicy = { healthyIntervalMs: 60_000, retryDelayMs: 5, stopOnExpired: false }

    const handle = startNodeKeepalive(env, policy, (line) => void lines.push(line))

    await waitFor(() => lines.length > 0)
    handle.stop()

    const reason = await handle.wait()

    expect(reason).toBe("cancelled")
    expect(lines[0]).toContain("voila keepalive: session active")
  })
})
