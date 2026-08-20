/**
 * How an interactive login reaches disk: through the same guarded update cycle
 * as every other session write, including the first one, when there is no file
 * yet.
 */
import { type SessionHealth } from "@firfi/voila-sdk"
import {
  keepSessionFile,
  persistSession,
  type SessionFileCarriedOutcome,
  type SessionFileError,
  type StateFileLocks,
  type StateFilePath,
  updateSessionFileCarrying
} from "@firfi/voila-session-store"
import { Effect, Match } from "effect"

type LoginSessionSuperseded = { readonly _tag: "VoilaAuthSessionSuperseded"; readonly message: string }

export type LoginSessionWriteError = SessionFileError | LoginSessionSuperseded

const loginSessionSuperseded = (): LoginSessionSuperseded => ({
  _tag: "VoilaAuthSessionSuperseded",
  message: "Another process wrote a newer session while this login was being saved"
})

/**
 * Validate a browser capture while the session file's guarded cycle is open.
 * Only an active validated snapshot is persisted; inactive captures leave the
 * existing file untouched, and a concurrent write wins the cycle.
 */
export const persistValidatedLoginSession = <E, R>(
  path: StateFilePath,
  validation: Effect.Effect<SessionHealth, E, R>
): Effect.Effect<SessionHealth, LoginSessionWriteError | E, StateFileLocks | R> =>
  Effect.flatMap(
    updateSessionFileCarrying(path, () =>
      Effect.map(validation, (health) => ({
        carried: health,
        update: health.status === "active" ? persistSession(health.session) : keepSessionFile
      }))
    ),
    (outcome: SessionFileCarriedOutcome<SessionHealth>) =>
      Match.typeTags<SessionFileCarriedOutcome<SessionHealth>>()({
        saved: ({ carried }) => Effect.succeed(carried),
        unchanged: ({ carried }) => Effect.succeed(carried),
        "dropped-conflict": () => Effect.fail(loginSessionSuperseded())
      })(outcome)
  )
