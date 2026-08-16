/**
 * Schema-aware convenience wrapper over the byte-level core. The repo rule is
 * "Schema owns file boundaries"; this module enforces it inside the package
 * rather than by caller discipline. The CAS comparison still happens on raw
 * bytes inside the core — this wrapper never re-encodes for comparison, so
 * non-canonical serialization cannot cause phantom conflicts.
 */
import { Effect, Schema } from "effect"

import {
  type CasFileStoreContentsInvalid,
  type CasFileStoreError,
  type CarryOutcome,
  type ConflictExhausted,
  type ConflictPolicy,
  dropPolicy,
  modifyCarrying,
  type ModifyOutcome
} from "./cas-file-store.js"

const casFileStoreContentsInvalid = (path: string): CasFileStoreContentsInvalid => ({
  _tag: "CasFileStoreContentsInvalid",
  // never echo file contents or parse details into the message: state files
  // can carry secrets (cookies, tokens)
  message: `State file contents do not match the schema: ${path}`
})

const savedOutcome = <A>(value: A): ModifyOutcome<A> => ({ _tag: "saved", value })

const droppedConflictOutcome = <A>(value: A): ModifyOutcome<A> => ({ _tag: "dropped-conflict", value })

/**
 * Like `modify`, but `f` receives and returns a decoded value. The file is
 * decoded as JSON via the schema before `f` runs and the result is encoded
 * back for the write. On `saved` the outcome carries the value `f` produced; on
 * `dropped-conflict` it carries the fresh value another process wrote, decoded
 * and ready to adopt.
 */
export const modifySchema = <A, I, RSchema, E = never, R = never>(
  path: string,
  schema: Schema.Schema<A, I, RSchema>,
  f: (value: A) => Effect.Effect<A, E, R>,
  policy: ConflictPolicy = dropPolicy
): Effect.Effect<ModifyOutcome<A>, CasFileStoreError | ConflictExhausted | E, R | RSchema> => {
  const jsonSchema = Schema.parseJson(schema)
  const decode = Schema.decodeUnknown(jsonSchema)
  const encode = Schema.encode(jsonSchema)

  // The engine carries the value `f` produced through to the outcome: decoding
  // the bytes we just wrote would fail for any schema that does not round-trip,
  // and only after the write had already landed.
  const transform = (
    contents: string
  ): Effect.Effect<readonly [string, A], CasFileStoreContentsInvalid | E, R | RSchema> =>
    Effect.gen(function* () {
      const decoded = yield* decode(contents).pipe(Effect.mapError(() => casFileStoreContentsInvalid(path)))
      const next = yield* f(decoded)
      const encoded = yield* encode(next).pipe(Effect.mapError(() => casFileStoreContentsInvalid(path)))

      return [encoded, next] as const
    })

  return modifyCarrying(path, transform, policy).pipe(
    Effect.flatMap((outcome: CarryOutcome<A>) =>
      outcome._tag === "saved"
        ? Effect.succeed(savedOutcome(outcome.carried))
        : // the fresh bytes are another writer's: they must be decoded to be adopted
          decode(outcome.current).pipe(
            Effect.mapError(() => casFileStoreContentsInvalid(path)),
            Effect.map(droppedConflictOutcome)
          )
    )
  )
}
