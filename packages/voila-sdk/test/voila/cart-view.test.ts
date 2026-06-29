import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import { NormalizedCartViewSchema } from "../../src/domain/schemas/index.js"
import { normalizeCartViewResponse, parseCartViewResponse } from "../../src/voila/cart-view.js"
import { assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const readFixture = (fixtureName: string): unknown => {
  const fixtureText = readFileSync(new URL(`../fixtures/${fixtureName}`, import.meta.url), "utf8")
  const parsed = parseJson(fixtureText)

  if (Either.isLeft(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.right
}

describe("cart view normalization", () => {
  it("normalizes an empty cart view and preserves checkout restrictions", () => {
    const result = parseCartViewResponse(readFixture("cart-view-empty.json"))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.basketId).toBe("sanitized-empty-basket-id")
      expect(result.right.itemCount).toBe(0)
      expect(result.right.items).toEqual([])
      expect(result.right.totals.itemPriceAfterPromos).toEqual({
        amount: "0.00",
        currency: "CAD"
      })
      expect(result.right.checkoutRestrictions[0]).toEqual({
        code: "EMPTY_CART",
        message: "Cart must contain items before checkout",
        severity: "BLOCKING"
      })
      expect(result.right.limitedItems).toEqual([])
      expect(result.right.pricingNotifications).toEqual([])
      expect(result.right.unavailableData).toEqual([])
    }
  })

  it("normalizes product rows, server totals, and cart warning signals", () => {
    const result = parseCartViewResponse(readFixture("cart-view-non-empty.json"))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.basketId).toBe("sanitized-basket-id")
      expect(result.right.itemCount).toBe(3)
      expect(result.right.totals).toEqual({
        itemPriceAfterPromos: {
          amount: "8.88",
          currency: "CAD"
        },
        itemsRetailPrice: {
          amount: "12.34",
          currency: "CAD"
        },
        savingsPrice: {
          amount: "3.46",
          currency: "CAD"
        },
        taxation: "TAX_EXCLUDED"
      })
      expect(result.right.items).toHaveLength(2)

      const [strawberries, blueberries] = result.right.items

      expect(strawberries?.groupName).toBe("Fruits & Vegetables")
      expect(strawberries?.productId).toBe("sanitized-strawberries-product-id")
      expect(strawberries?.retailerProductId).toBe("111222EA")
      expect(strawberries?.name).toBe("Fresh Farms Strawberries 454 g")
      expect(strawberries?.quantity).toBe(2)
      expect(strawberries?.price?.amount).toBe("4.99")
      expect(strawberries?.finalPrice?.amount).toBe("9.98")
      expect(strawberries?.available).toBe(true)
      expect(strawberries?.maxQuantityReached).toBe(false)

      expect(blueberries?.productId).toBe("sanitized-blueberries-product-id")
      expect(blueberries?.retailerProductId).toBe("333444EA")
      expect(blueberries?.quantity).toBe(1)
      expect(blueberries?.available).toBe(false)
      expect(blueberries?.unavailable).toBe(true)
      expect(blueberries?.maxQuantityReached).toBe(true)

      expect(result.right.checkoutRestrictions).toEqual([{
        code: "DELIVERY_SLOT_REQUIRED",
        message: "Select a delivery slot before checkout",
        severity: "BLOCKING"
      }])
      expect(result.right.limitedItems).toEqual([{
        code: "MAX_QUANTITY",
        message: "Blueberries are limited to one item",
        productId: "sanitized-blueberries-product-id",
        severity: "WARNING"
      }])
      expect(result.right.pricingNotifications).toEqual([{
        code: "PRICE_CHANGED",
        message: "A product price changed since it was added",
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

  it("keeps normalized cart views under the public cart view schema", () => {
    const parsed = parseCartViewResponse(readFixture("cart-view-non-empty.json"))

    expect(Either.isRight(parsed)).toBe(true)

    if (Either.isRight(parsed)) {
      const decoded = assertDecodeSuccess(NormalizedCartViewSchema, parsed.right)
      expect(assertEncodeSuccess(NormalizedCartViewSchema, decoded)).toEqual(parsed.right)
    }
  })

  it("omits optional signal arrays and item groups when Voila omits them", () => {
    const result = normalizeCartViewResponse({
      basket: {
        basketId: "basket-id",
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
      }
    })

    expect(result.itemCount).toBe(0)
    expect(result.items).toEqual([])
    expect(result.checkoutRestrictions).toEqual([])
    expect(result.limitedItems).toEqual([])
    expect(result.pricingNotifications).toEqual([])
    expect(result.unavailableData).toEqual([])
  })

  it("does not add group names when Voila omits item group names", () => {
    const result = normalizeCartViewResponse({
      basket: {
        basketId: "basket-id",
        itemGroups: [{
          items: [{
            productId: "product-id",
            quantity: 1
          }]
        }],
        totals: {
          itemPriceAfterPromos: {
            amount: "1.00",
            currency: "CAD"
          },
          itemsRetailPrice: {
            amount: "1.00",
            currency: "CAD"
          },
          savingsPrice: {
            amount: "0.00",
            currency: "CAD"
          },
          taxation: "TAX_EXCLUDED"
        }
      }
    })

    expect(result.items[0]).toEqual({
      productId: "product-id",
      quantity: 1
    })
  })

  it("fails at the schema boundary when totals are missing", () => {
    const result = parseCartViewResponse({
      basket: {
        basketId: "basket-id"
      }
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CartViewResponseSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("basket-id")
    }
  })

  it("fails at the schema boundary when product row quantities drift", () => {
    for (const quantity of [-1, 1.5]) {
      const result = parseCartViewResponse({
        basket: {
          basketId: "basket-id",
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
        }
      })

      expect(Either.isLeft(result)).toBe(true)
    }
  })
})
