import { Either } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import { makeAddToCartDelta, makeRemoveFromCartDelta } from "../../src/domain/cart.js"
import { propertyTestParameters } from "../helpers/property.js"

const nonZeroQuantity = fc.integer({ max: 1000, min: -1000 }).filter((quantity) => quantity !== 0)
const productUuid = fc.uuid().filter((value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
)

describe("cart delta properties", () => {
  it("normalizes add quantities to positive deltas", () => {
    fc.assert(
      fc.property(productUuid, nonZeroQuantity, (productId, quantity) => {
        const result = makeAddToCartDelta(productId, quantity)

        expect(Either.isRight(result)).toBe(true)

        if (Either.isRight(result)) {
          expect(result.right.productId).toBe(productId)
          expect(result.right.quantity).toBeGreaterThan(0)
          expect(result.right.quantity).toBe(Math.abs(quantity))
        }
      }),
      propertyTestParameters
    )
  })

  it("normalizes remove quantities to negative deltas", () => {
    fc.assert(
      fc.property(productUuid, nonZeroQuantity, (productId, quantity) => {
        const result = makeRemoveFromCartDelta(productId, quantity)

        expect(Either.isRight(result)).toBe(true)

        if (Either.isRight(result)) {
          expect(result.right.productId).toBe(productId)
          expect(result.right.quantity).toBeLessThan(0)
          expect(result.right.quantity).toBe(-Math.abs(quantity))
        }
      }),
      propertyTestParameters
    )
  })
})
