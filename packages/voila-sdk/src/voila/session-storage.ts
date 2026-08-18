/**
 * Reading a session snapshot from storage.
 *
 * There is no write half: a snapshot reaches disk only through the session file
 * store's guarded read-modify-write cycle, which owns the read and the write
 * together. A write primitive here would be a blind write by another name — the
 * one that lets a snapshot loaded at boot land on top of a fresh interactive
 * login.
 */
import { Effect, Result } from "effect"

import { parseJson, parseUnknown } from "../domain/parse.js"
import { type SdkSessionSnapshot, SdkSessionSnapshotSchema } from "../domain/schemas/index.js"

export interface SessionStoragePort {
  readonly read: () => Effect.Effect<unknown, SessionStorageError>
}

export type SessionStorageError =
  | { readonly _tag: "SessionStorageReadFailure"; readonly message: string }
  | { readonly _tag: "SessionStorageContentsInvalid"; readonly message: string }

/**
 * What a storage adapter reports when the read itself did not happen. Exported
 * because the adapter owns the read and must name the failure in the SDK's
 * vocabulary rather than leak a platform error.
 */
export const sessionStorageReadFailure = (): SessionStorageError => ({
  _tag: "SessionStorageReadFailure",
  message: "Session snapshot could not be read"
})

const sessionStorageContentsInvalid = (): SessionStorageError => ({
  _tag: "SessionStorageContentsInvalid",
  message: "Stored session snapshot is corrupt or stale"
})

const decodeStoredSnapshot = (contents: unknown): Result.Result<SdkSessionSnapshot, SessionStorageError> => {
  if (typeof contents !== "string") {
    return Result.fail(sessionStorageContentsInvalid())
  }

  return Result.flatMap(Result.mapError(parseJson(contents), sessionStorageContentsInvalid), (parsed) =>
    Result.mapError(parseUnknown(SdkSessionSnapshotSchema, parsed), sessionStorageContentsInvalid)
  )
}

export const loadSdkSessionSnapshot = (
  storage: SessionStoragePort
): Effect.Effect<SdkSessionSnapshot, SessionStorageError> =>
  Effect.flatMap(storage.read(), (contents) => Effect.fromResult(decodeStoredSnapshot(contents)))
