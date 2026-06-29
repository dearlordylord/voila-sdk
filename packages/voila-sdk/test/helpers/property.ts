import { Either, Schema } from "effect"
import type { Parameters } from "fast-check"

const DEFAULT_NUM_RUNS = 100

export const propertyTestParameters = {
  numRuns: DEFAULT_NUM_RUNS
} satisfies Parameters

export const assertDecodeSuccess = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown
): A => {
  const result = Schema.decodeUnknownEither(schema)(input)

  if (Either.isLeft(result)) {
    throw new Error(`Expected schema decode to succeed, got: ${String(result.left)}`)
  }

  return result.right
}

export const assertDecodeFailure = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown
): void => {
  const result = Schema.decodeUnknownEither(schema)(input)

  if (Either.isRight(result)) {
    throw new Error(`Expected schema decode to fail, got: ${String(result.right)}`)
  }
}

export const assertEncodeSuccess = <A, I>(
  schema: Schema.Schema<A, I, never>,
  value: A
): I => {
  const result = Schema.encodeEither(schema)(value)

  if (Either.isLeft(result)) {
    throw new Error(`Expected schema encode to succeed, got: ${String(result.left)}`)
  }

  return result.right
}

export const assertEncodeFailure = <A, I>(
  schema: Schema.Schema<A, I, never>,
  value: A
): void => {
  const result = Schema.encodeEither(schema)(value)

  if (Either.isRight(result)) {
    throw new Error(`Expected schema encode to fail, got: ${String(result.right)}`)
  }
}
