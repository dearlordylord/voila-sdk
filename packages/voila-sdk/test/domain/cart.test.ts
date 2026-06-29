import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { makeAddToCartDelta, makeCartQuantityDelta, makeRemoveFromCartDelta } from "../../src/domain/cart.js"
import { CartQuantityDeltaSchema } from "../../src/domain/schemas/index.js"

const productUuid = "b952bad2-3d09-4b7f-831a-87ad31eaad3f"

describe("cart deltas", () => {
  it("builds explicit quantity deltas", () => {
    const result = makeCartQuantityDelta(productUuid, 3)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        productId: productUuid,
        quantity: 3
      })
    }
  })

  it("normalizes add and remove quantities to the expected sign", () => {
    const add = makeAddToCartDelta(productUuid, -2)
    const remove = makeRemoveFromCartDelta(productUuid, 2)

    expect(Either.isRight(add)).toBe(true)
    expect(Either.isRight(remove)).toBe(true)

    if (Either.isRight(add) && Either.isRight(remove)) {
      expect(add.right).toEqual({
        productId: productUuid,
        quantity: 2
      })
      expect(remove.right).toEqual({
        productId: productUuid,
        quantity: -2
      })
    }
  })

  it("rejects invalid cart deltas", () => {
    for (
      const result of [
        makeCartQuantityDelta("243255EA", 1),
        makeCartQuantityDelta("", 1),
        makeCartQuantityDelta(productUuid, 0),
        makeCartQuantityDelta(productUuid, 1.5),
        makeCartQuantityDelta(productUuid, Number.POSITIVE_INFINITY)
      ]
    ) {
      expect(Either.isLeft(result)).toBe(true)

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("CartQuantityDeltaInvalid")
      }
    }
  })

  it("explains zero quantity failures through the schema", () => {
    const result = Schema.decodeUnknownEither(CartQuantityDeltaSchema)({
      productId: productUuid,
      quantity: 0
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(String(result.left)).toContain("Cart quantity delta must not be zero")
    }
  })
})
