import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Schema, SchemaGetter, SchemaIssue } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect } from "vitest"

import {
  ConflictExhausted,
  ContentsInvalidError,
  PathInvalidError,
  ReadError,
  WriteError
} from "../src/atomic-file-store-errors.js"
import { makeStateFileLocks, StateFileLocks } from "../src/atomic-file-store-locks.js"
import { modifyCarrying, persist } from "../src/atomic-file-store-engine.js"
import { parseStateFilePath, StateFilePathSchema, type StateFilePath } from "../src/atomic-file-store-path.js"
import { modifySchemaCarrying } from "../src/atomic-file-store-schema.js"

const makeTempDir = Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "voila-atomic-file-store-")))

const stateFile = (directory: string): StateFilePath => StateFilePathSchema.make(path.join(directory, "state.json"))

describe("native atomic file store boundaries", () => {
  it("keeps adapter error tags and redacted messages stable", () => {
    const read = new ReadError("/tmp/session.json")
    const write = new WriteError("/tmp/session.json")
    const contents = new ContentsInvalidError("/tmp/session.json")
    const conflict = new ConflictExhausted("/tmp/session.json")
    const invalidPath = new PathInvalidError()

    expect(read).toMatchObject({
      _tag: "ReadError",
      path: "/tmp/session.json",
      message: "State file could not be read"
    })
    expect(write).toMatchObject({
      _tag: "WriteError",
      path: "/tmp/session.json",
      message: "State file could not be written"
    })
    expect(contents).toMatchObject({
      _tag: "ContentsInvalidError",
      path: "/tmp/session.json",
      message: "State file contents do not match its schema"
    })
    expect(conflict).toMatchObject({
      _tag: "ConflictExhausted",
      path: "/tmp/session.json",
      message: "State file conflicts exhausted the retry policy"
    })
    expect(invalidPath).toMatchObject({ _tag: "PathInvalidError", message: "State file path is invalid" })
  })

  it.effect("parses absolute state paths and maps invalid input to PathInvalidError", () =>
    Effect.gen(function* () {
      const directory = yield* makeTempDir
      const file = path.join(directory, "session.json")
      const parsed = yield* parseStateFilePath(file)
      expect(parsed).toBe(file)

      const error = yield* parseStateFilePath("relative/session.json").pipe(Effect.flip)
      expect(error).toBeInstanceOf(PathInvalidError)
      expect(error._tag).toBe("PathInvalidError")
    })
  )

  it.effect("evicts idle lock entries while retaining active entries", () =>
    Effect.gen(function* () {
      const locks = yield* makeStateFileLocks(1)
      const firstReady = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()

      const hold = (ready: Deferred.Deferred<void>, release: Deferred.Deferred<void>) =>
        Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(release)))

      const first = yield* Effect.forkChild(locks.withPermit("first", hold(firstReady, releaseFirst)))
      yield* Deferred.await(firstReady)
      const second = yield* Effect.forkChild(locks.withPermit("second", hold(secondReady, releaseSecond)))
      yield* Deferred.await(secondReady)

      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Deferred.succeed(releaseSecond, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)

      expect(yield* locks.withPermit("third", Effect.succeed("completed"))).toBe("completed")
    })
  )

  it.effect("maps schema encoding failures to ContentsInvalidError", () =>
    Effect.gen(function* () {
      const directory = yield* makeTempDir
      const file = stateFile(directory)
      const failingEncodeSchema = Schema.String.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.transform((value) => value),
          encode: SchemaGetter.transformOrFail((value, options) =>
            value === "encode-fails"
              ? Effect.fail(new SchemaIssue.InvalidValue({ message: "encoding rejected" }, value, options))
              : Effect.succeed(value)
          )
        })
      )
      const locks = yield* makeStateFileLocks()

      const error = yield* modifySchemaCarrying(file, failingEncodeSchema, () =>
        Effect.succeed({ carried: "result", decision: persist("encode-fails") })
      ).pipe(Effect.provideService(StateFileLocks, locks), Effect.flip)

      expect(error).toBeInstanceOf(ContentsInvalidError)
      expect(error._tag).toBe("ContentsInvalidError")
      const exists = yield* Effect.promise(() =>
        fs.access(file).then(
          () => true,
          () => false
        )
      )
      expect(exists).toBe(false)
    })
  )

  it.effect("maps a hard-link landing failure to WriteError", () =>
    Effect.gen(function* () {
      const directory = yield* makeTempDir
      const file = StateFilePathSchema.make(`${path.join(directory, "missing-directory")}/`)
      const locks = yield* makeStateFileLocks()

      const error = yield* modifyCarrying(file, () =>
        Effect.succeed({ _tag: "write", payload: { carried: "result", contents: "payload" } })
      ).pipe(Effect.provideService(StateFileLocks, locks), Effect.flip)

      expect(error).toBeInstanceOf(WriteError)
      expect(error._tag).toBe("WriteError")
    })
  )
})
