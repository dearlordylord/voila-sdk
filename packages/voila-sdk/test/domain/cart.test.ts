import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { makeAddToCartDelta, makeCartQuantityDelta, makeRemoveFromCartDelta } from "../../src/domain/cart.js"
import { CartQuantityDeltaSchema } from "../../src/domain/schemas/index.js"

const productUuid = "b952bad2-3d09-4b7f-831a-87ad31eaad3f"

describe("cart deltas", () => {
  it("builds explicit quantity deltas", () => {
    const result = makeCartQuantityDelta(productUuid, 3)

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ productId: productUuid, quantity: 3 })
    }
  })

  it("normalizes add and remove quantities to the expected sign", () => {
    const add = makeAddToCartDelta(productUuid, -2)
    const remove = makeRemoveFromCartDelta(productUuid, 2)

    expect(Result.isSuccess(add)).toBe(true)
    expect(Result.isSuccess(remove)).toBe(true)

    if (Result.isSuccess(add) && Result.isSuccess(remove)) {
      expect(add.success).toEqual({ productId: productUuid, quantity: 2 })
      expect(remove.success).toEqual({ productId: productUuid, quantity: -2 })
    }
  })

  it("rejects invalid cart deltas", () => {
    for (const result of [
      makeCartQuantityDelta("243255EA", 1),
      makeCartQuantityDelta("", 1),
      makeCartQuantityDelta(productUuid, 0),
      makeCartQuantityDelta(productUuid, 1.5),
      makeCartQuantityDelta(productUuid, Number.POSITIVE_INFINITY)
    ]) {
      expect(Result.isFailure(result)).toBe(true)

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("CartQuantityDeltaInvalid")
      }
    }
  })

  it("explains zero quantity failures through the schema", () => {
    const result = Schema.decodeUnknownResult(CartQuantityDeltaSchema)({ productId: productUuid, quantity: 0 })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain("Cart quantity delta must not be zero")
    }
  })
})
