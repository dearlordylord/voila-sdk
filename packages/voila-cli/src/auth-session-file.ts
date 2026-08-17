/**
 * How an interactive login reaches disk: through the same guarded update cycle
 * as every other session write, including the first one, when there is no file
 * yet.
 */
import type { SdkSessionSnapshot } from "@firfi/voila-sdk"
import {
  persistSession,
  type SessionFileError,
  type StateFileLocks,
  type StateFilePath,
  updateSessionFile
} from "@firfi/voila-session-store"
import { Effect } from "effect"

export type LoginSessionSuperseded = { readonly _tag: "VoilaAuthSessionSuperseded"; readonly message: string }

export type LoginSessionWriteError = SessionFileError | LoginSessionSuperseded

const loginSessionSuperseded = (): LoginSessionSuperseded => ({
  _tag: "VoilaAuthSessionSuperseded",
  message: "Another process wrote a newer session while this login was being saved"
})

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
    updateSessionFile(path, () => Effect.succeed(persistSession(snapshot))),
    (outcome) => (outcome._tag === "dropped-conflict" ? Effect.fail(loginSessionSuperseded()) : Effect.void)
  )
