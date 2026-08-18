import { Effect, Schema } from "effect"
import { isAbsolute } from "node:path"

import { PathInvalidError } from "./atomic-file-store-errors.js"

const isStateFilePath = (value: string): boolean => value.trim().length > 0 && isAbsolute(value)

export const StateFilePathSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isStateFilePath, { message: "must be a non-empty absolute path" })),
  Schema.brand("StateFilePath")
)

export type StateFilePath = Schema.Schema.Type<typeof StateFilePathSchema>

export const parseStateFilePath = (value: unknown): Effect.Effect<StateFilePath, PathInvalidError> =>
  Schema.decodeUnknownEffect(StateFilePathSchema)(value).pipe(Effect.mapError(() => new PathInvalidError()))
