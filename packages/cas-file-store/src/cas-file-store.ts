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
 *
 * A missing file is a normal starting state, not a failure: the transform runs
 * against `undefined` and the file is created inside the same cycle, so
 * creation cannot be a blind write by another name.
 */
import { Data, Effect, type Schedule } from "effect"
import { randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import type { StateFilePath } from "./state-file-path.js"
import { StateFileLocks } from "./state-file-locks.js"

/** The file could not be read (unreadable, or gone mid-cycle). */
export type CasFileStoreReadFailure = { readonly _tag: "CasFileStoreReadFailure"; readonly message: string }

/**
 * The file does not exist. Its own tag, because a read-only caller asking
 * whether there is state yet must be able to tell that apart from a file it
 * is not allowed to read.
 */
export type CasFileStoreAbsent = { readonly _tag: "CasFileStoreAbsent"; readonly message: string }

/** The durable write (tmp create, fsync, rename, or link) could not complete. */
export type CasFileStoreWriteFailure = { readonly _tag: "CasFileStoreWriteFailure"; readonly message: string }

/** The file contents or the transformed value did not match the caller's schema. */
export type CasFileStoreContentsInvalid = { readonly _tag: "CasFileStoreContentsInvalid"; readonly message: string }

/** Conflicts on the file outlasted the caller's retry schedule. */
export type ConflictExhausted = { readonly _tag: "ConflictExhausted"; readonly message: string }

/**
 * Every expected failure of a read-modify-write cycle, kept in typed Effect
 * error channels. Absence is not among them: a cycle runs against a missing
 * file and creates it, so only the read-only `read` can fail that way.
 */
export type CasFileStoreError = CasFileStoreReadFailure | CasFileStoreWriteFailure | CasFileStoreContentsInvalid

/**
 * What a transform decided to do with the file. `keep` leaves the file exactly
 * as it is — including leaving a missing file missing — so a transform that
 * finds nothing worth persisting does not have to invent a value.
 */
export type WriteDecision<A> = { readonly _tag: "write"; readonly value: A } | { readonly _tag: "keep" }

export const persist = <A>(value: A): WriteDecision<A> => ({ _tag: "write", value })

export const keep: WriteDecision<never> = { _tag: "keep" }

/**
 * The externally visible result of a `modify` call. `value` is the state the
 * call settled on: the contents written on `saved`, or the fresh contents
 * another process wrote on `dropped-conflict` — so callers can adopt the fresh
 * state without a racy re-read. A `dropped-conflict` value is `undefined` when
 * the process that won removed the file. A later writer can of course move the
 * file on again; `saved` means no conflict was observed, not that the file is
 * frozen.
 */
export type ModifyOutcome<A> =
  | { readonly _tag: "saved"; readonly value: A }
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "dropped-conflict"; readonly value: A | undefined }

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

const casFileStoreAbsent = (path: string): CasFileStoreAbsent => ({
  _tag: "CasFileStoreAbsent",
  message: `State file does not exist: ${path}`
})

const casFileStoreWriteFailure = (path: string): CasFileStoreWriteFailure => ({
  _tag: "CasFileStoreWriteFailure",
  message: `State file could not be written durably: ${path}`
})

const conflictExhausted = (path: string): ConflictExhausted => ({
  _tag: "ConflictExhausted",
  message: `Conflicts on state file outlasted the retry schedule: ${path}`
})

const hasErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code

const readOptionalRaw = (path: string): Effect.Effect<string | undefined, CasFileStoreReadFailure> =>
  Effect.tryPromise({
    try: () =>
      readFile(path, "utf8").catch((error: unknown) => {
        if (hasErrorCode(error, "ENOENT")) {
          return undefined
        }

        throw error
      }),
    catch: () => casFileStoreReadFailure(path)
  })

/**
 * Read the current raw contents of a state file. A file that does not exist
 * fails with `CasFileStoreAbsent`, which a caller that treats "no state yet" as
 * normal handles with `Effect.catchTag`.
 *
 * The cycle itself does not go through here: `modify` hands absence to the
 * transform as a value, because a transform that never runs cannot create the
 * file.
 */
export const read = (path: StateFilePath): Effect.Effect<string, CasFileStoreAbsent | CasFileStoreReadFailure> =>
  readOptionalRaw(path).pipe(
    Effect.flatMap((contents) =>
      contents === undefined ? Effect.fail(casFileStoreAbsent(path)) : Effect.succeed(contents)
    )
  )

// state files can carry secrets (cookies, tokens): owner-only from creation,
// so the rename never publishes a world-readable window
const ownerOnlyMode = 0o600

const temporaryPathFor = (path: string): string =>
  join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)

// a state file's directory can carry secrets too, and a first run has no
// config directory yet: create it owner-only rather than making every caller
// mkdir before it can reach the guarded cycle
const ownerOnlyDirectoryMode = 0o700

/**
 * One filesystem call of the write path as an Effect. Every call the write
 * path makes goes through here, so a promise never crosses a seam as a
 * promise: the failure is typed where the call is made, rather than at some
 * later boundary that has to remember to catch it.
 */
const fileSystemCall = <A>(path: string, call: () => Promise<A>): Effect.Effect<A, CasFileStoreWriteFailure> =>
  Effect.tryPromise({ try: call, catch: () => casFileStoreWriteFailure(path) })

const writeDurable = (
  path: string,
  temporaryPath: string,
  contents: string
): Effect.Effect<void, CasFileStoreWriteFailure> =>
  fileSystemCall(path, () => mkdir(dirname(temporaryPath), { recursive: true, mode: ownerOnlyDirectoryMode })).pipe(
    Effect.zipRight(
      Effect.acquireUseRelease(
        fileSystemCall(path, () => open(temporaryPath, "w", ownerOnlyMode)),
        (handle) =>
          fileSystemCall(path, () => handle.writeFile(contents)).pipe(
            // fsync before the landing so a power loss cannot silently resurrect an older file
            Effect.zipRight(fileSystemCall(path, () => handle.sync()))
          ),
        (handle) => Effect.ignore(fileSystemCall(path, () => handle.close()))
      )
    )
  )

/**
 * How written contents reach the target path. It answers whether they got
 * there; only the create-if-absent landing can answer `false`.
 */
type Landing = (temporaryPath: string) => Effect.Effect<boolean, CasFileStoreWriteFailure>

/**
 * Durable write through a sibling tmp file: create owner-only, fsync, then let
 * `land` move it into place. Always on, never configurable — a crashed write
 * must never leave a torn state file that reads as corruption. Directory fsync
 * is skipped deliberately (ADR-0001).
 */
const writeThroughTemporary = (
  path: string,
  contents: string,
  land: Landing
): Effect.Effect<boolean, CasFileStoreWriteFailure> => {
  const temporaryPath = temporaryPathFor(path)

  return writeDurable(path, temporaryPath, contents).pipe(
    Effect.zipRight(land(temporaryPath)),
    // best-effort cleanup so no landing leaves tmp litter behind; a cleanup
    // that itself fails must not mask the write failure
    Effect.ensuring(Effect.ignore(fileSystemCall(path, () => rm(temporaryPath, { force: true }))))
  )
}

/** Replace an existing file atomically. */
const replaceRawAtomic = (path: string, contents: string): Effect.Effect<void, CasFileStoreWriteFailure> =>
  writeThroughTemporary(path, contents, (temporaryPath) =>
    fileSystemCall(path, () => rename(temporaryPath, path)).pipe(Effect.as(true))
  ).pipe(Effect.asVoid)

/**
 * Create a file only if it does not exist. `link` is what makes concurrent
 * creation safe: unlike `rename` it refuses to clobber, so the process that
 * loses a creation race learns it lost instead of silently overwriting the
 * winner.
 */
const createRawExclusive = (path: string, contents: string): Effect.Effect<boolean, CasFileStoreWriteFailure> =>
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

// One keyed semaphore per path serializes same-process `modify` calls, so
// fibers inside one process (the single-process MCP server — the dominant
// consumer — running a keepalive tick next to tool calls) cannot race by
// construction. The `StateFileLocks` service owns the table: no module-global
// mutable state, and idle locks are evicted so the table cannot grow forever.
// Cross-process safety comes from the CAS check alone; a lockfile was
// considered and rejected (ADR-0001).

/**
 * What a transform hands back to the engine on a write: the bytes to persist
 * alongside whatever value the caller wants reported, so a layer on top (the
 * Schema wrapper) never has to re-decode the bytes it just wrote.
 */
type WritePayload<W> = { readonly carried: W; readonly contents: string }

/**
 * What a transform hands back to the engine. A `keep` also reports a value:
 * the caller computed something while deciding not to write (an operation's
 * result), and it must travel back through the outcome channel rather than a
 * captured closure.
 */
type CycleStep<W, K> =
  | { readonly _tag: "write"; readonly payload: WritePayload<W> }
  | { readonly _tag: "keep"; readonly carried: K }

/**
 * The engine's outcome. `saved` and `dropped-conflict` carry the value the
 * transform produced alongside the bytes; `unchanged` carries the value it
 * produced while keeping the file. `dropped-conflict` additionally reports
 * the raw bytes that won, or `undefined` when the winner removed the file.
 */
export type CarryOutcome<W, K> =
  | { readonly _tag: "saved"; readonly carried: W }
  | { readonly _tag: "unchanged"; readonly carried: K }
  | { readonly _tag: "dropped-conflict"; readonly carried: W; readonly current: string | undefined }

/**
 * A single attempt's signal that the CAS token no longer matched at write
 * time. Deliberately not an `Error` subclass — it carries the file's raw
 * bytes, which can be secrets, and Effect pretty-prints the fields of a
 * failed `Error` in causes. It also carries the value the transform produced,
 * so a `dropped-conflict` outcome can still report it.
 */
class ConflictSignal<W> extends Data.TaggedClass("ConflictSignal")<{
  readonly carried: W
  readonly current: string | undefined
}> {}

const isConflictSignal = <W>(error: unknown): error is ConflictSignal<W> => error instanceof ConflictSignal

/**
 * The file existed when the cycle started: re-read it, and replace it only if
 * the CAS token still matches.
 */
const replaceIfUnchanged = <W, K>(
  path: string,
  base: string,
  payload: WritePayload<W>
): Effect.Effect<CarryOutcome<W, K>, CasFileStoreWriteFailure | CasFileStoreReadFailure | ConflictSignal<W>> =>
  Effect.gen(function* () {
    const current = yield* readOptionalRaw(path)

    if (current !== base) {
      return yield* Effect.fail(new ConflictSignal({ carried: payload.carried, current }))
    }

    yield* replaceRawAtomic(path, payload.contents)

    return { _tag: "saved", carried: payload.carried }
  })

/**
 * The file was absent when the cycle started: the exclusive create *is* the CAS
 * check. A re-read before it would only widen the window — `link` refuses to
 * clobber, so a process that lost a creation race finds out at the write itself.
 */
const createIfAbsent = <W, K>(
  path: string,
  payload: WritePayload<W>
): Effect.Effect<CarryOutcome<W, K>, CasFileStoreWriteFailure | CasFileStoreReadFailure | ConflictSignal<W>> =>
  Effect.gen(function* () {
    const created = yield* createRawExclusive(path, payload.contents)

    if (created) {
      return { _tag: "saved", carried: payload.carried }
    }

    return yield* Effect.fail(new ConflictSignal({ carried: payload.carried, current: yield* readOptionalRaw(path) }))
  })

const readModifyWrite = <W, K, E, R>(
  path: string,
  f: (contents: string | undefined) => Effect.Effect<CycleStep<W, K>, E, R>
): Effect.Effect<CarryOutcome<W, K>, CasFileStoreReadFailure | CasFileStoreWriteFailure | ConflictSignal<W> | E, R> =>
  Effect.gen(function* () {
    // The CAS token is the raw file bytes as read — or the file's absence, which
    // is just as much a state another process can move on from. Comparison never
    // goes through a decoded/re-encoded value, so non-canonical serialization
    // cannot cause phantom conflicts.
    const base = yield* readOptionalRaw(path)
    const step = yield* f(base)

    if (step._tag === "keep") {
      return { _tag: "unchanged", carried: step.carried }
    }

    // The CAS check through the write is uninterruptible: the underlying write
    // promise cannot be aborted, so an interruptible fiber would exit while its
    // rename is still in flight, release the permit, and let that zombie rename
    // land on top of a later writer.
    return yield* Effect.uninterruptible(
      base === undefined ? createIfAbsent<W, K>(path, step.payload) : replaceIfUnchanged<W, K>(path, base, step.payload)
    )
  })

/**
 * The read-modify-write engine, shared by the byte-level `modify` and the
 * Schema wrapper. Not part of the package's public surface.
 */
export const modifyCarrying = <W, K, E, R>(
  path: StateFilePath,
  f: (contents: string | undefined) => Effect.Effect<CycleStep<W, K>, E, R>,
  policy: ConflictPolicy
): Effect.Effect<
  CarryOutcome<W, K>,
  CasFileStoreReadFailure | CasFileStoreWriteFailure | ConflictExhausted | E,
  R | StateFileLocks
> => {
  // The permit is held per attempt, not across the whole policy: a retry
  // schedule's delay must not block every other in-process caller on this
  // path. The key is the resolved path, so `dir//state.json`,
  // `dir/state.json` and a relative spelling of one file share one lock.
  const attempt = Effect.flatMap(StateFileLocks, (locks) => locks.withPermit(resolve(path), readModifyWrite(path, f)))

  if (policy._tag === "drop") {
    return attempt.pipe(
      Effect.catchIf(isConflictSignal, (signal: ConflictSignal<W>) =>
        Effect.succeed<CarryOutcome<W, K>>({
          _tag: "dropped-conflict",
          carried: signal.carried,
          current: signal.current
        })
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
 * on the raw contents (or `undefined` when the file does not exist yet),
 * compare the CAS token, and write back atomically only if the file has not
 * changed. Same-process calls per path are serialized; cross-process conflicts
 * resolve per `policy` (default: drop).
 */
export const modify = <E = never, R = never>(
  path: StateFilePath,
  f: (contents: string | undefined) => Effect.Effect<WriteDecision<string>, E, R>,
  policy: ConflictPolicy = dropPolicy
): Effect.Effect<
  ModifyOutcome<string>,
  CasFileStoreReadFailure | CasFileStoreWriteFailure | ConflictExhausted | E,
  R | StateFileLocks
> =>
  modifyCarrying<string, undefined, E, R>(
    path,
    (contents) =>
      f(contents).pipe(
        Effect.map(
          (decision): CycleStep<string, undefined> =>
            decision._tag === "keep"
              ? { _tag: "keep", carried: undefined }
              : { _tag: "write", payload: { carried: decision.value, contents: decision.value } }
        )
      ),
    policy
  ).pipe(
    Effect.map((outcome) =>
      outcome._tag === "saved"
        ? { _tag: "saved", value: outcome.carried }
        : outcome._tag === "unchanged"
          ? { _tag: "unchanged" }
          : { _tag: "dropped-conflict", value: outcome.current }
    )
  )
