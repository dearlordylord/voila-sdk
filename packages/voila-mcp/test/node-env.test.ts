import {
  KeepaliveHealthyIntervalMsSchema,
  KeepaliveMaxRetryDelayMsSchema,
  KeepaliveRetryDelayMsSchema,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  serializeCookieJar,
  type SdkSessionSnapshot,
  toughCookieJarPort,
  VoilaTransport
} from "@firfi/voila-sdk"
import { persistSession, StateFileLocksLive, StateFilePathSchema, updateSessionFile } from "@firfi/voila-session-store"
import { Deferred, Effect, Fiber, Result } from "effect"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"

import { makeKeepaliveConfig, runKeepaliveLoop, type KeepaliveConfig } from "../src/keepalive-runner.js"
import { makeNodeOperationEnvironment } from "../src/node-env.js"
import { stubTransportLayer, unusedTransportLayer } from "./helpers/operations.js"

const sessionPath = "/tmp/voila-node-env-test.json"

const makeSessionForTest = () => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=sanitized-cookie; Path=/; Secure; HttpOnly", "https://voila.ca/")
  const cookies = serializeCookieJar(jar)

  if (Result.isFailure(cookies)) {
    throw new Error("Expected cookie jar serialization")
  }

  const session = makeSessionSnapshot(
    { assetVersion: "asset", clientRouteId: "route", pageViewId: "page", regionId: "region" },
    { token: "csrf" },
    cookies.success
  )

  if (Result.isFailure(session)) {
    throw new Error("Expected session snapshot")
  }

  return session.success
}

const makeAuthenticatedSnapshot = (regionId: string) => {
  const base = makeSessionForTest()
  const snapshot = makeAuthenticatedSdkSessionSnapshot(
    { ...base, metadata: { ...base.metadata, regionId } },
    "authenticated"
  )

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected authenticated session snapshot")
  }

  return snapshot.success
}

const makeGuestSnapshot = () => {
  const snapshot = makeGuestSdkSessionSnapshot(makeSessionForTest())

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected guest session snapshot")
  }

  return snapshot.success
}

const writeSnapshot = async (path: string, snapshot: SdkSessionSnapshot) => {
  await Effect.runPromise(
    Effect.provide(
      updateSessionFile(StateFilePathSchema.make(path), () => Effect.succeed(persistSession(snapshot))),
      StateFileLocksLive
    )
  )
}

const healthyResponse = { body: JSON.stringify({ authenticated: true }), headers: {}, status: 200 }

const makeTestKeepaliveConfig = (overrides: Parameters<typeof makeKeepaliveConfig>[0] = {}): KeepaliveConfig => {
  const config = makeKeepaliveConfig(overrides)

  if (Result.isFailure(config)) {
    throw new Error(config.failure.message)
  }

  return config.success
}

describe("Node operation environment", () => {
  it("accepts a configured user-agent and session path", () => {
    const environment = makeNodeOperationEnvironment({
      VOILA_AUTH_SESSION_PATH: sessionPath,
      VOILA_USER_AGENT: "configured-agent/1.0"
    })

    expect(Result.isSuccess(environment)).toBe(true)

    if (Result.isSuccess(environment)) {
      expect(environment.success.authGuidance?.mcpEnv.VOILA_AUTH_SESSION_PATH).toBe(sessionPath)
      expect(Object.hasOwn(environment.success, "keepaliveEligible")).toBe(false)
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
      expect(Object.hasOwn(environment.success, "keepaliveEligible")).toBe(false)
    }
  })

  it("does not leak startup keepalive eligibility through the operation environment", () => {
    const configured = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: sessionPath })
    const ordinaryGuest = makeNodeOperationEnvironment({})
    const forcedGuest = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: sessionPath, VOILA_GUEST: "1" })

    if (Result.isFailure(configured) || Result.isFailure(ordinaryGuest) || Result.isFailure(forcedGuest)) {
      throw new Error("Expected valid operation environments")
    }

    expect(Object.hasOwn(configured.success, "keepaliveEligible")).toBe(false)
    expect(Object.hasOwn(ordinaryGuest.success, "keepaliveEligible")).toBe(false)
    expect(Object.hasOwn(forcedGuest.success, "keepaliveEligible")).toBe(false)
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
            makeTestKeepaliveConfig({
              healthyIntervalMs: KeepaliveHealthyIntervalMsSchema.make(1),
              retryDelayMs: KeepaliveRetryDelayMsSchema.make(1),
              maxRetryDelayMs: KeepaliveMaxRetryDelayMsSchema.make(1),
              expiryPolicy: "stop"
            })
          ),
          environment.success.transport
        )
      )

      expect(reason).toBe("misconfigured")
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("uses a configured guest snapshot for ordinary operations and rejects it for authenticated-only work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voila-node-env-guest-"))
    const path = join(directory, "session.json")

    try {
      await writeSnapshot(path, makeGuestSnapshot())
      const environment = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: path }, unusedTransportLayer)

      if (Result.isFailure(environment)) {
        throw new Error("Expected a valid operation environment")
      }

      const ordinary = await Effect.runPromise(
        Effect.provide(
          environment.success.session.withSession(() => Effect.succeed({ value: "guest-session" })),
          environment.success.transport
        )
      )
      const authenticated = await Effect.runPromise(
        Effect.result(
          Effect.provide(
            environment.success.session.withAuthenticatedSession(() => Effect.succeed({ value: "not-run" })),
            environment.success.transport
          )
        )
      )

      expect(ordinary).toBe("guest-session")
      expect(Result.isFailure(authenticated)).toBe(true)
      if (Result.isFailure(authenticated)) {
        expect(authenticated.failure._tag).toBe("VoilaSessionSnapshotMissing")
      }

      const forcedGuest = makeNodeOperationEnvironment(
        { VOILA_AUTH_SESSION_PATH: path, VOILA_GUEST: "1" },
        unusedTransportLayer
      )
      if (Result.isFailure(forcedGuest)) {
        throw new Error("Expected a valid forced-guest environment")
      }

      const forcedGuestAuthenticated = await Effect.runPromise(
        Effect.result(
          Effect.provide(
            forcedGuest.success.session.withAuthenticatedSession(() => Effect.succeed({ value: "not-run" })),
            forcedGuest.success.transport
          )
        )
      )

      expect(Result.isFailure(forcedGuestAuthenticated)).toBe(true)
      if (Result.isFailure(forcedGuestAuthenticated)) {
        expect(forcedGuestAuthenticated.failure._tag).toBe("VoilaSessionSnapshotMissing")
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("retains a bootstrapped guest when an operation does not refresh it", async () => {
    const homepage = await readFile(
      new URL("../../voila-sdk/test/fixtures/voila-homepage.html", import.meta.url),
      "utf8"
    )
    let requests = 0
    const environment = makeNodeOperationEnvironment(
      { VOILA_GUEST: "1" },
      stubTransportLayer(() => {
        requests += 1
        return Effect.succeed({
          body: homepage,
          headers: { "set-cookie": "voila-session=sanitized-cookie; Path=/; Secure; HttpOnly" },
          status: 200
        })
      })
    )

    if (Result.isFailure(environment)) {
      throw new Error("Expected a valid guest environment")
    }

    const result = await Effect.runPromise(
      Effect.provide(
        environment.success.session.withSession(() => Effect.succeed({ value: "guest-operation" })),
        environment.success.transport
      )
    )

    expect(result).toBe("guest-operation")
    expect(requests).toBe(1)
  })

  it("returns the carried result when an ordinary session refresh loses a CAS race", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voila-node-env-carried-"))
    const path = join(directory, "session.json")
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()

    try {
      await writeSnapshot(path, makeAuthenticatedSnapshot("boot"))
      const environment = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: path }, unusedTransportLayer)

      if (Result.isFailure(environment)) {
        throw new Error("Expected a valid operation environment")
      }

      const operation = environment.success.session.withSession(() =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return { refreshed: makeAuthenticatedSnapshot("refresh"), value: "carried-result" }
        })
      )
      const running = Effect.runFork(Effect.provide(operation, environment.success.transport))

      await Effect.runPromise(Deferred.await(entered))
      await writeSnapshot(path, makeAuthenticatedSnapshot("winner"))
      Effect.runSync(Deferred.succeed(release, undefined))

      expect(await Effect.runPromise(Fiber.join(running))).toBe("carried-result")
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("rechecks an authenticated CAS winner before returning keepalive health", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voila-keepalive-conflict-"))
    const path = join(directory, "session.json")
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    let requests = 0

    try {
      await writeSnapshot(path, makeAuthenticatedSnapshot("boot"))
      const transport = stubTransportLayer(() => {
        requests += 1

        if (requests === 1) {
          return Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return healthyResponse
          })
        }

        return Effect.succeed({ body: "{}", headers: {}, status: 401 })
      })
      const environment = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: path }, transport)

      if (Result.isFailure(environment)) {
        throw new Error("Expected a valid operation environment")
      }

      const fiber = Effect.runFork(
        Effect.provide(
          runKeepaliveLoop(
            environment.success,
            makeTestKeepaliveConfig({
              healthyIntervalMs: KeepaliveHealthyIntervalMsSchema.make(60_000),
              expiryPolicy: "stop"
            })
          ),
          environment.success.transport
        )
      )

      await Effect.runPromise(Deferred.await(entered))
      await writeSnapshot(path, makeAuthenticatedSnapshot("fresh-login"))
      Effect.runSync(Deferred.succeed(release, undefined))

      expect(await Effect.runPromise(Fiber.join(fiber))).toBe("expired")
      expect(requests).toBe(2)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it.each(["deleted", "guest"] as const)(
    "stops as misconfigured when an authenticated keepalive loses to a %s winner",
    async (winner) => {
      const directory = await mkdtemp(join(tmpdir(), "voila-keepalive-conflict-"))
      const path = join(directory, "session.json")
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      let requests = 0

      try {
        await writeSnapshot(path, makeAuthenticatedSnapshot("boot"))
        const transport = stubTransportLayer(() => {
          requests += 1

          return Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return healthyResponse
          })
        })
        const environment = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: path }, transport)

        if (Result.isFailure(environment)) {
          throw new Error("Expected a valid operation environment")
        }

        const fiber = Effect.runFork(
          Effect.provide(
            runKeepaliveLoop(
              environment.success,
              makeTestKeepaliveConfig({
                healthyIntervalMs: KeepaliveHealthyIntervalMsSchema.make(60_000),
                expiryPolicy: "stop"
              })
            ),
            environment.success.transport
          )
        )

        await Effect.runPromise(Deferred.await(entered))
        if (winner === "deleted") {
          await rm(path)
        } else {
          await rm(path)
          await writeSnapshot(path, makeGuestSnapshot())
        }
        Effect.runSync(Deferred.succeed(release, undefined))

        expect(await Effect.runPromise(Fiber.join(fiber))).toBe("misconfigured")
        expect(requests).toBe(1)
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    }
  )

  it("bounds repeated authenticated CAS conflicts and hands off to retry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voila-keepalive-conflict-"))
    const path = join(directory, "session.json")
    const firstEntered = Deferred.makeUnsafe<void>()
    const firstRelease = Deferred.makeUnsafe<void>()
    const secondEntered = Deferred.makeUnsafe<void>()
    const secondRelease = Deferred.makeUnsafe<void>()
    const retried = Deferred.makeUnsafe<void>()
    let requests = 0

    try {
      await writeSnapshot(path, makeAuthenticatedSnapshot("boot"))
      const transport = stubTransportLayer(() => {
        requests += 1

        if (requests === 1 || requests === 2) {
          const entered = requests === 1 ? firstEntered : secondEntered
          const release = requests === 1 ? firstRelease : secondRelease
          return Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return healthyResponse
          })
        }

        return Effect.succeed(healthyResponse)
      })
      const environment = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: path }, transport)

      if (Result.isFailure(environment)) {
        throw new Error("Expected a valid operation environment")
      }

      const fiber = Effect.runFork(
        Effect.provide(
          runKeepaliveLoop(
            environment.success,
            makeTestKeepaliveConfig({
              healthyIntervalMs: KeepaliveHealthyIntervalMsSchema.make(60_000),
              retryDelayMs: KeepaliveRetryDelayMsSchema.make(60_000),
              maxRetryDelayMs: KeepaliveMaxRetryDelayMsSchema.make(60_000)
            }),
            (line) => {
              if (line.includes("session keepalive check failed")) {
                Effect.runSync(Deferred.succeed(retried, undefined))
              }
            }
          ),
          environment.success.transport
        )
      )

      await Effect.runPromise(Deferred.await(firstEntered))
      await writeSnapshot(path, makeAuthenticatedSnapshot("first-winner"))
      Effect.runSync(Deferred.succeed(firstRelease, undefined))
      await Effect.runPromise(Deferred.await(secondEntered))
      await writeSnapshot(path, makeAuthenticatedSnapshot("second-winner"))
      Effect.runSync(Deferred.succeed(secondRelease, undefined))

      await Effect.runPromise(Deferred.await(retried))
      expect(requests).toBe(2)
      Effect.runSync(Fiber.interrupt(fiber))
      await Effect.runPromise(Fiber.await(fiber))
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
