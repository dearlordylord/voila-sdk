/**
 * Optimistic-concurrency (CAS) read-modify-write store for small local state
 * files shared by multiple local processes.
 *
 * The store owns the entire read-modify-write cycle: `modify` reads the file
 * fresh, runs the caller's transform, compares the CAS token (the raw bytes as
 * read), and writes back with an atomic tmp+rename only if the file has not
 * changed. There is deliberately no plain `write` primitive — a blind write is
 * how a background keepalive once reverted fresh interactive logins. See
 * docs/adr/0001-cas-file-store-conflict-policy.md.
 */
import { Data, Effect, Either, type Schedule } from "effect"
import { randomUUID } from "node:crypto"
import { open, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

/** The file could not be read (missing, unreadable, or gone mid-cycle). */
export type CasFileStoreReadFailure = { readonly _tag: "CasFileStoreReadFailure"; readonly message: string }

/** The durable write (tmp create, fsync, or rename) could not complete. */
export type CasFileStoreWriteFailure = { readonly _tag: "CasFileStoreWriteFailure"; readonly message: string }

/** The file contents or the transformed value did not match the caller's schema. */
export type CasFileStoreContentsInvalid = { readonly _tag: "CasFileStoreContentsInvalid"; readonly message: string }

/** Conflicts on the file outlasted the caller's retry schedule. */
export type ConflictExhausted = { readonly _tag: "ConflictExhausted"; readonly message: string }

/** Every expected failure of the store, kept in typed Effect error channels. */
export type CasFileStoreError = CasFileStoreReadFailure | CasFileStoreWriteFailure | CasFileStoreContentsInvalid

/**
 * The externally visible result of a `modify` call. `value` is the state the
 * call settled on: the contents written on `saved`, or the fresh contents
 * another process wrote on `dropped-conflict` — so callers can adopt the fresh
 * state without a racy re-read. A later writer can of course move the file on
 * again; `saved` means no conflict was observed, not that the file is frozen.
 */
export type ModifyOutcome<A> =
  | { readonly _tag: "saved"; readonly value: A }
  | { readonly _tag: "dropped-conflict"; readonly value: A }

/**
 * What to do when the CAS token no longer matches at write time.
 *
 * `drop` (the default) discards the in-flight update — correct for
 * regenerable, lineage-bound writes like a keepalive rotation. `retry`
 * re-reads the fresh file and re-runs the whole transform, bounded by the
 * caller's Effect `Schedule`; exhaustion surfaces as `ConflictExhausted`.
 * There is no merge option: snapshots are only internally consistent within
 * one lineage, and merging across lineages builds heisenbugs.
 */
export type ConflictPolicy =
  | { readonly _tag: "drop" }
  | { readonly _tag: "retry"; readonly schedule: Schedule.Schedule<unknown, unknown, never> }

export const dropPolicy: ConflictPolicy = { _tag: "drop" }

export const retryPolicy = (schedule: Schedule.Schedule<unknown, unknown, never>): ConflictPolicy => ({
  _tag: "retry",
  schedule
})

const casFileStoreReadFailure = (path: string): CasFileStoreReadFailure => ({
  _tag: "CasFileStoreReadFailure",
  message: `State file could not be read: ${path}`
})

const casFileStoreWriteFailure = (path: string): CasFileStoreWriteFailure => ({
  _tag: "CasFileStoreWriteFailure",
  message: `State file could not be written durably: ${path}`
})

const conflictExhausted = (path: string): ConflictExhausted => ({
  _tag: "ConflictExhausted",
  message: `Conflicts on state file outlasted the retry schedule: ${path}`
})

const saved = (value: string): ModifyOutcome<string> => ({ _tag: "saved", value })

const droppedConflict = (value: string): ModifyOutcome<string> => ({ _tag: "dropped-conflict", value })

// Internal signal: the CAS token no longer matched at write time. Deliberately
// not an `Error` subclass — it carries the file's raw bytes, which can be
// secrets, and Effect pretty-prints the fields of a failed `Error` in causes.
class ConflictSignal extends Data.TaggedClass("ConflictSignal")<{ readonly current: string }> {}

const isConflictSignal = (error: unknown): error is ConflictSignal => error instanceof ConflictSignal

const readRaw = (path: string): Effect.Effect<string, CasFileStoreReadFailure> =>
  Effect.tryPromise({ try: () => readFile(path, "utf8"), catch: () => casFileStoreReadFailure(path) })

/** Read the current raw contents of a state file. */
export const read = readRaw

// state files can carry secrets (cookies, tokens): owner-only from creation,
// so the rename never publishes a world-readable window
const ownerOnlyMode = 0o600

const temporaryPathFor = (path: string): string =>
  join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)

const writeDurable = async (temporaryPath: string, contents: string): Promise<void> => {
  const handle = await open(temporaryPath, "w", ownerOnlyMode)

  try {
    await handle.writeFile(contents)
    // fsync before rename so a power loss cannot silently resurrect an older file
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Atomic durable write: sibling tmp file, fsync, rename. Always on, never
 * configurable — a crashed write must never leave a torn state file that
 * reads as corruption. Directory fsync is skipped deliberately (ADR-0001).
 */
const writeRawAtomic = (path: string, contents: string): Effect.Effect<void, CasFileStoreWriteFailure> =>
  Effect.gen(function* () {
    const temporaryPath = temporaryPathFor(path)
    const written = yield* Effect.either(
      Effect.tryPromise({
        try: () => writeDurable(temporaryPath, contents).then(() => rename(temporaryPath, path)),
        catch: () => casFileStoreWriteFailure(path)
      })
    )

    if (Either.isLeft(written)) {
      // best-effort cleanup so a failed write never leaves tmp litter behind;
      // a cleanup that itself fails must not mask the write failure
      yield* Effect.ignore(
        Effect.tryPromise({
          try: () => rm(temporaryPath, { force: true }),
          catch: () => casFileStoreWriteFailure(path)
        })
      )

      return yield* Effect.fail(written.left)
    }
  })

// One keyed semaphore per path serializes same-process `modify` calls, so
// fibers inside one process (the single-process MCP server — the dominant
// consumer — running a keepalive tick next to tool calls) cannot race by
// construction. Cross-process safety comes from the CAS check alone; a
// lockfile was considered and rejected (ADR-0001). Entries are never evicted:
// a local tool touches a handful of paths over its lifetime.
const semaphores = new Map<string, ReturnType<typeof Effect.unsafeMakeSemaphore>>()

const semaphoreFor = (path: string): ReturnType<typeof Effect.unsafeMakeSemaphore> => {
  // keyed on the resolved path so `dir//state.json`, `dir/state.json` and a
  // relative spelling of the same file share one semaphore
  const key = resolve(path)
  const existing = semaphores.get(key)

  if (existing !== undefined) {
    return existing
  }

  const created = Effect.unsafeMakeSemaphore(1)
  semaphores.set(key, created)

  return created
}

/**
 * The engine's outcome. On `saved` it carries whatever the transform produced
 * alongside the bytes, so a caller that layers a representation on top (the
 * Schema wrapper) reports its own value instead of re-reading what it wrote.
 */
export type CarryOutcome<A> =
  | { readonly _tag: "saved"; readonly carried: A }
  | { readonly _tag: "dropped-conflict"; readonly current: string }

const carried = <A>(value: A): CarryOutcome<A> => ({ _tag: "saved", carried: value })

const readModifyWrite = <A, E, R>(
  path: string,
  f: (contents: string) => Effect.Effect<readonly [string, A], E, R>
): Effect.Effect<CarryOutcome<A>, CasFileStoreReadFailure | CasFileStoreWriteFailure | ConflictSignal | E, R> =>
  Effect.gen(function* () {
    // The CAS token is the raw file bytes as read; comparison never goes
    // through a decoded/re-encoded value, so non-canonical serialization
    // cannot cause phantom conflicts.
    const base = yield* readRaw(path)
    const [next, produced] = yield* f(base)

    // The CAS re-read through the rename is uninterruptible: the underlying
    // write promise cannot be aborted, so an interruptible fiber would exit
    // while its rename is still in flight, release the permit, and let that
    // zombie rename land on top of a later writer.
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const current = yield* readRaw(path)

        if (current !== base) {
          return yield* Effect.fail(new ConflictSignal({ current }))
        }

        yield* writeRawAtomic(path, next)

        return carried(produced)
      })
    )
  })

/**
 * The read-modify-write engine, shared by the byte-level `modify` and the
 * Schema wrapper. Not part of the package's public surface.
 */
export const modifyCarrying = <A, E, R>(
  path: string,
  f: (contents: string) => Effect.Effect<readonly [string, A], E, R>,
  policy: ConflictPolicy
): Effect.Effect<CarryOutcome<A>, CasFileStoreReadFailure | CasFileStoreWriteFailure | ConflictExhausted | E, R> => {
  // The permit is held per attempt, not across the whole policy: a retry
  // schedule's delay must not block every other in-process caller on this path.
  const attempt = semaphoreFor(path).withPermits(1)(readModifyWrite(path, f))

  if (policy._tag === "drop") {
    return attempt.pipe(
      Effect.catchIf(isConflictSignal, (signal) =>
        Effect.succeed<CarryOutcome<A>>({ _tag: "dropped-conflict", current: signal.current })
      )
    )
  }

  return attempt.pipe(
    Effect.retry({ schedule: policy.schedule, while: isConflictSignal }),
    Effect.catchIf(isConflictSignal, () => Effect.fail(conflictExhausted(path)))
  )
}

/**
 * Own the whole read-modify-write cycle of a state file: fresh read, run `f`
 * on the raw contents, compare the CAS token, and write back atomically only
 * if the file has not changed. Same-process calls per path are serialized;
 * cross-process conflicts resolve per `policy` (default: drop).
 */
export const modify = <E = never, R = never>(
  path: string,
  f: (contents: string) => Effect.Effect<string, E, R>,
  policy: ConflictPolicy = dropPolicy
): Effect.Effect<
  ModifyOutcome<string>,
  CasFileStoreReadFailure | CasFileStoreWriteFailure | ConflictExhausted | E,
  R
> =>
  modifyCarrying(path, (contents) => f(contents).pipe(Effect.map((next) => [next, next] as const)), policy).pipe(
    Effect.map((outcome) => (outcome._tag === "saved" ? saved(outcome.carried) : droppedConflict(outcome.current)))
  )
