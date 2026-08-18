import { Effect, Schema } from "effect"

import {
  ContentsInvalidError,
  type ReadError,
  type WriteError,
  type ConflictExhausted
} from "./atomic-file-store-errors.js"
import {
  modifyCarrying,
  type ModifyCarryOutcome,
  type ModifyCycleStep,
  type WriteDecision
} from "./atomic-file-store-engine.js"
import type { StateFileLocks } from "./atomic-file-store-locks.js"
import type { StateFilePath } from "./atomic-file-store-path.js"

export interface SchemaCycleStep<A, C> {
  readonly carried: C
  readonly decision: WriteDecision<A>
}

export type CarriedModifyOutcome<A, C> =
  | { readonly _tag: "saved"; readonly carried: C; readonly value: A }
  | { readonly _tag: "unchanged"; readonly carried: C }
  | { readonly _tag: "dropped-conflict"; readonly carried: C; readonly value: A | undefined }

export const modifySchemaCarrying = <S extends Schema.Constraint, C, E = never, R = never>(
  path: StateFilePath,
  schema: S,
  update: (value: S["Type"] | undefined) => Effect.Effect<SchemaCycleStep<S["Type"], C>, E, R>
): Effect.Effect<
  CarriedModifyOutcome<S["Type"], C>,
  ReadError | WriteError | ContentsInvalidError | ConflictExhausted | E,
  R | S["DecodingServices"] | S["EncodingServices"] | StateFileLocks
> => {
  const jsonSchema = Schema.fromJsonString(schema)
  const decode = (contents: string): Effect.Effect<S["Type"], ContentsInvalidError, S["DecodingServices"]> =>
    Schema.decodeUnknownEffect(jsonSchema)(contents).pipe(Effect.mapError(() => new ContentsInvalidError(path)))
  const encode = (value: S["Type"]): Effect.Effect<string, ContentsInvalidError, S["EncodingServices"]> =>
    Schema.encodeEffect(jsonSchema)(value).pipe(Effect.mapError(() => new ContentsInvalidError(path)))

  const transform = (
    contents: string | undefined
  ): Effect.Effect<
    ModifyCycleStep<{ readonly carried: C; readonly value: S["Type"] }, C>,
    ContentsInvalidError | E,
    R | S["DecodingServices"] | S["EncodingServices"]
  > =>
    Effect.gen(function* () {
      const current = contents === undefined ? undefined : yield* decode(contents)
      const step = yield* update(current)

      if (step.decision._tag === "keep") {
        const kept: ModifyCycleStep<{ readonly carried: C; readonly value: S["Type"] }, C> = {
          _tag: "keep",
          carried: step.carried
        }
        return kept
      }

      const written: ModifyCycleStep<{ readonly carried: C; readonly value: S["Type"] }, C> = {
        _tag: "write",
        payload: {
          carried: { carried: step.carried, value: step.decision.value },
          contents: yield* encode(step.decision.value)
        }
      }
      return written
    })

  const adopt = (
    outcome: ModifyCarryOutcome<{ readonly carried: C; readonly value: S["Type"] }, C>
  ): Effect.Effect<CarriedModifyOutcome<S["Type"], C>, ContentsInvalidError, S["DecodingServices"]> => {
    if (outcome._tag === "saved") {
      return Effect.succeed({ _tag: "saved", carried: outcome.carried.carried, value: outcome.carried.value })
    }

    if (outcome._tag === "unchanged") {
      return Effect.succeed({ _tag: "unchanged", carried: outcome.carried })
    }

    return outcome.current === undefined
      ? Effect.succeed({ _tag: "dropped-conflict", carried: outcome.carried.carried, value: undefined })
      : decode(outcome.current).pipe(
          Effect.map((value) => ({ _tag: "dropped-conflict", carried: outcome.carried.carried, value }))
        )
  }

  return modifyCarrying(path, transform).pipe(Effect.flatMap(adopt))
}
