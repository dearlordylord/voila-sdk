import {
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  SdkSessionSnapshotSchema,
  serializeCookieJar,
  type SessionSnapshot,
  toughCookieJarPort,
  type VoilaTransport
} from "@firfi/voila-sdk"
import { Effect, Either, Schema } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

import {
  makeFetchVoilaTransport,
  makeNodeOperationEnvironment,
  type NodeFetchPort,
  type RequestDeadlinePort
} from "../src/node-env.js"
import type { OperationEnvironment, SessionOperation } from "../src/operations.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "sanitized-cookie"
const secretCsrfToken = "sanitized-csrf-token"

const makeBaseSession = (regionId: string): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization")
  }

  const session = makeSessionSnapshot(
    { assetVersion: "asset-version", clientRouteId: "client-route-id", pageViewId: "page-view-id", regionId },
    { token: secretCsrfToken },
    cookieJar.right
  )

  if (Either.isLeft(session)) {
    throw new Error("Expected session snapshot")
  }

  return session.right
}

const authenticated = (regionId: string): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(regionId), "authenticated")

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot")
  }

  return snapshot.right
}

const guest = (regionId: string): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeBaseSession(regionId))

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected guest SDK session snapshot")
  }

  return snapshot.right
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
const bootstrapTransport = (page: string): VoilaTransport => ({
  request: async () =>
    Either.right({
      body: page,
      headers: { "set-cookie": `voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly` },
      status: 200
    })
})

const environmentFor = (file: string, transport: VoilaTransport): OperationEnvironment => {
  const env = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: file }, transport)

  if (Either.isLeft(env)) {
    throw new Error("Expected a valid MCP operation environment")
  }

  return env.right
}

// an operation that only reports the region of the session it was handed
const observe =
  (seen: Array<string>): SessionOperation<void> =>
  (current) =>
    Effect.sync(() => {
      seen.push(current.session.metadata.regionId)

      return { value: undefined }
    })

// a server that accepts the connection and then says nothing, abandoned when
// the test says the deadline is reached rather than after wall-clock time
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

const controlledDeadline = (): { readonly deadline: RequestDeadlinePort; readonly reached: () => void } => {
  const controller = new AbortController()

  return { deadline: () => controller.signal, reached: () => controller.abort(new Error("deadline reached")) }
}

// an operation that makes a real request through the environment's transport
// and fails the cycle when the request does, the way every Voila operation does
const request =
  (transport: VoilaTransport): SessionOperation<void> =>
  () =>
    Effect.promise(() =>
      transport.request({ headers: {}, method: "GET", url: new URL("https://voila.ca/api/example") })
    ).pipe(
      Effect.flatMap((result) =>
        Either.isLeft(result)
          ? Effect.fail({ _tag: "VoilaNetworkFailure", message: "Voila network request failed" })
          : Effect.succeed({ value: undefined })
      )
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

    await Effect.runPromise(env.session.withSession(observe(seen)))
    // an interactive login in another terminal replaces the file mid-process
    await fs.writeFile(file, encode(authenticated("fresh-login")), { mode: 0o600 })
    // the next operation refreshes cookies: its write must descend from the
    // login it just read, not from the session this process booted with
    await Effect.runPromise(env.session.withSession(refreshFrom(seen, "+rotated")))

    expect(seen).toEqual(["boot", "fresh-login"])
    expect((await decodeFile(file)).session.metadata.regionId).toBe("fresh-login+rotated")
  })

  it("persists a refreshed session as a transform over the file", async () => {
    const file = await sessionFile()
    await fs.writeFile(file, encode(authenticated("boot")), { mode: 0o600 })
    const env = environmentFor(file, bootstrapTransport(await homepage()))
    const rotated = authenticated("rotated-cookies")

    await Effect.runPromise(env.session.withSession(refreshTo(rotated)))

    expect(await fs.readFile(file, "utf8")).toBe(encode(rotated))
  })

  it("releases the session lock when an operation's request is abandoned", async () => {
    const file = await sessionFile()
    await fs.writeFile(file, encode(authenticated("boot")), { mode: 0o600 })
    // a transport that never answers, abandoned on this test's say-so
    const { deadline, reached } = controlledDeadline()
    const env = environmentFor(file, makeFetchVoilaTransport(undefined, hangingFetch, deadline))
    const seen: Array<string> = []

    const pending = Effect.runPromise(Effect.either(env.session.withSession(request(env.transport))))
    reached()

    const timedOut = await pending

    expect(Either.isLeft(timedOut)).toBe(true)
    expect(Either.isLeft(timedOut) ? timedOut.left._tag : undefined).toBe("VoilaNetworkFailure")
    // the failed cycle released the file's permit: a leaked one would hang here
    await Effect.runPromise(env.session.withSession(observe(seen)))

    expect(seen).toEqual(["boot"])
    // the file the failed operation ran against is untouched
    expect((await decodeFile(file)).session.metadata.regionId).toBe("boot")
  })

  it("keeps a refreshed guest session in memory instead of writing it", async () => {
    const file = await sessionFile()
    const env = environmentFor(file, bootstrapTransport(await homepage()))
    const seen: Array<string> = []

    // no file yet: the cycle bootstraps a guest session, and the operation
    // rotates it — the rotation may not reach disk, and may not be lost either
    await Effect.runPromise(env.session.withSession(refreshTo(guest("rotated-guest"))))
    await Effect.runPromise(env.session.withSession(observe(seen)))

    expect(await fileExists(file)).toBe(false)
    expect(seen).toEqual(["rotated-guest"])
  })
})
