import { it } from "@effect/vitest"
import { Deferred, type Duration, Effect, Fiber, Option, Ref, Schedule, Schema, TestClock } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect } from "vitest"

import {
  type CasFileStoreAbsent,
  type CasFileStorePathInvalid,
  type CasFileStoreReadFailure,
  type CasFileStoreWriteFailure,
  type ConflictExhausted,
  type ConflictPolicy,
  dropPolicy,
  keep,
  modify,
  type ModifyOutcome,
  parseStateFilePath,
  persist,
  type StateFilePath,
  StateFilePathSchema,
  read,
  retryPolicy
} from "../src/index.js"

const makeTempDir = Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "cas-file-store-")))

// tests own absolute temp paths, so the brand is applied directly; production
// callers parse a configured path through `parseStateFilePath`
const statePath = (value: string): StateFilePath => StateFilePathSchema.make(value)

const stateFile = (dir: string) => statePath(path.join(dir, "state.json"))

const writeRaw = (file: string, contents: string) => Effect.promise(() => fs.writeFile(file, contents, { mode: 0o600 }))

const readRaw = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

const fileMode = (file: string) => Effect.promise(() => fs.stat(file).then((stats) => stats.mode & 0o777))

const isMissing = (file: string) =>
  Effect.promise(() =>
    fs.access(file).then(
      () => false,
      () => true
    )
  )

const tmpEntries = (dir: string) =>
  Effect.promise(() => fs.readdir(dir).then((entries) => entries.filter((entry) => entry.endsWith(".tmp"))))

// Filesystem work settles on the macrotask queue, not on the TestClock, so
// waiting on a forked fiber's I/O means draining that queue rather than
// advancing time.
const settle = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)))

const waitUntilContents = (file: string, expected: string) =>
  settle.pipe(Effect.zipRight(readRaw(file)), Effect.repeat({ until: (contents) => contents === expected }))

// A fiber sleeping on a retry schedule only wakes when the TestClock passes its
// deadline, and it registers that sleep after filesystem work that the clock
// knows nothing about — so drain the queue and advance until the fiber is done.
const joinAdvancingClock = <A, E>(fiber: Fiber.RuntimeFiber<A, E>, step: Duration.DurationInput = "1 second") =>
  settle.pipe(
    Effect.zipRight(TestClock.adjust(step)),
    Effect.zipRight(Fiber.poll(fiber)),
    Effect.repeat({ until: Option.isSome }),
    Effect.zipRight(Fiber.join(fiber))
  )

const transformBoom = { _tag: "TransformBoom" } as const

describe("read", () => {
  it.effect("returns the current file contents", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "hello")

      const contents = yield* read(file)

      expect(contents).toBe("hello")
    })
  )

  it.effect("fails with CasFileStoreAbsent when the file does not exist", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)

      const error: CasFileStoreAbsent | CasFileStoreReadFailure = yield* read(file).pipe(Effect.flip)

      // absence has its own tag: "no state yet" is not "cannot read this file"
      expect(error._tag).toBe("CasFileStoreAbsent")
      expect(error.message).toContain(file)
    })
  )

  it.effect("fails with CasFileStoreReadFailure when the path cannot be read", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir

      const error: CasFileStoreAbsent | CasFileStoreReadFailure = yield* read(statePath(dir)).pipe(Effect.flip)

      expect(error._tag).toBe("CasFileStoreReadFailure")
      expect(error.message).toContain(dir)
    })
  )
})

describe("modify: saved", () => {
  it.effect("writes the transformed contents back and reports them as saved", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "hello")

      const outcome: ModifyOutcome<string> = yield* modify(file, (contents) =>
        Effect.succeed(persist(`${contents} world`))
      )

      expect(outcome).toEqual({ _tag: "saved", value: "hello world" })
      expect(yield* readRaw(file)).toBe("hello world")
    })
  )

  it.effect("writes atomically via a durable tmp file that leaves no litter behind", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "hello")

      yield* modify(file, (contents) => Effect.succeed(persist(`${contents} world`)))

      expect(yield* tmpEntries(dir)).toEqual([])
      expect(yield* fileMode(file)).toBe(0o600)
    })
  )
})

describe("modify: creation", () => {
  it.effect("runs the transform against absence and creates the file owner-only", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)

      const outcome = yield* modify(file, (contents) => Effect.succeed(persist(contents === undefined ? "first" : "?")))

      expect(outcome).toEqual({ _tag: "saved", value: "first" })
      expect(yield* readRaw(file)).toBe("first")
      expect(yield* fileMode(file)).toBe(0o600)
      expect(yield* tmpEntries(dir)).toEqual([])
    })
  )

  it.effect("creates the state file's directory when it does not exist yet", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const nested = path.join(dir, "config", "voila")
      const file = stateFile(nested)

      const outcome = yield* modify(file, () => Effect.succeed(persist("first")))

      expect(outcome).toEqual({ _tag: "saved", value: "first" })
      expect(yield* readRaw(file)).toBe("first")
      // the directory can carry secrets as much as the file does
      expect(yield* fileMode(nested)).toBe(0o700)
    })
  )

  it.effect("drops the update when another process created the file first", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        modify(file, () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.zipRight(Effect.sleep("1 second")),
            Effect.as(persist("ours"))
          )
        )
      )

      // both callers started from absence; the other one lands first
      yield* Deferred.await(entered)
      yield* writeRaw(file, "theirs")
      yield* TestClock.adjust("2 seconds")

      const outcome = yield* Fiber.join(fiber)

      // the exclusive create refuses to clobber, so the winner stands and the
      // loser is handed the contents that won
      expect(outcome).toEqual({ _tag: "dropped-conflict", value: "theirs" })
      expect(yield* readRaw(file)).toBe("theirs")
      expect(yield* tmpEntries(dir)).toEqual([])
    })
  )

  it.effect("retries creation against the fresh file after losing the race", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)

      const calls = yield* Ref.make(0)
      const transform = (contents: string | undefined) =>
        Ref.updateAndGet(calls, (n) => n + 1).pipe(
          Effect.flatMap((n) =>
            n === 1
              ? writeRaw(file, "theirs").pipe(Effect.as(persist("ours")))
              : Effect.succeed(persist(`${contents}+ours`))
          )
        )

      const outcome = yield* modify(file, transform, retryPolicy(Schedule.recurs(3)))

      expect(outcome).toEqual({ _tag: "saved", value: "theirs+ours" })
      expect(yield* Ref.get(calls)).toBe(2)
    })
  )

  it.effect("fails with CasFileStoreWriteFailure when creation cannot land", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      // a trailing slash names a directory that does not exist: the tmp file is
      // written next to it, but the link can never land there
      const file = statePath(`${stateFile(dir)}/`)

      const error = yield* modify(file, () => Effect.succeed(persist("first"))).pipe(Effect.flip)

      // a path that cannot be linked is a write failure, not a lost race
      expect(error._tag).toBe("CasFileStoreWriteFailure")
      expect(yield* tmpEntries(dir)).toEqual([])
    })
  )
})

describe("modify: keep", () => {
  it.effect("leaves an existing file untouched", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const outcome = yield* modify(file, () => Effect.succeed(keep))

      expect(outcome).toEqual({ _tag: "unchanged" })
      expect(yield* readRaw(file)).toBe("base")
      expect(yield* tmpEntries(dir)).toEqual([])
    })
  )

  it.effect("leaves a missing file missing", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)

      const outcome = yield* modify(file, () => Effect.succeed(keep))

      expect(outcome).toEqual({ _tag: "unchanged" })
      expect(yield* isMissing(file)).toBe(true)
    })
  )
})

describe("modify: conflict with drop policy", () => {
  // A second process writes between our base read and our write: the default
  // policy drops the in-flight update and the on-disk value stands.
  const conflictingModify = (file: StateFilePath, policy?: ConflictPolicy) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const transform = () =>
        Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Effect.sleep("1 second")), Effect.as(persist("ours")))
      const fiber = yield* Effect.fork(policy === undefined ? modify(file, transform) : modify(file, transform, policy))

      // f only runs after the base read, so the external write below always
      // lands between the base read and the CAS comparison.
      yield* Deferred.await(entered)
      yield* writeRaw(file, "external")
      yield* TestClock.adjust("2 seconds")

      return yield* Fiber.join(fiber)
    })

  it.effect("drops the in-flight update and surfaces the fresh contents (default policy)", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const outcome = yield* conflictingModify(file)

      expect(outcome).toEqual({ _tag: "dropped-conflict", value: "external" })
      expect(yield* readRaw(file)).toBe("external")
    })
  )

  it.effect("drops the in-flight update when the drop policy is passed explicitly", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const outcome = yield* conflictingModify(file, dropPolicy)

      expect(outcome).toEqual({ _tag: "dropped-conflict", value: "external" })
      expect(yield* readRaw(file)).toBe("external")
    })
  )
})

describe("modify: conflict with retry policy", () => {
  it.effect("re-runs the transform against the fresh base until the write lands", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const calls = yield* Ref.make(0)
      const transform = (contents: string | undefined) =>
        Ref.updateAndGet(calls, (n) => n + 1).pipe(
          Effect.flatMap((n) =>
            n === 1
              ? // the first attempt loses to a concurrent writer
                writeRaw(file, "fresh").pipe(Effect.as(persist("stale-update")))
              : Effect.succeed(persist(`${contents}+ours`))
          )
        )

      const outcome = yield* modify(file, transform, retryPolicy(Schedule.recurs(3)))

      expect(outcome).toEqual({ _tag: "saved", value: "fresh+ours" })
      expect(yield* Ref.get(calls)).toBe(2)
      expect(yield* readRaw(file)).toBe("fresh+ours")
    })
  )

  it.effect("waits out the schedule's delay before re-running the transform", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const calls = yield* Ref.make(0)
      const transform = (contents: string | undefined) =>
        Ref.updateAndGet(calls, (n) => n + 1).pipe(
          Effect.flatMap((n) =>
            n === 1
              ? writeRaw(file, "fresh").pipe(Effect.as(persist("stale-update")))
              : Effect.succeed(persist(`${contents}+ours`))
          )
        )

      const fiber = yield* Effect.fork(modify(file, transform, retryPolicy(Schedule.spaced("1 second"))))

      // the first attempt has conflicted; the retry has not run, because the
      // clock has not moved
      yield* waitUntilContents(file, "fresh")
      expect(yield* Ref.get(calls)).toBe(1)

      const outcome = yield* joinAdvancingClock(fiber)

      expect(outcome).toEqual({ _tag: "saved", value: "fresh+ours" })
      expect(yield* Ref.get(calls)).toBe(2)
    })
  )

  it.effect("surfaces ConflictExhausted when contention outlasts the retry schedule", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const calls = yield* Ref.make(0)
      // every attempt is beaten by a concurrent writer
      const transform = (contents: string | undefined) =>
        Ref.update(calls, (n) => n + 1).pipe(
          Effect.zipRight(writeRaw(file, `${contents}!`)),
          Effect.as(persist("ours"))
        )

      const error = yield* modify(file, transform, retryPolicy(Schedule.recurs(2))).pipe(Effect.flip)

      if (error._tag !== "ConflictExhausted") {
        throw new Error(`expected ConflictExhausted, got ${error._tag}`)
      }

      const exhausted: ConflictExhausted = error
      expect(exhausted.message).toContain(file)
      // initial attempt + 2 retries
      expect(yield* Ref.get(calls)).toBe(3)
    })
  )

  it.effect("does not retry transform failures, only conflicts", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const calls = yield* Ref.make(0)
      const transform = () => Ref.update(calls, (n) => n + 1).pipe(Effect.zipRight(Effect.fail(transformBoom)))

      const error = yield* modify(file, transform, retryPolicy(Schedule.recurs(5))).pipe(Effect.flip)

      expect(error._tag).toBe("TransformBoom")
      expect(yield* Ref.get(calls)).toBe(1)
      expect(yield* readRaw(file)).toBe("base")
    })
  )
})

describe("modify: failures", () => {
  it.effect("propagates a transform failure and leaves the file unchanged", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const error = yield* modify(file, () => Effect.fail(transformBoom)).pipe(Effect.flip)

      expect(error._tag).toBe("TransformBoom")
      expect(yield* readRaw(file)).toBe("base")
    })
  )

  it.effect("fails with CasFileStoreWriteFailure when the durable write cannot complete", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      // A 255-byte basename: the sibling tmp name (`.<basename>.<pid>.<uuid>.tmp`)
      // exceeds the filesystem component limit, so the tmp create fails while
      // reads still work. This is permission-independent and root-proof.
      const file = statePath(path.join(dir, `${"s".repeat(250)}.json`))
      yield* writeRaw(file, "base")

      const error = yield* modify(file, (contents) => Effect.succeed(persist(`${contents}!`))).pipe(Effect.flip)

      if (error._tag !== "CasFileStoreWriteFailure") {
        throw new Error(`expected CasFileStoreWriteFailure, got ${error._tag}`)
      }

      const writeFailure: CasFileStoreWriteFailure = error
      expect(writeFailure.message).toContain(file)
      // the original file is untouched and no tmp litter remains
      expect(yield* readRaw(file)).toBe("base")
      expect(yield* tmpEntries(dir)).toEqual([])
    })
  )

  it.effect("drops the update when the file disappears mid-cycle", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        modify(file, (contents) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.zipRight(Effect.sleep("1 second")),
            Effect.as(persist(`${contents}!`))
          )
        )
      )

      yield* Deferred.await(entered)
      yield* Effect.promise(() => fs.rm(file))
      yield* TestClock.adjust("2 seconds")

      const outcome = yield* Fiber.join(fiber)

      // removal is a state another process moved the file to: the update is
      // dropped rather than resurrecting a file its owner deleted
      expect(outcome).toEqual({ _tag: "dropped-conflict", value: undefined })
      expect(yield* isMissing(file)).toBe(true)
      expect(yield* tmpEntries(dir)).toEqual([])
    })
  )

  it.effect("keeps file contents out of error messages", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      const secret = "cookie=super-secret-token"
      // the over-long sibling tmp name makes the write fail while the read of
      // the secret-bearing file succeeds
      const unwritable = statePath(path.join(dir, `${"s".repeat(250)}.json`))
      yield* writeRaw(file, secret)
      yield* writeRaw(unwritable, secret)

      const readError = yield* read(statePath(dir)).pipe(Effect.flip)
      const writeError = yield* modify(unwritable, () => Effect.succeed(persist(secret))).pipe(Effect.flip)

      expect(readError.message).not.toContain(secret)
      expect(writeError.message).not.toContain(secret)
    })
  )
})

describe("modify: in-process serialization", () => {
  it.effect("serializes same-process modify calls per path so both updates land", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "0")

      const increment = (contents: string | undefined) => Effect.succeed(persist(String(Number(contents) + 1)))

      const fiberA = yield* Effect.fork(modify(file, increment))
      yield* Effect.yieldNow()
      const fiberB = yield* Effect.fork(modify(file, increment))

      const outcomeA = yield* Fiber.join(fiberA)
      const outcomeB = yield* Fiber.join(fiberB)

      expect(outcomeA._tag).toBe("saved")
      expect(outcomeB._tag).toBe("saved")
      expect(yield* readRaw(file)).toBe("2")
    })
  )

  it.effect("serializes calls that spell the same path differently", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "0")

      const increment = (contents: string | undefined) => Effect.succeed(persist(String(Number(contents) + 1)))

      const fiberA = yield* Effect.fork(modify(file, increment))
      yield* Effect.yieldNow()
      const fiberB = yield* Effect.fork(modify(statePath(`${dir}//./state.json`), increment))

      const outcomeA = yield* Fiber.join(fiberA)
      const outcomeB = yield* Fiber.join(fiberB)

      expect(outcomeA._tag).toBe("saved")
      expect(outcomeB._tag).toBe("saved")
      // no update is lost: an aliased spelling must not sidestep the semaphore
      expect(yield* readRaw(file)).toBe("2")
    })
  )

  it.effect("does not hold the permit across a retry schedule's delay", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const calls = yield* Ref.make(0)
      const retrying = (contents: string | undefined) =>
        Ref.updateAndGet(calls, (n) => n + 1).pipe(
          Effect.flatMap((n) =>
            n === 1
              ? writeRaw(file, "fresh").pipe(Effect.as(persist("stale")))
              : Effect.succeed(persist(`${contents}+retried`))
          )
        )

      const retryFiber = yield* Effect.fork(modify(file, retrying, retryPolicy(Schedule.spaced("1 hour"))))
      // the first attempt has run and lost; it is now inside the hour-long delay
      yield* waitUntilContents(file, "fresh")
      expect(yield* Ref.get(calls)).toBe(1)

      // an unrelated caller must not queue behind that delay: if the permit were
      // held across it, this call would block until the clock is advanced
      const outcome = yield* modify(file, (contents) => Effect.succeed(persist(`${contents}+other`)))

      expect(outcome).toEqual({ _tag: "saved", value: "fresh+other" })

      expect(yield* joinAdvancingClock(retryFiber, "1 hour")).toEqual({ _tag: "saved", value: "fresh+other+retried" })
    })
  )

  it.effect("releases the per-path semaphore when a modify fiber is interrupted", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "base")

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        modify(file, () => Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Effect.never)))
      )
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(fiber)

      const outcome = yield* modify(file, (contents) => Effect.succeed(persist(`${contents}+after`)))

      expect(outcome).toEqual({ _tag: "saved", value: "base+after" })
    })
  )
})

describe("parseStateFilePath", () => {
  it.effect("accepts an absolute path", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir

      expect(yield* parseStateFilePath(path.join(dir, "state.json"))).toBe(path.join(dir, "state.json"))
    })
  )

  it.effect("rejects a relative path, which would name different files in different processes", () =>
    Effect.gen(function* () {
      const error: CasFileStorePathInvalid = yield* parseStateFilePath("state.json").pipe(Effect.flip)

      expect(error._tag).toBe("CasFileStorePathInvalid")
      // the configured path can name a user or a machine
      expect(error.message).not.toContain("state.json")
    })
  )

  it.effect("explains the rule when the schema is decoded directly", () =>
    Effect.gen(function* () {
      const error = yield* Schema.decodeUnknown(StateFilePathSchema)("state.json").pipe(Effect.flip)

      expect(error.message).toContain("must be a non-empty absolute path")
    })
  )

  it.effect("rejects a blank path and a non-string", () =>
    Effect.gen(function* () {
      expect((yield* parseStateFilePath("   ").pipe(Effect.flip))._tag).toBe("CasFileStorePathInvalid")
      expect((yield* parseStateFilePath(42).pipe(Effect.flip))._tag).toBe("CasFileStorePathInvalid")
    })
  )
})
