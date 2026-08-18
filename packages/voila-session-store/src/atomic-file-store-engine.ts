import { Data, Effect } from "effect"
import { randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import { ReadError, WriteError, type ConflictExhausted } from "./atomic-file-store-errors.js"
import { StateFileLocks } from "./atomic-file-store-locks.js"
import type { StateFilePath } from "./atomic-file-store-path.js"

export type WriteDecision<A> = { readonly _tag: "write"; readonly value: A } | { readonly _tag: "keep" }

export const persist = <A>(value: A): WriteDecision<A> => ({ _tag: "write", value })
export const keep: WriteDecision<never> = { _tag: "keep" }

export type ModifyCycleStep<W, K> =
  | { readonly _tag: "write"; readonly payload: { readonly carried: W; readonly contents: string } }
  | { readonly _tag: "keep"; readonly carried: K }

export type ModifyCarryOutcome<W, K> =
  | { readonly _tag: "saved"; readonly carried: W }
  | { readonly _tag: "unchanged"; readonly carried: K }
  | { readonly _tag: "dropped-conflict"; readonly carried: W; readonly current: string | undefined }

const ownerOnlyMode = 0o600
const ownerOnlyDirectoryMode = 0o700

const hasErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code

const readOptionalRaw = (path: StateFilePath): Effect.Effect<string | undefined, ReadError> =>
  Effect.tryPromise({
    try: () =>
      readFile(path, "utf8").catch((error: unknown) => {
        if (hasErrorCode(error, "ENOENT")) {
          return undefined
        }

        throw error
      }),
    catch: () => new ReadError(path)
  })

const fileSystemCall = <A>(path: StateFilePath, call: () => Promise<A>): Effect.Effect<A, WriteError> =>
  Effect.tryPromise({ try: call, catch: () => new WriteError(path) })

const temporaryPathFor = (path: StateFilePath): string =>
  join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)

const writeDurable = (path: StateFilePath, temporaryPath: string, contents: string): Effect.Effect<void, WriteError> =>
  Effect.flatMap(
    fileSystemCall(path, () => mkdir(dirname(temporaryPath), { recursive: true, mode: ownerOnlyDirectoryMode })),
    () =>
      Effect.acquireUseRelease(
        fileSystemCall(path, () => open(temporaryPath, "w", ownerOnlyMode)),
        (handle) =>
          Effect.flatMap(
            fileSystemCall(path, () => handle.writeFile(contents)),
            () => Effect.asVoid(fileSystemCall(path, () => handle.sync()))
          ),
        (handle) => Effect.ignore(fileSystemCall(path, () => handle.close()))
      )
  )

const writeThroughTemporary = <A>(
  path: StateFilePath,
  contents: string,
  land: (temporaryPath: string) => Effect.Effect<A, WriteError>
): Effect.Effect<A, WriteError> => {
  const temporaryPath = temporaryPathFor(path)
  const cleanup = Effect.ignore(fileSystemCall(path, () => rm(temporaryPath, { force: true })))

  return Effect.ensuring(
    Effect.flatMap(writeDurable(path, temporaryPath, contents), () => land(temporaryPath)),
    cleanup
  )
}

const replaceRawAtomic = (path: StateFilePath, contents: string): Effect.Effect<void, WriteError> =>
  writeThroughTemporary(path, contents, (temporaryPath) =>
    Effect.asVoid(fileSystemCall(path, () => rename(temporaryPath, path)))
  )

const createRawExclusive = (path: StateFilePath, contents: string): Effect.Effect<boolean, WriteError> =>
  writeThroughTemporary(path, contents, (temporaryPath) =>
    fileSystemCall(path, () =>
      link(temporaryPath, path)
        .then(() => true)
        .catch((error: unknown) => {
          if (hasErrorCode(error, "EEXIST")) {
            return false
          }

          throw error
        })
    )
  )

class ConflictSignal<W> extends Data.TaggedClass("ConflictSignal")<{
  readonly carried: W
  readonly current: string | undefined
}> {}

const isConflictSignal = <W>(error: unknown): error is ConflictSignal<W> => error instanceof ConflictSignal

const replaceIfUnchanged = <W>(
  path: StateFilePath,
  base: string,
  payload: { readonly carried: W; readonly contents: string }
): Effect.Effect<{ readonly _tag: "saved"; readonly carried: W }, ReadError | WriteError | ConflictSignal<W>> =>
  Effect.gen(function* () {
    const current = yield* readOptionalRaw(path)

    if (current !== base) {
      return yield* Effect.fail(new ConflictSignal({ carried: payload.carried, current }))
    }

    yield* replaceRawAtomic(path, payload.contents)
    return { _tag: "saved", carried: payload.carried }
  })

const createIfAbsent = <W>(
  path: StateFilePath,
  payload: { readonly carried: W; readonly contents: string }
): Effect.Effect<{ readonly _tag: "saved"; readonly carried: W }, ReadError | WriteError | ConflictSignal<W>> =>
  Effect.gen(function* () {
    const created = yield* createRawExclusive(path, payload.contents)

    if (created) {
      return { _tag: "saved", carried: payload.carried }
    }

    const current = yield* readOptionalRaw(path)
    return yield* Effect.fail(new ConflictSignal({ carried: payload.carried, current }))
  })

const readModifyWrite = <W, K, E, R>(
  path: StateFilePath,
  update: (contents: string | undefined) => Effect.Effect<ModifyCycleStep<W, K>, E, R>
): Effect.Effect<
  | { readonly _tag: "saved"; readonly carried: W }
  | { readonly _tag: "unchanged"; readonly carried: K }
  | { readonly _tag: "dropped-conflict"; readonly carried: W; readonly current: string | undefined },
  ReadError | WriteError | ConflictSignal<W> | E,
  R
> =>
  Effect.gen(function* () {
    const base = yield* readOptionalRaw(path)
    const step = yield* update(base)

    if (step._tag === "keep") {
      return { _tag: "unchanged", carried: step.carried }
    }

    return yield* Effect.uninterruptible(
      base === undefined ? createIfAbsent(path, step.payload) : replaceIfUnchanged(path, base, step.payload)
    )
  })

export const modifyCarrying = <W, K, E, R>(
  path: StateFilePath,
  update: (contents: string | undefined) => Effect.Effect<ModifyCycleStep<W, K>, E, R>
): Effect.Effect<ModifyCarryOutcome<W, K>, ReadError | WriteError | ConflictExhausted | E, R | StateFileLocks> =>
  Effect.flatMap(Effect.service(StateFileLocks), (locks) =>
    locks.withPermit(resolve(path), readModifyWrite(path, update))
  ).pipe(
    Effect.catchIf(isConflictSignal<W>, (signal) => {
      const outcome: ModifyCarryOutcome<W, K> = {
        _tag: "dropped-conflict",
        carried: signal.carried,
        current: signal.current
      }
      return Effect.succeed(outcome)
    })
  )
