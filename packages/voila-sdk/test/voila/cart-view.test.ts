import { readFileSync } from "node:fs"

import { Result } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import { NormalizedCartViewSchema } from "../../src/domain/schemas/index.js"
import { normalizeCartViewResponse, parseCartViewResponse } from "../../src/voila/cart-view.js"
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

describe("cart view normalization", () => {
  it("normalizes an empty cart view and preserves checkout restrictions", () => {
    const result = parseCartViewResponse(readFixture("cart-view-empty.json"))

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.basketId).toBe("sanitized-empty-basket-id")
      expect(result.success.itemCount).toBe(0)
      expect(result.success.items).toEqual([])
      expect(result.success.totals.itemPriceAfterPromos).toEqual({ amount: "0.00", currency: "CAD" })
      expect(result.success.checkoutRestrictions[0]).toEqual({
        code: "EMPTY_CART",
        message: "Cart must contain items before checkout",
        severity: "BLOCKING"
      })
      expect(result.success.limitedItems).toEqual([])
      expect(result.success.pricingNotifications).toEqual([])
      expect(result.success.unavailableData).toEqual([])
    }
  })

  it("normalizes product rows, server totals, and cart warning signals", () => {
    const result = parseCartViewResponse(readFixture("cart-view-non-empty.json"))

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.basketId).toBe("sanitized-basket-id")
      expect(result.success.itemCount).toBe(3)
      expect(result.success.totals).toEqual({
        itemPriceAfterPromos: { amount: "8.88", currency: "CAD" },
        itemsRetailPrice: { amount: "12.34", currency: "CAD" },
        savingsPrice: { amount: "3.46", currency: "CAD" },
        taxation: "TAX_EXCLUDED"
      })
      expect(result.success.items).toHaveLength(2)

      const [strawberries, blueberries] = result.success.items

      expect(strawberries?.groupName).toBe("Fruits & Vegetables")
      expect(strawberries?.productId).toBe(fixtureStrawberriesProductUuid)
      expect(strawberries?.retailerProductId).toBe("111222EA")
      expect(strawberries?.name).toBe("Fresh Farms Strawberries 454 g")
      expect(strawberries?.quantity).toBe(2)
      expect(strawberries?.price?.amount).toBe("4.99")
      expect(strawberries?.finalPrice?.amount).toBe("9.98")
      expect(strawberries?.available).toBe(true)
      expect(strawberries?.maxQuantityReached).toBe(false)

      expect(blueberries?.productId).toBe(fixtureBlueberriesProductUuid)
      expect(blueberries?.retailerProductId).toBe("333444EA")
      expect(blueberries?.quantity).toBe(1)
      expect(blueberries?.available).toBe(false)
      expect(blueberries?.unavailable).toBe(true)
      expect(blueberries?.maxQuantityReached).toBe(true)

      expect(result.success.checkoutRestrictions).toEqual([
        { code: "DELIVERY_SLOT_REQUIRED", message: "Select a delivery slot before checkout", severity: "BLOCKING" }
      ])
      expect(result.success.limitedItems).toEqual([
        {
          code: "MAX_QUANTITY",
          message: "Blueberries are limited to one item",
          productId: fixtureBlueberriesProductUuid,
          severity: "WARNING"
        }
      ])
      expect(result.success.pricingNotifications).toEqual([
        {
          code: "PRICE_CHANGED",
          message: "A product price changed since it was added",
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

  it("keeps normalized cart views under the public cart view schema", () => {
    const parsed = parseCartViewResponse(readFixture("cart-view-non-empty.json"))

    expect(Result.isSuccess(parsed)).toBe(true)

    if (Result.isSuccess(parsed)) {
      const decoded = assertDecodeSuccess(NormalizedCartViewSchema, parsed.success)
      expect(assertEncodeSuccess(NormalizedCartViewSchema, decoded)).toEqual(parsed.success)
    }
  })

  it("omits optional signal arrays and item groups when Voila omits them", () => {
    const result = normalizeCartViewResponse({
      basket: {
        basketId: "basket-id",
        totals: {
          itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
          itemsRetailPrice: { amount: "0.00", currency: "CAD" },
          savingsPrice: { amount: "0.00", currency: "CAD" },
          taxation: "TAX_EXCLUDED"
        }
      }
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.itemCount).toBe(0)
      expect(result.success.items).toEqual([])
      expect(result.success.checkoutRestrictions).toEqual([])
      expect(result.success.limitedItems).toEqual([])
      expect(result.success.pricingNotifications).toEqual([])
      expect(result.success.unavailableData).toEqual([])
    }
  })

  it("does not add group names when Voila omits item group names", () => {
    const result = normalizeCartViewResponse({
      basket: {
        basketId: "basket-id",
        itemGroups: [{ items: [{ productId: fixtureStrawberriesProductUuid, quantity: 1 }] }],
        totals: {
          itemPriceAfterPromos: { amount: "1.00", currency: "CAD" },
          itemsRetailPrice: { amount: "1.00", currency: "CAD" },
          savingsPrice: { amount: "0.00", currency: "CAD" },
          taxation: "TAX_EXCLUDED"
        }
      }
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.items[0]).toEqual({ productId: fixtureStrawberriesProductUuid, quantity: 1 })
    }
  })

  it("normalizes active cart groups without item groups as empty", () => {
    const result = normalizeCartViewResponse({
      cartId: "active-cart-id",
      checkoutGroups: { assignedCheckoutGroups: [{}] },
      totals: {
        itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
        itemsRetailPrice: { amount: "0.00", currency: "CAD" },
        savingsPrice: { amount: "0.00", currency: "CAD" },
        taxation: "TAX_EXCLUDED"
      }
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.basketId).toBe("active-cart-id")
      expect(result.success.items).toEqual([])
      expect(result.success.itemCount).toBe(0)
    }
  })

  it("fails at the schema boundary when totals are missing", () => {
    const result = parseCartViewResponse({ basket: { basketId: "basket-id" } })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CartViewResponseSchemaMismatch")
      expect(JSON.stringify(result.failure)).not.toContain("basket-id")
    }
  })

  it("fails at the schema boundary when product row quantities drift", () => {
    for (const quantity of [-1, 1.5]) {
      const result = parseCartViewResponse({
        basket: {
          basketId: "basket-id",
          itemGroups: [{ items: [{ productId: "product-id", quantity }] }],
          totals: {
            itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
            itemsRetailPrice: { amount: "0.00", currency: "CAD" },
            savingsPrice: { amount: "0.00", currency: "CAD" },
            taxation: "TAX_EXCLUDED"
          }
        }
      })

      expect(Result.isFailure(result)).toBe(true)
    }
  })
})
