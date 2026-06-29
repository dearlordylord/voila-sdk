import type { ParseResult } from "effect"
import { Either, Schema } from "effect"

export const parseUnknown = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown
): Either.Either<A, ParseResult.ParseError> => Schema.decodeUnknownEither(schema)(input)

export const parseJson = (text: string): Either.Either<unknown, Error> => {
  try {
    return Either.right(JSON.parse(text))
  } catch (error) {
    return Either.left(new Error("Invalid JSON", { cause: error }))
  }
}
