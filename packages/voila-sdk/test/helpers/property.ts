import { Result, Schema } from "effect"
import type { Parameters } from "fast-check"

const DEFAULT_NUM_RUNS = 100

export const propertyTestParameters = { numRuns: DEFAULT_NUM_RUNS } satisfies Parameters

export const assertDecodeSuccess = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
): S["Type"] => {
  const result = Schema.decodeUnknownResult(schema)(input)

  if (Result.isFailure(result)) {
    throw new Error(`Expected schema decode to succeed, got: ${String(result.failure)}`)
  }

  return result.success
}

export const assertDecodeFailure = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): void => {
  const result = Schema.decodeUnknownResult(schema)(input)

  if (Result.isSuccess(result)) {
    throw new Error(`Expected schema decode to fail, got: ${String(result.success)}`)
  }
}

export const assertEncodeSuccess = <S extends Schema.ConstraintCodec<unknown>>(
  schema: S,
  value: S["Type"]
): S["Encoded"] => {
  const result = Schema.encodeResult(schema)(value)

  if (Result.isFailure(result)) {
    throw new Error(`Expected schema encode to succeed, got: ${String(result.failure)}`)
  }

  return result.success
}

export const assertEncodeFailure = <S extends Schema.ConstraintCodec<unknown>>(schema: S, value: S["Type"]): void => {
  const result = Schema.encodeResult(schema)(value)

  if (Result.isSuccess(result)) {
    throw new Error(`Expected schema encode to fail, got: ${String(result.success)}`)
  }
}
