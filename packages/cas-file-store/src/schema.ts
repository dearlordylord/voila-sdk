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
  modifyCarrying,
  type ModifyOutcome,
  type WriteDecision
} from "./cas-file-store.js"
import type { StateFilePath } from "./state-file-path.js"
import type { StateFileLocks } from "./state-file-locks.js"

const casFileStoreContentsInvalid = (path: string): CasFileStoreContentsInvalid => ({
  _tag: "CasFileStoreContentsInvalid",
  // never echo file contents or parse details into the message: state files
  // can carry secrets (cookies, tokens)
  message: `State file contents do not match the schema: ${path}`
})

/**
 * What the transform of `modifySchemaCarrying` reports: the write decision
 * alongside whatever value the caller wants back — an operation's result,
 * computed while deciding. The value travels through the outcome channel on
 * every outcome, including `unchanged` and `dropped-conflict`.
 */
export interface SchemaCycleStep<A, C> {
  readonly carried: C
  readonly decision: WriteDecision<A>
}

/**
 * Like `ModifyOutcome`, but every variant also reports the transform's
 * carried value. `value` is the state the call settled on: the value written
 * on `saved`, or the fresh value another process wrote on `dropped-conflict`
 * (`undefined` when the winner removed the file).
 */
export type CarriedModifyOutcome<A, C> =
  | { readonly _tag: "saved"; readonly carried: C; readonly value: A }
  | { readonly _tag: "unchanged"; readonly carried: C }
  | { readonly _tag: "dropped-conflict"; readonly carried: C; readonly value: A | undefined }

/**
 * Like `modifySchema`, but the transform reports a value of its own alongside
 * the write decision, and the outcome carries it back — so a caller that runs
 * an operation inside the cycle gets the operation's result without capturing
 * it in a mutable closure.
 */
export const modifySchemaCarrying = <A, I, RSchema, C, E = never, R = never>(
  path: StateFilePath,
  schema: Schema.Schema<A, I, RSchema>,
  f: (value: A | undefined) => Effect.Effect<SchemaCycleStep<A, C>, E, R>,
  policy: ConflictPolicy = dropPolicy
): Effect.Effect<
  CarriedModifyOutcome<A, C>,
  CasFileStoreError | ConflictExhausted | E,
  R | RSchema | StateFileLocks
> => {
  const jsonSchema = Schema.parseJson(schema)
  const decode = (contents: string): Effect.Effect<A, CasFileStoreContentsInvalid, RSchema> =>
    Schema.decodeUnknown(jsonSchema)(contents).pipe(Effect.mapError(() => casFileStoreContentsInvalid(path)))
  const encode = (value: A): Effect.Effect<string, CasFileStoreContentsInvalid, RSchema> =>
    Schema.encode(jsonSchema)(value).pipe(Effect.mapError(() => casFileStoreContentsInvalid(path)))

  // The engine carries the pair { value written, caller's report } through to
  // the outcome: decoding the bytes we just wrote would fail for any schema
  // that does not round-trip, and only after the write had already landed.
  const transform = (contents: string | undefined) =>
    Effect.gen(function* () {
      const current = contents === undefined ? undefined : yield* decode(contents)
      const step = yield* f(current)

      if (step.decision._tag === "keep") {
        return { _tag: "keep" as const, carried: step.carried }
      }

      return {
        _tag: "write" as const,
        payload: {
          carried: { carried: step.carried, value: step.decision.value },
          contents: yield* encode(step.decision.value)
        }
      }
    })

  const adopt = (
    outcome: CarryOutcome<{ readonly carried: C; readonly value: A }, C>
  ): Effect.Effect<CarriedModifyOutcome<A, C>, CasFileStoreContentsInvalid, RSchema> => {
    if (outcome._tag === "saved") {
      return Effect.succeed({ _tag: "saved", carried: outcome.carried.carried, value: outcome.carried.value })
    }

    if (outcome._tag === "unchanged") {
      return Effect.succeed({ _tag: "unchanged", carried: outcome.carried })
    }

    // the fresh bytes are another writer's: they must be decoded to be adopted
    return outcome.current === undefined
      ? Effect.succeed({ _tag: "dropped-conflict", carried: outcome.carried.carried, value: undefined })
      : decode(outcome.current).pipe(
          Effect.map((value) => ({ _tag: "dropped-conflict" as const, carried: outcome.carried.carried, value }))
        )
  }

  return modifyCarrying(path, transform, policy).pipe(Effect.flatMap(adopt))
}

/**
 * Like `modify`, but `f` receives and returns a decoded value. The file is
 * decoded as JSON via the schema before `f` runs — or `f` sees `undefined` when
 * the file does not exist yet — and the result is encoded back for the write.
 * On `saved` the outcome carries the value `f` produced; on `dropped-conflict`
 * it carries the fresh value another process wrote, decoded and ready to adopt.
 */
export const modifySchema = <A, I, RSchema, E = never, R = never>(
  path: StateFilePath,
  schema: Schema.Schema<A, I, RSchema>,
  f: (value: A | undefined) => Effect.Effect<WriteDecision<A>, E, R>,
  policy: ConflictPolicy = dropPolicy
): Effect.Effect<ModifyOutcome<A>, CasFileStoreError | ConflictExhausted | E, R | RSchema | StateFileLocks> =>
  modifySchemaCarrying(
    path,
    schema,
    (value) => Effect.map(f(value), (decision): SchemaCycleStep<A, undefined> => ({ carried: undefined, decision })),
    policy
  ).pipe(
    Effect.map((outcome) =>
      outcome._tag === "saved"
        ? { _tag: "saved", value: outcome.value }
        : outcome._tag === "unchanged"
          ? { _tag: "unchanged" }
          : { _tag: "dropped-conflict", value: outcome.value }
    )
  )
