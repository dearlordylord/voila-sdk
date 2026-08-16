/**
 * The only way a session snapshot reaches disk.
 *
 * `updateSessionFile` owns the whole cycle: it reads the snapshot as it exists
 * on disk right now, runs the caller's transform against it (or against its
 * absence), and persists the result only if nothing else wrote in between.
 * There is no `save`, `write`, or `initialize` entry point beside it, so a
 * snapshot loaded at boot cannot be written back over a fresh interactive
 * login — the failure this package exists to prevent.
 *
 * Two rules live here rather than in the generic store: creation is part of the
 * same guarded cycle, and a guest snapshot never replaces an authenticated one
 * (a guest session costs one request to rebuild; an authenticated one costs an
 * interactive browser login).
 */
import {
  keep,
  modifySchema,
  type ModifyOutcome,
  persist,
  type StateFilePath,
  type WriteDecision
} from "@firfi/cas-file-store"
import { type SdkSessionSnapshot, SdkSessionSnapshotSchema } from "@firfi/voila-sdk"
import { Effect } from "effect"

import {
  callerFailure,
  guestOverwriteRefused,
  type SessionFileError,
  type SessionFileGuestOverwriteRefused,
  unwrapFailure
} from "./session-file-errors.js"

/**
 * What a caller decided after seeing the snapshot on disk. `keepSessionFile`
 * leaves the file exactly as it is; whether a session in a failure state is
 * worth persisting is the caller's judgement, not this module's.
 *
 * The store has a decision type of its own, and this one deliberately does not
 * alias it: callers of this package work in snapshots and speak session
 * vocabulary, and the store underneath stays replaceable.
 */
export type SessionFileUpdate =
  | { readonly _tag: "persist"; readonly session: SdkSessionSnapshot }
  | { readonly _tag: "keep" }

export const persistSession = (session: SdkSessionSnapshot): SessionFileUpdate => ({ _tag: "persist", session })

export const keepSessionFile: SessionFileUpdate = { _tag: "keep" }

/**
 * How the update settled. `dropped-conflict` is a normal outcome, not an
 * error: a background refresh that loses to a fresh login did its job, and the
 * snapshot that won comes back so the caller can adopt it instead of
 * restarting. It is `undefined` only when the winner removed the file.
 */
export type SessionFileUpdateOutcome =
  | { readonly _tag: "saved"; readonly session: SdkSessionSnapshot }
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "dropped-conflict"; readonly session: SdkSessionSnapshot | undefined }

/**
 * An authenticated session on disk is never replaced by a guest one. The check
 * runs against the snapshot read in this cycle, and the CAS comparison covers
 * an authenticated snapshot that arrives later in the same cycle.
 */
export const isGuestDowngrade = (current: SdkSessionSnapshot | undefined, next: SdkSessionSnapshot): boolean =>
  current?.kind === "authenticated" && next.kind === "guest"

const decide = (
  current: SdkSessionSnapshot | undefined,
  update: SessionFileUpdate
): Effect.Effect<WriteDecision<SdkSessionSnapshot>, SessionFileGuestOverwriteRefused> => {
  if (update._tag === "keep") {
    return Effect.succeed(keep)
  }

  return isGuestDowngrade(current, update.session)
    ? Effect.fail(guestOverwriteRefused)
    : Effect.succeed(persist(update.session))
}

const toOutcome = (outcome: ModifyOutcome<SdkSessionSnapshot>): SessionFileUpdateOutcome => {
  if (outcome._tag === "saved") {
    return { _tag: "saved", session: outcome.value }
  }

  return outcome._tag === "unchanged" ? { _tag: "unchanged" } : { _tag: "dropped-conflict", session: outcome.value }
}

/**
 * Update the session file at `path` by running `update` against the snapshot as
 * it exists on disk right now — `undefined` when the file does not exist yet,
 * in which case the file and its directory are created inside the same guarded
 * cycle, owner-only.
 *
 * The path is a `StateFilePath`, parsed once where it is configured: a bare
 * string would let a relative path name different files in two processes.
 *
 * `update` is an arbitrary effect: it may perform network I/O (folding
 * `Set-Cookie` from a live response into the snapshot it returns) and fail with
 * its own typed errors, which surface unchanged. The whole read-decide-write
 * window is covered by the conflict check, not just the final write.
 */
export const updateSessionFile = <E = never, R = never>(
  path: StateFilePath,
  update: (current: SdkSessionSnapshot | undefined) => Effect.Effect<SessionFileUpdate, E, R>
): Effect.Effect<SessionFileUpdateOutcome, SessionFileError | E, R> =>
  modifySchema(path, SdkSessionSnapshotSchema, (current) =>
    update(current).pipe(
      Effect.mapError(callerFailure),
      Effect.flatMap((decision) => decide(current, decision))
    )
  ).pipe(Effect.map(toOutcome), Effect.catchAll(unwrapFailure))
