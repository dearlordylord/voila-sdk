import type { ParseResult } from "effect"
import { Either, Schema } from "effect"

export const parseUnknown = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown
): Either.Either<A, ParseResult.ParseError> => Schema.decodeUnknownEither(schema)(input)

export interface ParseJsonError {
  readonly _tag: "ParseJsonError"
  readonly message: string
}

export const parseJson = (text: string): Either.Either<unknown, ParseJsonError> => {
  try {
    return Either.right(JSON.parse(text))
  } catch {
    return Either.left({ _tag: "ParseJsonError", message: "Invalid JSON" })
  }
}
