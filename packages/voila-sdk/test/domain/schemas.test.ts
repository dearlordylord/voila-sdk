import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseUnknown } from "../../src/domain/parse.js"
import { CartUpdateResponseSchema, ProductSearchResponseSchema } from "../../src/domain/schemas/index.js"

const sampleSearchResponse = {
  productGroups: [{
    decoratedProducts: [{
      available: true,
      brand: "Lactantia",
      maxQuantityReached: false,
      name: "Lactantia PurFiltre 2% Milk Partially Skimmed 2 L",
      packSizeDescription: "2L",
      price: {
        amount: "5.69",
        currency: "CAD"
      },
      productId: "b952bad2-3d09-4b7f-831a-87ad31eaad3f",
      quantityInBasket: 0,
      retailerProductId: "243255EA",
      unitPrice: {
        price: {
          amount: "0.28",
          currency: "CAD"
        },
        unit: "fop.price.per.100ml",
        unitName: "PER_100ML"
      }
    }],
    type: "featured"
  }]
}

const sampleCartUpdateResponse = {
  basketUpdateResult: {
    itemGroups: [{
      items: [{
        finalPrice: {
          amount: "5.69",
          currency: "CAD"
        },
        maxQuantityReached: false,
        price: {
          amount: "5.69",
          currency: "CAD"
        },
        productId: "b952bad2-3d09-4b7f-831a-87ad31eaad3f",
        quantity: 1
      }]
    }],
    totals: {
      itemPriceAfterPromos: {
        amount: "5.69",
        currency: "CAD"
      },
      itemsRetailPrice: {
        amount: "5.69",
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
}

describe("Voila response schemas", () => {
  it("parses a product search response", () => {
    const result = parseUnknown(ProductSearchResponseSchema, sampleSearchResponse)

    expect(Either.isRight(result)).toBe(true)
  })

  it("parses a cart update response", () => {
    const result = parseUnknown(CartUpdateResponseSchema, sampleCartUpdateResponse)

    expect(Either.isRight(result)).toBe(true)
  })

  it("rejects malformed cart responses", () => {
    const result = parseUnknown(CartUpdateResponseSchema, {
      basketUpdateResult: {
        totals: {
          itemPriceAfterPromos: "5.69"
        }
      }
    })

    expect(Either.isLeft(result)).toBe(true)
  })
})
