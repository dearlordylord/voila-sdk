/**
 * The session domain's failure taxonomy, and the translation of the store's
 * failures into it.
 *
 * The session types are not aliases of the store's: a session file's contents
 * are cookies and a CSRF token, so every message here is a fixed string that
 * names neither the contents nor the path, and callers depend on session
 * vocabulary rather than on the store this package happens to be built on.
 */
import type { CasFileStoreError, ConflictExhausted } from "@firfi/cas-file-store"
import { Effect } from "effect"

export type SessionFileReadFailure = { readonly _tag: "SessionFileReadFailure"; readonly message: string }

export type SessionFileWriteFailure = { readonly _tag: "SessionFileWriteFailure"; readonly message: string }

export type SessionFileContentsInvalid = { readonly _tag: "SessionFileContentsInvalid"; readonly message: string }

export type SessionFileGuestOverwriteRefused = {
  readonly _tag: "SessionFileGuestOverwriteRefused"
  readonly message: string
}

export type SessionFileError =
  | SessionFileReadFailure
  | SessionFileWriteFailure
  | SessionFileContentsInvalid
  | SessionFileGuestOverwriteRefused

const sessionFileErrorByTag = {
  // covers both directions: contents on disk that are not a session snapshot,
  // and a snapshot the caller produced that cannot be encoded as one
  CasFileStoreContentsInvalid: {
    _tag: "SessionFileContentsInvalid",
    message: "Session snapshot does not match the SDK session schema"
  },
  CasFileStoreReadFailure: { _tag: "SessionFileReadFailure", message: "Session snapshot could not be read" },
  CasFileStoreWriteFailure: { _tag: "SessionFileWriteFailure", message: "Session snapshot could not be written" },
  // unreachable while every session write drops on conflict; mapped so adding
  // a retrying caller cannot turn contention into an unhandled error shape
  ConflictExhausted: { _tag: "SessionFileWriteFailure", message: "Session snapshot could not be written" },
  SessionFileGuestOverwriteRefused: {
    _tag: "SessionFileGuestOverwriteRefused",
    message: "A guest session snapshot must not replace an authenticated one"
  }
} as const satisfies Record<string, SessionFileError>

export const guestOverwriteRefused: SessionFileGuestOverwriteRefused =
  sessionFileErrorByTag.SessionFileGuestOverwriteRefused

type StoreFailure = CasFileStoreError | ConflictExhausted | SessionFileGuestOverwriteRefused

// The caller's own failures are wrapped for the trip through the store so they
// cannot be confused with a store failure, and are unwrapped unchanged at the
// end: an update that performs network I/O keeps its own typed errors.
type CallerFailure<E> = { readonly _tag: "SessionFileCallerFailure"; readonly cause: E }

export const callerFailure = <E>(cause: E): CallerFailure<E> => ({ _tag: "SessionFileCallerFailure", cause })

const isCallerFailure = <E>(error: StoreFailure | CallerFailure<E>): error is CallerFailure<E> =>
  error._tag === "SessionFileCallerFailure"

/** Restate a failure from the cycle in session terms, keeping the caller's own errors intact. */
export const unwrapFailure = <E>(error: StoreFailure | CallerFailure<E>): Effect.Effect<never, SessionFileError | E> =>
  isCallerFailure(error) ? Effect.fail(error.cause) : Effect.fail(sessionFileErrorByTag[error._tag])
