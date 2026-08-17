import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { describe, expect } from "vitest"

import { makeStateFileLocks, StateFileLocks, stateFileLocksLayer, type StateFileLocksService } from "../src/index.js"

const runWith = <A>(locks: StateFileLocksService, key: string, effect: Effect.Effect<A>) =>
  locks.withPermit(key, effect)

describe("StateFileLocks", () => {
  it.effect("serializes concurrent holders of one key", () =>
    Effect.gen(function* () {
      const locks = yield* makeStateFileLocks()
      const holding = yield* Ref.make(0)
      const maxObserved = yield* Ref.make(0)

      const critical = Ref.updateAndGet(holding, (n) => n + 1).pipe(
        Effect.tap((n) => Ref.update(maxObserved, (max) => Math.max(max, n))),
        Effect.zipRight(Effect.yieldNow()),
        Effect.ensuring(Ref.update(holding, (n) => n - 1))
      )

      yield* Effect.all([runWith(locks, "/a/state.json", critical), runWith(locks, "/a/state.json", critical)], {
        concurrency: "unbounded"
      })

      expect(yield* Ref.get(maxObserved)).toBe(1)
    })
  )

  it.effect("does not serialize different keys", () =>
    Effect.gen(function* () {
      const locks = yield* makeStateFileLocks()
      const enteredA = yield* Deferred.make<void>()
      const releaseA = yield* Deferred.make<void>()

      const fiberA = yield* Effect.fork(
        runWith(
          locks,
          "/a/state.json",
          Deferred.succeed(enteredA, undefined).pipe(Effect.zipRight(Deferred.await(releaseA)))
        )
      )

      yield* Deferred.await(enteredA)
      // B enters while A still holds its lock
      yield* runWith(locks, "/b/state.json", Effect.void)
      yield* Deferred.succeed(releaseA, undefined)
      yield* Fiber.join(fiberA)
    })
  )

  it.effect("shares one lock across two checkouts, including after idle eviction", () =>
    Effect.gen(function* () {
      // capacity 1: using key B evicts key A's idle entry
      const locks = yield* makeStateFileLocks(1)

      yield* runWith(locks, "/a/state.json", Effect.void)
      yield* runWith(locks, "/b/state.json", Effect.void)

      // A's semaphore was evicted and rebuilt; exclusion is still intact
      const holding = yield* Ref.make(0)
      const maxObserved = yield* Ref.make(0)
      const critical = Ref.updateAndGet(holding, (n) => n + 1).pipe(
        Effect.tap((n) => Ref.update(maxObserved, (max) => Math.max(max, n))),
        Effect.zipRight(Effect.yieldNow()),
        Effect.ensuring(Ref.update(holding, (n) => n - 1))
      )

      yield* Effect.all([runWith(locks, "/a/state.json", critical), runWith(locks, "/a/state.json", critical)], {
        concurrency: "unbounded"
      })

      expect(yield* Ref.get(maxObserved)).toBe(1)
    })
  )

  it.effect("never evicts an entry with a holder, even past capacity", () =>
    Effect.gen(function* () {
      const locks = yield* makeStateFileLocks(1)
      const enteredA = yield* Deferred.make<void>()
      const releaseA = yield* Deferred.make<void>()
      const aWentAround = yield* Ref.make(0)

      const holdA = (marker: Effect.Effect<void>) =>
        runWith(locks, "/a/state.json", Ref.update(aWentAround, (n) => n + 1).pipe(Effect.zipRight(marker)))

      const fiberA = yield* Effect.fork(
        holdA(Deferred.succeed(enteredA, undefined).pipe(Effect.zipRight(Deferred.await(releaseA))))
      )

      yield* Deferred.await(enteredA)
      // B and C cycle through while A's entry is active; capacity cannot evict it
      yield* runWith(locks, "/b/state.json", Effect.void)
      yield* runWith(locks, "/c/state.json", Effect.void)

      // a second caller on A still queues behind A's live lock
      const secondDone = yield* Deferred.make<void>()
      const fiberSecond = yield* Effect.fork(holdA(Deferred.succeed(secondDone, undefined)))

      yield* Effect.yieldNow()
      expect(yield* Deferred.isDone(secondDone)).toBe(false)

      yield* Deferred.succeed(releaseA, undefined)
      yield* Fiber.join(fiberA)
      yield* Fiber.join(fiberSecond)
      expect(yield* Ref.get(aWentAround)).toBe(2)
    })
  )

  it.effect("releases the permit when the locked effect is interrupted", () =>
    Effect.gen(function* () {
      const locks = yield* makeStateFileLocks()
      const entered = yield* Deferred.make<void>()

      const fiber = yield* Effect.fork(
        runWith(locks, "/a/state.json", Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Effect.never)))
      )

      yield* Deferred.await(entered)
      yield* Fiber.interrupt(fiber)

      // the next holder enters immediately: the interrupted fiber checked in
      yield* runWith(locks, "/a/state.json", Effect.void)
    })
  )

  it.effect("provides a lock table as a layer", () =>
    Effect.gen(function* () {
      const locks = yield* StateFileLocks
      const holding = yield* Ref.make(0)
      const maxObserved = yield* Ref.make(0)

      const critical = Ref.updateAndGet(holding, (n) => n + 1).pipe(
        Effect.tap((n) => Ref.update(maxObserved, (max) => Math.max(max, n))),
        Effect.zipRight(Effect.yieldNow()),
        Effect.ensuring(Ref.update(holding, (n) => n - 1))
      )

      yield* Effect.all([runWith(locks, "/a/state.json", critical), runWith(locks, "/a/state.json", critical)], {
        concurrency: "unbounded"
      })

      expect(yield* Ref.get(maxObserved)).toBe(1)
    }).pipe(Effect.provide(stateFileLocksLayer(1)))
  )

  it.effect("gives independent tables independent locks", () =>
    Effect.gen(function* () {
      const one = yield* makeStateFileLocks()
      const two = yield* makeStateFileLocks()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()

      const fiber = yield* Effect.fork(
        runWith(
          one,
          "/a/state.json",
          Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Deferred.await(release)))
        )
      )

      yield* Deferred.await(entered)
      yield* runWith(two, "/a/state.json", Effect.void)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(fiber)
    })
  )
})
