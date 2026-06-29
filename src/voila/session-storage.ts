import { Either, Schema } from "effect"

import { parseJson, parseUnknown } from "../domain/parse.js"
import { type SdkSessionSnapshot, SdkSessionSnapshotSchema } from "../domain/schemas/index.js"

export interface SessionStoragePort {
  readonly read: () => Promise<unknown>
  readonly write: (contents: string) => Promise<unknown>
}

export type SessionStorageError =
  | {
    readonly _tag: "SessionStorageSnapshotInvalid"
    readonly message: string
  }
  | {
    readonly _tag: "SessionStorageWriteFailure"
    readonly message: string
  }
  | {
    readonly _tag: "SessionStorageReadFailure"
    readonly message: string
  }
  | {
    readonly _tag: "SessionStorageContentsInvalid"
    readonly message: string
  }

const sessionStorageSnapshotInvalid = (): SessionStorageError => ({
  _tag: "SessionStorageSnapshotInvalid",
  message: "Session snapshot does not match the SDK schema"
})

const sessionStorageWriteFailure = (): SessionStorageError => ({
  _tag: "SessionStorageWriteFailure",
  message: "Session snapshot could not be written"
})

const sessionStorageReadFailure = (): SessionStorageError => ({
  _tag: "SessionStorageReadFailure",
  message: "Session snapshot could not be read"
})

const sessionStorageContentsInvalid = (): SessionStorageError => ({
  _tag: "SessionStorageContentsInvalid",
  message: "Stored session snapshot is corrupt or stale"
})

export const saveSdkSessionSnapshot = async (
  storage: SessionStoragePort,
  snapshot: unknown
): Promise<Either.Either<undefined, SessionStorageError>> => {
  const decoded = Either.mapLeft(
    parseUnknown(SdkSessionSnapshotSchema, snapshot),
    sessionStorageSnapshotInvalid
  )

  if (Either.isLeft(decoded)) {
    return Either.left(decoded.left)
  }

  const encoded = Either.mapLeft(
    Schema.encodeEither(SdkSessionSnapshotSchema)(decoded.right),
    sessionStorageSnapshotInvalid
  )

  if (Either.isLeft(encoded)) {
    return Either.left(encoded.left)
  }

  try {
    await storage.write(JSON.stringify(encoded.right))

    return Either.right(undefined)
  } catch {
    return Either.left(sessionStorageWriteFailure())
  }
}

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

  return Either.mapLeft(
    parseUnknown(SdkSessionSnapshotSchema, parsed.right),
    sessionStorageContentsInvalid
  )
}
