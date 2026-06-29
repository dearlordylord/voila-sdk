import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import { NormalizedCartMutationResultSchema } from "../../src/domain/schemas/index.js"
import { normalizeCartMutationResponse, parseCartMutationResponse } from "../../src/voila/cart-mutation.js"
import { assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const readFixture = (fixtureName: string): unknown => {
  const fixtureText = readFileSync(new URL(`../fixtures/${fixtureName}`, import.meta.url), "utf8")
  const parsed = parseJson(fixtureText)

  if (Either.isLeft(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.right
}

describe("cart mutation response normalization", () => {
  it("normalizes successful apply-quantity responses with server-returned totals", () => {
    const result = parseCartMutationResponse(readFixture("cart-apply-success.json"))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.itemCount).toBe(2)
      expect(result.right.itemGroups).toHaveLength(1)
      expect(result.right.itemGroups[0]?.items[0]?.productId).toBe("sanitized-strawberries-product-id")
      expect(result.right.itemGroups[0]?.items[0]?.quantity).toBe(2)
      expect(result.right.totals).toEqual({
        itemPriceAfterPromos: {
          amount: "8.88",
          currency: "CAD"
        },
        itemsRetailPrice: {
          amount: "9.98",
          currency: "CAD"
        },
        savingsPrice: {
          amount: "1.10",
          currency: "CAD"
        },
        taxation: "TAX_EXCLUDED"
      })
      expect(result.right.pricingNotifications).toEqual([{
        code: "PROMO_APPLIED",
        message: "A promotion was applied",
        severity: "INFO"
      }])
      expect(result.right.limitedItems).toEqual([])
      expect(result.right.limitedPromotionIds).toEqual([])
      expect(result.right.unavailableData).toEqual([])
    }
  })

  it("preserves limited items, unavailable data, pricing notifications, and promotion IDs", () => {
    const result = parseCartMutationResponse(readFixture("cart-apply-limited-unavailable.json"))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.itemCount).toBe(1)
      expect(result.right.totals.itemPriceAfterPromos.amount).toBe("4.99")
      expect(result.right.limitedItems).toEqual([{
        code: "MAX_QUANTITY",
        message: "Only one strawberry package can be added",
        productId: "sanitized-strawberries-product-id",
        quantity: 1,
        reason: "MAX_QUANTITY",
        severity: "WARNING"
      }])
      expect(result.right.limitedPromotionIds).toEqual(["sanitized-promo-id"])
      expect(result.right.pricingNotifications).toEqual([{
        code: "PRICE_CHANGED",
        message: "A product price changed while applying the cart delta",
        productId: "sanitized-strawberries-product-id",
        severity: "INFO"
      }])
      expect(result.right.unavailableData).toEqual([{
        code: "UNAVAILABLE",
        message: "Blueberries are unavailable",
        productId: "sanitized-blueberries-product-id",
        severity: "WARNING"
      }])
    }
  })

  it("keeps normalized cart mutation results under the public schema", () => {
    const parsed = parseCartMutationResponse(readFixture("cart-apply-limited-unavailable.json"))

    expect(Either.isRight(parsed)).toBe(true)

    if (Either.isRight(parsed)) {
      const decoded = assertDecodeSuccess(NormalizedCartMutationResultSchema, parsed.right)
      expect(assertEncodeSuccess(NormalizedCartMutationResultSchema, decoded)).toEqual(parsed.right)
    }
  })

  it("defaults missing item groups to an empty item group list", () => {
    const result = normalizeCartMutationResponse({
      basketUpdateResult: {
        totals: {
          itemPriceAfterPromos: {
            amount: "0.00",
            currency: "CAD"
          },
          itemsRetailPrice: {
            amount: "0.00",
            currency: "CAD"
          },
          savingsPrice: {
            amount: "0.00",
            currency: "CAD"
          },
          taxation: "TAX_EXCLUDED"
        }
      },
      limitedItems: [],
      limitedPromotionIds: [],
      pricingNotifications: [],
      unavailableData: []
    })

    expect(result.itemCount).toBe(0)
    expect(result.itemGroups).toEqual([])
  })

  it("fails at the schema boundary when totals are missing", () => {
    const result = parseCartMutationResponse({
      basketUpdateResult: {},
      limitedItems: [],
      limitedPromotionIds: [],
      pricingNotifications: [],
      unavailableData: []
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CartMutationResponseSchemaMismatch")
    }
  })

  it("fails at the schema boundary when limited items lose required fields", () => {
    const result = parseCartMutationResponse({
      basketUpdateResult: {
        totals: {
          itemPriceAfterPromos: {
            amount: "0.00",
            currency: "CAD"
          },
          itemsRetailPrice: {
            amount: "0.00",
            currency: "CAD"
          },
          savingsPrice: {
            amount: "0.00",
            currency: "CAD"
          },
          taxation: "TAX_EXCLUDED"
        }
      },
      limitedItems: [{
        productId: "product-id",
        quantity: 1
      }],
      limitedPromotionIds: [],
      pricingNotifications: [],
      unavailableData: []
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CartMutationResponseSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("product-id")
    }
  })

  it("fails at the schema boundary when item quantities are not non-negative integers", () => {
    for (const quantity of [-1, 1.5]) {
      const result = parseCartMutationResponse({
        basketUpdateResult: {
          itemGroups: [{
            items: [{
              productId: "product-id",
              quantity
            }]
          }],
          totals: {
            itemPriceAfterPromos: {
              amount: "0.00",
              currency: "CAD"
            },
            itemsRetailPrice: {
              amount: "0.00",
              currency: "CAD"
            },
            savingsPrice: {
              amount: "0.00",
              currency: "CAD"
            },
            taxation: "TAX_EXCLUDED"
          }
        },
        limitedItems: [],
        limitedPromotionIds: [],
        pricingNotifications: [],
        unavailableData: []
      })

      expect(Either.isLeft(result)).toBe(true)

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("CartMutationResponseSchemaMismatch")
      }
    }
  })

  it("fails at the schema boundary when limited item quantities are not non-negative integers", () => {
    for (const quantity of [-1, 1.5]) {
      const result = parseCartMutationResponse({
        basketUpdateResult: {
          totals: {
            itemPriceAfterPromos: {
              amount: "0.00",
              currency: "CAD"
            },
            itemsRetailPrice: {
              amount: "0.00",
              currency: "CAD"
            },
            savingsPrice: {
              amount: "0.00",
              currency: "CAD"
            },
            taxation: "TAX_EXCLUDED"
          }
        },
        limitedItems: [{
          productId: "product-id",
          quantity,
          reason: "MAX_QUANTITY"
        }],
        limitedPromotionIds: [],
        pricingNotifications: [],
        unavailableData: []
      })

      expect(Either.isLeft(result)).toBe(true)

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("CartMutationResponseSchemaMismatch")
      }
    }
  })
})
