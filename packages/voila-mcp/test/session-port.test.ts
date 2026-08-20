import {
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  SdkSessionSnapshotSchema,
  serializeCookieJar,
  type SessionSnapshot,
  toughCookieJarPort,
  VoilaTransport
} from "@firfi/voila-sdk"
import { it as effectIt } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Result, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { TestClock } from "effect/testing"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

import { makeNodeOperationEnvironment } from "../src/node-env.js"
import { type RequestTimeoutMs, RequestTimeoutMsSchema, voilaTransportLayer } from "../src/node-transport.js"
import type { OperationEnvironment, SessionOperation } from "../src/operations.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "sanitized-cookie"
const secretCsrfToken = "sanitized-csrf-token"

const makeBaseSession = (regionId: string): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected cookie jar serialization")
  }

  const session = makeSessionSnapshot(
    { assetVersion: "asset-version", clientRouteId: "client-route-id", pageViewId: "page-view-id", regionId },
    { token: secretCsrfToken },
    cookieJar.success
  )

  if (Result.isFailure(session)) {
    throw new Error("Expected session snapshot")
  }

  return session.success
}

const authenticated = (regionId: string): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(regionId), "authenticated")

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot")
  }

  return snapshot.success
}

const guest = (regionId: string): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeBaseSession(regionId))

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected guest SDK session snapshot")
  }

  return snapshot.success
}

const encode = (snapshot: SdkSessionSnapshot): string =>
  JSON.stringify(Schema.encodeSync(SdkSessionSnapshotSchema)(snapshot))

const decodeFile = async (file: string): Promise<SdkSessionSnapshot> =>
  Schema.decodeUnknownSync(SdkSessionSnapshotSchema)(JSON.parse(await fs.readFile(file, "utf8")))

const sessionFile = async (): Promise<string> =>
  path.join(await fs.mkdtemp(path.join(os.tmpdir(), "voila-session-port-")), "session.json")

const fileExists = (file: string): Promise<boolean> =>
  fs.access(file).then(
    () => true,
    () => false
  )

const homepage = (): Promise<string> =>
  fs.readFile(new URL("../../voila-sdk/test/fixtures/voila-homepage.html", import.meta.url), "utf8")

// serves the guest bootstrap request only: these tests never run a Voila
// operation, they exercise the session cycle around one
const bootstrapTransport = (page: string): Layer.Layer<VoilaTransport> =>
  Layer.succeed(VoilaTransport, {
    request: () =>
      Effect.succeed({
        body: page,
        headers: { "set-cookie": `voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly` },
        status: 200
      })
  })

const environmentFor = (file: string, transport: Layer.Layer<VoilaTransport>): OperationEnvironment => {
  const env = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: file }, transport)

  if (Result.isFailure(env)) {
    throw new Error("Expected a valid MCP operation environment")
  }

  return env.success
}

// an operation that only reports the region of the session it was handed
const observe =
  (seen: Array<string>): SessionOperation<void> =>
  (current) =>
    Effect.sync(() => {
      seen.push(current.session.metadata.regionId)

      return { value: undefined }
    })

/**
 * A request that never answers and records its own cancellation. Paired with
 * the real transport's Effect deadline, this is what tells the abandonment
 * test apart from a test that only proves a fiber stopped waiting.
 */
const hangingRequestLayer = (
  cancellations: Array<boolean>,
  started: Deferred.Deferred<void>,
  timeoutMs: RequestTimeoutMs
): Layer.Layer<VoilaTransport> =>
  Layer.provide(
    voilaTransportLayer(undefined, timeoutMs),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() =>
        Effect.callback(() => {
          // the deadline is only running once the request is in flight, so the
          // test waits for this rather than for a number of milliseconds it
          // hopes are enough to get through the session file read
          Deferred.doneUnsafe(started, Effect.void)

          return Effect.sync(() => {
            cancellations.push(true)
          })
        })
      )
    )
  )

// an operation that makes a real request through the transport in the
// environment and fails the cycle when the request does, the way every Voila
// operation does
const request: SessionOperation<void> = () =>
  Effect.flatMap(VoilaTransport, (transport) =>
    Effect.as(transport.request({ headers: {}, method: "GET", url: new URL("https://voila.ca/api/example") }), {
      value: undefined
    })
  )

// an operation whose live response refreshed the session
const refreshTo =
  (next: SdkSessionSnapshot): SessionOperation<void> =>
  () =>
    Effect.succeed({ refreshed: next, value: undefined })

// an operation whose refresh is a transform over the session it was handed,
// the way a response's Set-Cookie is folded into the current snapshot
const refreshFrom =
  (seen: Array<string>, suffix: string): SessionOperation<void> =>
  (current) =>
    Effect.sync(() => {
      const regionId = current.session.metadata.regionId
      seen.push(regionId)

      return { refreshed: authenticated(`${regionId}${suffix}`), value: undefined }
    })

describe("MCP session port", () => {
  it("runs a later operation against a login that landed after the process started", async () => {
    const file = await sessionFile()
    await fs.writeFile(file, encode(authenticated("boot")), { mode: 0o600 })
    const env = environmentFor(file, bootstrapTransport(await homepage()))
    const seen: Array<string> = []

    await Effect.runPromise(Effect.provide(env.session.withSession(observe(seen)), env.transport))
    // an interactive login in another terminal replaces the file mid-process
    await fs.writeFile(file, encode(authenticated("fresh-login")), { mode: 0o600 })
    // the next operation refreshes cookies: its write must descend from the
    // login it just read, not from the session this process booted with
    await Effect.runPromise(Effect.provide(env.session.withSession(refreshFrom(seen, "+rotated")), env.transport))

    expect(seen).toEqual(["boot", "fresh-login"])
    expect((await decodeFile(file)).session.metadata.regionId).toBe("fresh-login+rotated")
  })

  it("persists a refreshed session as a transform over the file", async () => {
    const file = await sessionFile()
    await fs.writeFile(file, encode(authenticated("boot")), { mode: 0o600 })
    const env = environmentFor(file, bootstrapTransport(await homepage()))
    const rotated = authenticated("rotated-cookies")

    await Effect.runPromise(Effect.provide(env.session.withSession(refreshTo(rotated)), env.transport))

    expect(await fs.readFile(file, "utf8")).toBe(encode(rotated))
  })

  effectIt.effect("releases the session lock when an operation's request is abandoned", () =>
    Effect.gen(function* () {
      const file = yield* Effect.promise(sessionFile)
      yield* Effect.promise(() => fs.writeFile(file, encode(authenticated("boot")), { mode: 0o600 }))

      const cancellations: Array<boolean> = []
      const timeoutMs = RequestTimeoutMsSchema.make(5_000)
      const started = yield* Deferred.make<void>()
      const env = environmentFor(file, hangingRequestLayer(cancellations, started, timeoutMs))
      const seen: Array<string> = []
      const pending = yield* Effect.forkChild(
        Effect.result(Effect.provide(env.session.withSession(request), env.transport))
      )

      yield* Deferred.await(started)
      yield* TestClock.adjust(`${timeoutMs + 1} millis`)

      const timedOut = yield* Fiber.join(pending)

      expect(Result.isFailure(timedOut)).toBe(true)
      expect(Result.isFailure(timedOut) ? timedOut.failure._tag : undefined).toBe("VoilaRequestDeadlineExceeded")
      // the request itself was cancelled, not merely the fiber waiting on it
      expect(cancellations).toEqual([true])
      // the failed cycle released the file's permit: a leaked one would hang here
      yield* Effect.provide(env.session.withSession(observe(seen)), env.transport)

      expect(seen).toEqual(["boot"])
      // the file the failed operation ran against is untouched
      expect((yield* Effect.promise(() => decodeFile(file))).session.metadata.regionId).toBe("boot")
    })
  )

  it("keeps a refreshed guest session in memory instead of writing it", async () => {
    const file = await sessionFile()
    const env = environmentFor(file, bootstrapTransport(await homepage()))
    const seen: Array<string> = []

    // no file yet: the cycle bootstraps a guest session, and the operation
    // rotates it — the rotation may not reach disk, and may not be lost either
    await Effect.runPromise(Effect.provide(env.session.withSession(refreshTo(guest("rotated-guest"))), env.transport))
    await Effect.runPromise(Effect.provide(env.session.withSession(observe(seen)), env.transport))

    expect(await fileExists(file)).toBe(false)
    expect(seen).toEqual(["rotated-guest"])
  })
})
