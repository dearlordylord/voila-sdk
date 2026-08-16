/**
 * Schema-aware convenience wrapper over the byte-level core. The repo rule is
 * "Schema owns file boundaries"; this module enforces it inside the package
 * rather than by caller discipline. The CAS comparison still happens on raw
 * bytes inside the core — this wrapper never re-encodes for comparison, so
 * non-canonical serialization cannot cause phantom conflicts.
 */
import { Effect, Schema } from "effect"

import {
  type CarryOutcome,
  type CasFileStoreContentsInvalid,
  type CasFileStoreError,
  type ConflictExhausted,
  type ConflictPolicy,
  dropPolicy,
  keep,
  modifyCarrying,
  type ModifyOutcome,
  persist,
  type WriteDecision
} from "./cas-file-store.js"

const casFileStoreContentsInvalid = (path: string): CasFileStoreContentsInvalid => ({
  _tag: "CasFileStoreContentsInvalid",
  // never echo file contents or parse details into the message: state files
  // can carry secrets (cookies, tokens)
  message: `State file contents do not match the schema: ${path}`
})

/**
 * Like `modify`, but `f` receives and returns a decoded value. The file is
 * decoded as JSON via the schema before `f` runs — or `f` sees `undefined` when
 * the file does not exist yet — and the result is encoded back for the write.
 * On `saved` the outcome carries the value `f` produced; on `dropped-conflict`
 * it carries the fresh value another process wrote, decoded and ready to adopt.
 */
export const modifySchema = <A, I, RSchema, E = never, R = never>(
  path: string,
  schema: Schema.Schema<A, I, RSchema>,
  f: (value: A | undefined) => Effect.Effect<WriteDecision<A>, E, R>,
  policy: ConflictPolicy = dropPolicy
): Effect.Effect<ModifyOutcome<A>, CasFileStoreError | ConflictExhausted | E, R | RSchema> => {
  const jsonSchema = Schema.parseJson(schema)
  const decode = (contents: string): Effect.Effect<A, CasFileStoreContentsInvalid, RSchema> =>
    Schema.decodeUnknown(jsonSchema)(contents).pipe(Effect.mapError(() => casFileStoreContentsInvalid(path)))
  const encode = (value: A): Effect.Effect<string, CasFileStoreContentsInvalid, RSchema> =>
    Schema.encode(jsonSchema)(value).pipe(Effect.mapError(() => casFileStoreContentsInvalid(path)))

  // The engine carries the value `f` produced through to the outcome: decoding
  // the bytes we just wrote would fail for any schema that does not round-trip,
  // and only after the write had already landed.
  const transform = (contents: string | undefined) =>
    Effect.gen(function* () {
      const current = contents === undefined ? undefined : yield* decode(contents)
      const decision = yield* f(current)

      if (decision._tag === "keep") {
        return keep
      }

      return persist({ carried: decision.value, contents: yield* encode(decision.value) })
    })

  const adopt = (outcome: CarryOutcome<A>): Effect.Effect<ModifyOutcome<A>, CasFileStoreContentsInvalid, RSchema> => {
    if (outcome._tag === "saved") {
      return Effect.succeed({ _tag: "saved", value: outcome.carried })
    }

    if (outcome._tag === "unchanged") {
      return Effect.succeed({ _tag: "unchanged" })
    }

    // the fresh bytes are another writer's: they must be decoded to be adopted
    return outcome.current === undefined
      ? Effect.succeed({ _tag: "dropped-conflict", value: undefined })
      : decode(outcome.current).pipe(Effect.map((value) => ({ _tag: "dropped-conflict", value })))
  }

  return modifyCarrying(path, transform, policy).pipe(Effect.flatMap(adopt))
}
