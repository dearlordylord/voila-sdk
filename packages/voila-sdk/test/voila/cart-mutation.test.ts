import { readFileSync } from "node:fs"

import { Result } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import { NormalizedCartMutationResultSchema } from "../../src/domain/schemas/index.js"
import { normalizeCartMutationResponse, parseCartMutationResponse } from "../../src/voila/cart-mutation.js"
import { assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const fixtureStrawberriesProductUuid = "11111111-1111-4111-8111-111111111111"
const fixtureBlueberriesProductUuid = "22222222-2222-4222-8222-222222222222"

const readFixture = (fixtureName: string): unknown => {
  const fixtureText = readFileSync(new URL(`../fixtures/${fixtureName}`, import.meta.url), "utf8")
  const parsed = parseJson(fixtureText)

  if (Result.isFailure(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.success
}

describe("cart mutation response normalization", () => {
  it("normalizes successful apply-quantity responses with server-returned totals", () => {
    const result = parseCartMutationResponse(readFixture("cart-apply-success.json"))

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.itemCount).toBe(2)
      expect(result.success.itemGroups).toHaveLength(1)
      expect(result.success.itemGroups[0]?.items[0]?.productId).toBe(fixtureStrawberriesProductUuid)
      expect(result.success.itemGroups[0]?.items[0]?.quantity).toBe(2)
      expect(result.success.totals).toEqual({
        itemPriceAfterPromos: { amount: "8.88", currency: "CAD" },
        itemsRetailPrice: { amount: "9.98", currency: "CAD" },
        savingsPrice: { amount: "1.10", currency: "CAD" },
        taxation: "TAX_EXCLUDED"
      })
      expect(result.success.pricingNotifications).toEqual([
        { code: "PROMO_APPLIED", message: "A promotion was applied", severity: "INFO" }
      ])
      expect(result.success.limitedItems).toEqual([])
      expect(result.success.limitedPromotionIds).toEqual([])
      expect(result.success.unavailableData).toEqual([])
    }
  })

  it("preserves limited items, unavailable data, pricing notifications, and promotion IDs", () => {
    const result = parseCartMutationResponse(readFixture("cart-apply-limited-unavailable.json"))

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.itemCount).toBe(1)
      expect(result.success.totals.itemPriceAfterPromos.amount).toBe("4.99")
      expect(result.success.limitedItems).toEqual([
        {
          code: "MAX_QUANTITY",
          message: "Only one strawberry package can be added",
          productId: fixtureStrawberriesProductUuid,
          quantity: 1,
          reason: "MAX_QUANTITY",
          severity: "WARNING"
        }
      ])
      expect(result.success.limitedPromotionIds).toEqual(["sanitized-promo-id"])
      expect(result.success.pricingNotifications).toEqual([
        {
          code: "PRICE_CHANGED",
          message: "A product price changed while applying the cart delta",
          productId: fixtureStrawberriesProductUuid,
          severity: "INFO"
        }
      ])
      expect(result.success.unavailableData).toEqual([
        {
          code: "UNAVAILABLE",
          message: "Blueberries are unavailable",
          productId: fixtureBlueberriesProductUuid,
          severity: "WARNING"
        }
      ])
    }
  })

  it("keeps normalized cart mutation results under the public schema", () => {
    const parsed = parseCartMutationResponse(readFixture("cart-apply-limited-unavailable.json"))

    expect(Result.isSuccess(parsed)).toBe(true)

    if (Result.isSuccess(parsed)) {
      const decoded = assertDecodeSuccess(NormalizedCartMutationResultSchema, parsed.success)
      expect(assertEncodeSuccess(NormalizedCartMutationResultSchema, decoded)).toEqual(parsed.success)
    }
  })

  it("defaults missing item groups to an empty item group list", () => {
    const result = normalizeCartMutationResponse({
      basketUpdateResult: {
        totals: {
          itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
          itemsRetailPrice: { amount: "0.00", currency: "CAD" },
          savingsPrice: { amount: "0.00", currency: "CAD" },
          taxation: "TAX_EXCLUDED"
        }
      },
      limitedItems: [],
      limitedPromotionIds: [],
      pricingNotifications: [],
      unavailableData: []
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.itemCount).toBe(0)
      expect(result.success.itemGroups).toEqual([])
    }
  })

  it("fails at the schema boundary when totals are missing", () => {
    const result = parseCartMutationResponse({
      basketUpdateResult: {},
      limitedItems: [],
      limitedPromotionIds: [],
      pricingNotifications: [],
      unavailableData: []
    })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CartMutationResponseSchemaMismatch")
    }
  })

  it("fails at the schema boundary when limited items lose required fields", () => {
    const result = parseCartMutationResponse({
      basketUpdateResult: {
        totals: {
          itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
          itemsRetailPrice: { amount: "0.00", currency: "CAD" },
          savingsPrice: { amount: "0.00", currency: "CAD" },
          taxation: "TAX_EXCLUDED"
        }
      },
      limitedItems: [{ productId: "product-id", quantity: 1 }],
      limitedPromotionIds: [],
      pricingNotifications: [],
      unavailableData: []
    })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CartMutationResponseSchemaMismatch")
      expect(JSON.stringify(result.failure)).not.toContain("product-id")
    }
  })

  it("fails at the schema boundary when item quantities are not non-negative integers", () => {
    for (const quantity of [-1, 1.5]) {
      const result = parseCartMutationResponse({
        basketUpdateResult: {
          itemGroups: [{ items: [{ productId: "product-id", quantity }] }],
          totals: {
            itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
            itemsRetailPrice: { amount: "0.00", currency: "CAD" },
            savingsPrice: { amount: "0.00", currency: "CAD" },
            taxation: "TAX_EXCLUDED"
          }
        },
        limitedItems: [],
        limitedPromotionIds: [],
        pricingNotifications: [],
        unavailableData: []
      })

      expect(Result.isFailure(result)).toBe(true)

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("CartMutationResponseSchemaMismatch")
      }
    }
  })

  it("fails at the schema boundary when limited item quantities are not non-negative integers", () => {
    for (const quantity of [-1, 1.5]) {
      const result = parseCartMutationResponse({
        basketUpdateResult: {
          totals: {
            itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
            itemsRetailPrice: { amount: "0.00", currency: "CAD" },
            savingsPrice: { amount: "0.00", currency: "CAD" },
            taxation: "TAX_EXCLUDED"
          }
        },
        limitedItems: [{ productId: "product-id", quantity, reason: "MAX_QUANTITY" }],
        limitedPromotionIds: [],
        pricingNotifications: [],
        unavailableData: []
      })

      expect(Result.isFailure(result)).toBe(true)

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("CartMutationResponseSchemaMismatch")
      }
    }
  })
})
