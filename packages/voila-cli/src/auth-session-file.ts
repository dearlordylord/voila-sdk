/**
 * How an interactive login reaches disk: through the same guarded update cycle
 * as every other session write, including the first one, when there is no file
 * yet.
 */
import { SdkSessionSnapshotSchema, type SdkSessionSnapshot } from "@firfi/voila-sdk"
import {
  keepSessionFile,
  persistSession,
  type SessionFileError,
  type SessionFileUpdateOutcome,
  type StateFileLocks,
  type StateFilePath,
  updateSessionFile
} from "@firfi/voila-session-store"
import { Effect, Match, Schema } from "effect"

export type LoginSessionSuperseded = { readonly _tag: "VoilaAuthSessionSuperseded"; readonly message: string }

export type LoginSessionWriteError = SessionFileError | LoginSessionSuperseded

const loginSessionSuperseded = (): LoginSessionSuperseded => ({
  _tag: "VoilaAuthSessionSuperseded",
  message: "Another process wrote a newer session while this login was being saved"
})

const encodedSession = (snapshot: SdkSessionSnapshot): string =>
  JSON.stringify(Schema.encodeSync(SdkSessionSnapshotSchema)(snapshot))

const isSameSession = (current: SdkSessionSnapshot | undefined, next: SdkSessionSnapshot): boolean =>
  current !== undefined && encodedSession(current) === encodedSession(next)

/**
 * A fresh interactive login is the newest lineage there is, so it persists over
 * whatever the cycle finds on disk. A dropped write means something newer won
 * the file while the login was being saved; retrying this snapshot on top of it
 * would be the revert this whole path exists to prevent, so the drop is
 * reported instead.
 */
export const persistLoginSession = (
  path: StateFilePath,
  snapshot: SdkSessionSnapshot
): Effect.Effect<void, LoginSessionWriteError, StateFileLocks> =>
  Effect.flatMap(
    updateSessionFile(path, (current) =>
      Effect.succeed(isSameSession(current, snapshot) ? keepSessionFile : persistSession(snapshot))
    ),
    (outcome: SessionFileUpdateOutcome) =>
      Match.typeTags<SessionFileUpdateOutcome>()({
        saved: () => Effect.void,
        unchanged: () => Effect.void,
        "dropped-conflict": () => Effect.fail(loginSessionSuperseded())
      })(outcome)
  )

/**
 * Persist the health-checked snapshot only when the snapshot that was checked
 * is still the one on disk. A session written while the health request was in
 * flight is newer than this login and must not be overwritten by its result.
 */
export const persistLoginSessionIfUnchanged = (
  path: StateFilePath,
  expected: SdkSessionSnapshot,
  snapshot: SdkSessionSnapshot
): Effect.Effect<void, LoginSessionWriteError, StateFileLocks> =>
  Effect.flatMap(
    updateSessionFile(path, (current) =>
      isSameSession(current, expected)
        ? Effect.succeed(isSameSession(current, snapshot) ? keepSessionFile : persistSession(snapshot))
        : Effect.fail(loginSessionSuperseded())
    ),
    (outcome: SessionFileUpdateOutcome) =>
      Match.typeTags<SessionFileUpdateOutcome>()({
        saved: () => Effect.void,
        unchanged: () => Effect.void,
        "dropped-conflict": () => Effect.fail(loginSessionSuperseded())
      })(outcome)
  )
