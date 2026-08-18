/**
 * The session domain's failure taxonomy, and the translation of the store's
 * failures into it.
 *
 * The session types are not aliases of the store's: a session file's contents
 * are cookies and a CSRF token, so every message here is a fixed string that
 * names neither the contents nor the path, and callers depend on session
 * vocabulary rather than on the store this package happens to be built on.
 */
import type { ConflictExhausted, ContentsInvalidError, ReadError, WriteError } from "./atomic-file-store-errors.js"
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

/**
 * Everything the cycle can fail with: the store's own failures — the error
 * channel of `modifySchemaCarrying`, restated here because the package exports
 * no union of its own — plus this package's one session rule.
 */
type StoreFailure = ReadError | WriteError | ContentsInvalidError | ConflictExhausted | SessionFileGuestOverwriteRefused

type SessionFileErrorByTag = {
  readonly [Tag in StoreFailure["_tag"]]: Tag extends "ConflictExhausted" | "WriteError"
    ? SessionFileWriteFailure
    : Tag extends "ContentsInvalidError"
      ? SessionFileContentsInvalid
      : Tag extends "ReadError"
        ? SessionFileReadFailure
        : SessionFileGuestOverwriteRefused
}

// keyed by every tag in `StoreFailure`, so a tag this package stops handling
// fails at this declaration rather than at the lookup below
const sessionFileErrorByTag: SessionFileErrorByTag = {
  // unreachable while every session write drops on conflict; mapped so adding
  // a retrying caller cannot turn contention into an unhandled error shape
  ConflictExhausted: { _tag: "SessionFileWriteFailure", message: "Session snapshot could not be written" },
  // covers both directions: contents on disk that are not a session snapshot,
  // and a snapshot the caller produced that cannot be encoded as one
  ContentsInvalidError: {
    _tag: "SessionFileContentsInvalid",
    message: "Session snapshot does not match the SDK session schema"
  },
  ReadError: { _tag: "SessionFileReadFailure", message: "Session snapshot could not be read" },
  SessionFileGuestOverwriteRefused: {
    _tag: "SessionFileGuestOverwriteRefused",
    message: "A guest session snapshot must not replace an authenticated one"
  },
  WriteError: { _tag: "SessionFileWriteFailure", message: "Session snapshot could not be written" }
}

export const guestOverwriteRefused: SessionFileGuestOverwriteRefused =
  sessionFileErrorByTag.SessionFileGuestOverwriteRefused

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
