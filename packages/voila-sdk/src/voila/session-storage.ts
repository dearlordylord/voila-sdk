/**
 * Reading a session snapshot from storage.
 *
 * There is no write half: a snapshot reaches disk only through the session file
 * store's guarded read-modify-write cycle, which owns the read and the write
 * together. A write primitive here would be a blind write by another name — the
 * one that lets a snapshot loaded at boot land on top of a fresh interactive
 * login.
 */
import { Either } from "effect"

import { parseJson, parseUnknown } from "../domain/parse.js"
import { type SdkSessionSnapshot, SdkSessionSnapshotSchema } from "../domain/schemas/index.js"

export interface SessionStoragePort {
  readonly read: () => Promise<unknown>
}

export type SessionStorageError =
  | { readonly _tag: "SessionStorageReadFailure"; readonly message: string }
  | { readonly _tag: "SessionStorageContentsInvalid"; readonly message: string }

const sessionStorageReadFailure = (): SessionStorageError => ({
  _tag: "SessionStorageReadFailure",
  message: "Session snapshot could not be read"
})

const sessionStorageContentsInvalid = (): SessionStorageError => ({
  _tag: "SessionStorageContentsInvalid",
  message: "Stored session snapshot is corrupt or stale"
})

export const loadSdkSessionSnapshot = async (
  storage: SessionStoragePort
): Promise<Either.Either<SdkSessionSnapshot, SessionStorageError>> => {
  let contents: unknown

  try {
    contents = await storage.read()
  } catch {
    return Either.left(sessionStorageReadFailure())
  }

  if (typeof contents !== "string") {
    return Either.left(sessionStorageContentsInvalid())
  }

  const parsed = Either.mapLeft(parseJson(contents), sessionStorageContentsInvalid)

  if (Either.isLeft(parsed)) {
    return Either.left(parsed.left)
  }

  return Either.mapLeft(parseUnknown(SdkSessionSnapshotSchema, parsed.right), sessionStorageContentsInvalid)
}
