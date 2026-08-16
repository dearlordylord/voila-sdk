// PROTOTYPE — throwaway. Scenario tests for the CAS conflict policies.
import { it } from "@effect/vitest"
import { Effect, Fiber, Ref, TestClock } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect } from "vitest"

import {
  type Conflict,
  makeCasDropStore,
  makeCasRetryStore,
  makeLockStore,
  makeNaiveStore,
  type Network,
  rotateCookie,
  type Session
} from "./store.js"

const s0: Session = { lineage: "S0", cookies: "s0-cookie", rotations: 0 }
const s1: Session = { lineage: "S1", cookies: "s1-cookie", rotations: 0 }
const s2: Session = { lineage: "S2", cookies: "s2-cookie", rotations: 0 }

const tmpFile = Effect.tryPromise({
  try: async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "cas-proto-")), "session.json"),
  catch: (e) => new Error(`mkdtemp failed: ${e}`)
})

const readSession = (file: string) =>
  Effect.tryPromise({
    try: async () => JSON.parse(await fs.readFile(file, "utf8")) as Session,
    catch: (e) => new Error(`read failed: ${e}`)
  })

// login mid-flight: fork the keepalive tick, let it get into its 1s "HTTP
// call", have another process replace the file at t=500ms, then let the tick
// finish.
const withLoginMidFlight = <A, E>(
  tick: (n: Network) => Effect.Effect<A, E>,
  login: Effect.Effect<unknown>,
  network: Network = rotateCookie
) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(tick(network))
    yield* Effect.yieldNow()
    yield* TestClock.adjust("500 millis")
    yield* login
    yield* TestClock.adjust("600 millis")
    // absorb any retry delay + re-run inside the tick after conflict detection
    yield* TestClock.adjust("5 seconds")
    return yield* Fiber.join(fiber)
  })

describe("variant 0: status quo (process-lifetime cache + blind write)", () => {
  it.effect("reverts a concurrent login — the PR #3 clobber", () =>
    Effect.gen(function* () {
      const file = yield* tmpFile
      const keepalive = yield* makeNaiveStore(file)
      const user = yield* makeNaiveStore(file)

      yield* user.replace(s0)
      yield* keepalive.load // keepalive process boots, caches S0

      yield* withLoginMidFlight(keepalive.tick, user.replace(s1))

      const onDisk = yield* readSession(file)
      expect(onDisk.lineage).toBe("S0") // user's fresh S1 login is gone
    }))

  it.effect("reverts EVERY login until the process restarts (stopOnExpired: false)", () =>
    Effect.gen(function* () {
      const file = yield* tmpFile
      const keepalive = yield* makeNaiveStore(file)
      const user = yield* makeNaiveStore(file)

      yield* user.replace(s0)
      yield* keepalive.load

      yield* withLoginMidFlight(keepalive.tick, user.replace(s1))
      yield* withLoginMidFlight(keepalive.tick, user.replace(s2))

      const onDisk = yield* readSession(file)
      expect(onDisk.lineage).toBe("S0") // S1 and S2 both reverted
      expect(onDisk.rotations).toBe(2)
    }))
})

describe("variant A: re-read per tick + CAS drop", () => {
  it.effect("keeps the login and adopts its lineage on the next tick", () =>
    Effect.gen(function* () {
      const file = yield* tmpFile
      const keepalive = makeCasDropStore(file)
      const user = makeCasDropStore(file)

      yield* user.replace(s0)

      const outcome = yield* withLoginMidFlight(keepalive.tick, user.replace(s1))

      expect(outcome).toBe("dropped-conflict")
      expect((yield* readSession(file)).lineage).toBe("S1") // login survives

      // next scheduled tick works from the fresh lineage
      const fiber = yield* Effect.fork(keepalive.tick(rotateCookie))
      yield* Effect.yieldNow()
      yield* TestClock.adjust("2 seconds")
      expect(yield* Fiber.join(fiber)).toBe("saved")

      const onDisk = yield* readSession(file)
      expect(onDisk.lineage).toBe("S1")
      expect(onDisk.rotations).toBe(1) // cookies rotated forward from S1
    }))
})

describe("variant B: optimistic retry against the fresh base", () => {
  it.effect("converges by rotating the NEW lineage — at the cost of a repeated HTTP call", () =>
    Effect.gen(function* () {
      const file = yield* tmpFile
      const keepalive = makeCasRetryStore(file)
      const user = makeCasRetryStore(file)
      const networkCalls = yield* Ref.make(0)

      const countedNetwork: Network = (s) => Ref.update(networkCalls, (n) => n + 1).pipe(Effect.zipRight(rotateCookie(s)))

      yield* user.replace(s0)

      const outcome = yield* withLoginMidFlight(keepalive.tick, user.replace(s1), countedNetwork)

      expect(outcome).toBe("saved")
      expect(yield* Ref.get(networkCalls)).toBe(2) // conflict -> re-read -> re-run

      const onDisk = yield* readSession(file)
      expect(onDisk.lineage).toBe("S1") // login preserved AND rotated
      expect(onDisk.rotations).toBe(1)
    }))
})

describe("variant C: lockfile serialization", () => {
  it.effect("two processes' rotations both land — no lost update", () =>
    Effect.gen(function* () {
      const file = yield* tmpFile
      const processA = makeLockStore(file)
      const processB = makeLockStore(file)

      yield* processA.replace(s0)

      const fiberA = yield* Effect.fork(processA.tick(rotateCookie))
      const fiberB = yield* Effect.fork(processB.tick(rotateCookie))
      yield* Effect.yieldNow()
      yield* TestClock.adjust("10 seconds")

      expect(yield* Fiber.join(fiberA)).toBe("saved")
      expect(yield* Fiber.join(fiberB)).toBe("saved")
      expect((yield* readSession(file)).rotations).toBe(2)
    }))

  it.effect("releases the lock when the tick fiber is interrupted mid-flight", () =>
    Effect.gen(function* () {
      const file = yield* tmpFile
      const processA = makeLockStore(file)
      const processB = makeLockStore(file)

      yield* processA.replace(s0)

      const stuck: Network = () => Effect.sleep("1000 hours").pipe(Effect.as(s0))
      const fiber = yield* Effect.fork(processA.tick(stuck))
      yield* Effect.yieldNow()
      yield* TestClock.adjust("1 second") // A holds the lock, deep in its "HTTP call"
      yield* Fiber.interrupt(fiber)

      // lock is gone: B proceeds immediately instead of waiting 1000 hours
      const fiberB = yield* Effect.fork(processB.tick(rotateCookie))
      yield* Effect.yieldNow()
      yield* TestClock.adjust("2 seconds")
      expect(yield* Fiber.join(fiberB)).toBe("saved")
    }))
})
