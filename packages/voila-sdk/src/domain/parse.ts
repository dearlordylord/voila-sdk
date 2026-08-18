import { Result, Schema } from "effect"

export const parseUnknown = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
): Result.Result<S["Type"], Schema.SchemaError> => Schema.decodeUnknownResult(schema)(input)

export interface ParseJsonError {
  readonly _tag: "ParseJsonError"
  readonly message: string
}

export const parseJson = (text: string): Result.Result<unknown, ParseJsonError> => {
  try {
    return Result.succeed(JSON.parse(text))
  } catch {
    return Result.fail({ _tag: "ParseJsonError", message: "Invalid JSON" })
  }
}
