import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Schema, TestClock } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect } from "vitest"

import {
  type CasFileStoreContentsInvalid,
  type CasFileStoreError,
  type ConflictExhausted,
  keep,
  modifySchema,
  persist,
  type StateFilePath,
  StateFilePathSchema
} from "../src/index.js"

const StateSchema = Schema.Struct({ lineage: Schema.String, rotations: Schema.Number })

type State = Schema.Schema.Type<typeof StateSchema>

const makeTempDir = Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "cas-file-store-schema-")))

const statePath = (value: string): StateFilePath => StateFilePathSchema.make(value)

const stateFile = (dir: string) => statePath(path.join(dir, "state.json"))

const writeRaw = (file: string, contents: string) => Effect.promise(() => fs.writeFile(file, contents, { mode: 0o600 }))

const readState = (file: string) =>
  Effect.promise(() => fs.readFile(file, "utf8")).pipe(
    Effect.map((contents) => Schema.decodeUnknownSync(StateSchema)(JSON.parse(contents)))
  )

const expectContentsInvalid = (error: CasFileStoreError | ConflictExhausted): CasFileStoreContentsInvalid => {
  if (error._tag !== "CasFileStoreContentsInvalid") {
    throw new Error(`expected CasFileStoreContentsInvalid, got ${error._tag}`)
  }

  return error
}

const rotate = (state: State | undefined) =>
  Effect.succeed(persist({ lineage: state?.lineage ?? "S0", rotations: (state?.rotations ?? 0) + 1 }))

describe("modifySchema", () => {
  it.effect("decodes, transforms, encodes, and reports the decoded saved value", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, JSON.stringify({ lineage: "S0", rotations: 0 } satisfies State))

      const outcome = yield* modifySchema(file, StateSchema, rotate)

      expect(outcome).toEqual({ _tag: "saved", value: { lineage: "S0", rotations: 1 } })
      expect(yield* readState(file)).toEqual({ lineage: "S0", rotations: 1 })
    })
  )

  it.effect("runs the transform against absence and creates the file", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)

      const outcome = yield* modifySchema(file, StateSchema, (state) =>
        Effect.succeed(persist({ lineage: state === undefined ? "fresh" : "existing", rotations: 0 }))
      )

      expect(outcome).toEqual({ _tag: "saved", value: { lineage: "fresh", rotations: 0 } })
      expect(yield* readState(file)).toEqual({ lineage: "fresh", rotations: 0 })
    })
  )

  it.effect("leaves the file untouched when the transform keeps it", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, JSON.stringify({ lineage: "S0", rotations: 0 } satisfies State))

      const outcome = yield* modifySchema(file, StateSchema, () => Effect.succeed(keep))

      expect(outcome).toEqual({ _tag: "unchanged" })
      expect(yield* readState(file)).toEqual({ lineage: "S0", rotations: 0 })
    })
  )

  it.effect("reports the value the transform produced, not a re-decode of the written bytes", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, JSON.stringify({ lineage: "S0", rotations: 0 } satisfies State))

      // NaN does not round-trip through JSON: it encodes to null, which the
      // schema rejects on the way back in
      const outcome = yield* modifySchema(file, StateSchema, (state) =>
        Effect.succeed(persist({ lineage: state?.lineage ?? "S0", rotations: Number.NaN }))
      )

      expect(outcome._tag).toBe("saved")
      expect(outcome._tag === "saved" ? outcome.value.rotations : 0).toBeNaN()
    })
  )

  it.effect("adopts the fresh decoded value after a dropped conflict", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, JSON.stringify({ lineage: "S0", rotations: 0 } satisfies State))

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        modifySchema(file, StateSchema, (state) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.zipRight(Effect.sleep("1 second")),
            Effect.as(persist({ lineage: state?.lineage ?? "S0", rotations: 99 }))
          )
        )
      )

      yield* Deferred.await(entered)
      // a fresh login from another process starts a new lineage mid-flight
      yield* writeRaw(file, JSON.stringify({ lineage: "S1", rotations: 7 } satisfies State))
      yield* TestClock.adjust("2 seconds")

      const outcome = yield* Fiber.join(fiber)

      expect(outcome).toEqual({ _tag: "dropped-conflict", value: { lineage: "S1", rotations: 7 } })
      expect(yield* readState(file)).toEqual({ lineage: "S1", rotations: 7 })
    })
  )

  it.effect("reports a dropped conflict without a value when the winner removed the file", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, JSON.stringify({ lineage: "S0", rotations: 0 } satisfies State))

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        modifySchema(file, StateSchema, (state) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.zipRight(Effect.sleep("1 second")),
            Effect.as(persist({ lineage: state?.lineage ?? "S0", rotations: 99 }))
          )
        )
      )

      yield* Deferred.await(entered)
      yield* Effect.promise(() => fs.rm(file))
      yield* TestClock.adjust("2 seconds")

      const outcome = yield* Fiber.join(fiber)

      expect(outcome).toEqual({ _tag: "dropped-conflict", value: undefined })
    })
  )

  it.effect("fails with CasFileStoreContentsInvalid when the file is not valid JSON", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, "{not json")

      const error = expectContentsInvalid(
        yield* modifySchema(file, StateSchema, () => Effect.succeed(keep)).pipe(Effect.flip)
      )

      expect(error.message).toContain(file)
    })
  )

  it.effect("fails with CasFileStoreContentsInvalid when the JSON does not match the schema", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, JSON.stringify({ lineage: 42, rotations: 0 }))

      const error = expectContentsInvalid(
        yield* modifySchema(file, StateSchema, () => Effect.succeed(keep)).pipe(Effect.flip)
      )

      expect(error.message).toContain(file)
    })
  )

  it.effect("fails with CasFileStoreContentsInvalid when the transformed value cannot be encoded", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, JSON.stringify("abcdef"))

      const error = expectContentsInvalid(
        yield* modifySchema(file, Schema.String.pipe(Schema.minLength(3)), () => Effect.succeed(persist("ab"))).pipe(
          Effect.flip
        )
      )

      expect(error.message).toContain(file)
      // the file is unchanged: the write never happened
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(JSON.stringify("abcdef"))
    })
  )

  it.effect("fails with CasFileStoreContentsInvalid when the adopted contents do not match the schema", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = stateFile(dir)
      yield* writeRaw(file, JSON.stringify({ lineage: "S0", rotations: 0 } satisfies State))

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        modifySchema(file, StateSchema, (state) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.zipRight(Effect.sleep("1 second")),
            Effect.as(persist({ lineage: state?.lineage ?? "S0", rotations: 0 }))
          )
        )
      )

      yield* Deferred.await(entered)
      yield* writeRaw(file, "garbage")
      yield* TestClock.adjust("2 seconds")

      const error = expectContentsInvalid(yield* Fiber.join(fiber).pipe(Effect.flip))

      expect(error.message).toContain(file)
    })
  )
})
