/**
 * The store's one boundary type: which file a cycle acts on.
 *
 * A bare `string` lets any string reach a call that writes state, and lets a
 * relative path mean different files in two processes with different working
 * directories — the exact ambiguity a store shared by several local processes
 * cannot afford. Callers parse once, at the edge where the path is configured.
 */
import { Effect, Schema } from "effect"
import { isAbsolute } from "node:path"

/** The configured path is not usable as a state file path. */
export type CasFileStorePathInvalid = { readonly _tag: "CasFileStorePathInvalid"; readonly message: string }

const isStateFilePath = (value: string): boolean => value.trim().length > 0 && isAbsolute(value)

export const StateFilePathSchema = Schema.String.pipe(
  Schema.filter(isStateFilePath, { message: () => "must be a non-empty absolute path" }),
  Schema.brand("StateFilePath")
)

export type StateFilePath = Schema.Schema.Type<typeof StateFilePathSchema>

const casFileStorePathInvalid = (): CasFileStorePathInvalid => ({
  _tag: "CasFileStorePathInvalid",
  // the path itself stays out of the message: a configured path can name a
  // user, a machine, or a profile
  message: "State file path must be a non-empty absolute path"
})

/** Turn a configured path into a `StateFilePath`, or fail with a typed error. */
export const parseStateFilePath = (value: unknown): Effect.Effect<StateFilePath, CasFileStorePathInvalid> =>
  Schema.decodeUnknown(StateFilePathSchema)(value).pipe(Effect.mapError(casFileStorePathInvalid))
