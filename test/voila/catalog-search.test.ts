import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import { normalizeSearchResponse, parseSearchResponse } from "../../src/voila/catalog-search.js"

const fixtureText = readFileSync(new URL("../fixtures/search-response-milk.json", import.meta.url), "utf8")

const readFixture = (): unknown => {
  const parsed = parseJson(fixtureText)

  if (Either.isLeft(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.right
}

describe("catalog search normalization", () => {
  it("normalizes PRD-required product fields from a sanitized search response", () => {
    const result = parseSearchResponse(readFixture())

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.pagination.nextPageToken).toBe("sanitized-next-page-token")
      expect(result.right.pagination.totalProducts).toBe(42)
      expect(result.right.products).toHaveLength(2)
      expect(result.right).not.toHaveProperty("productGroups")

      const [milk, lactoseFree] = result.right.products

      expect(milk?.productId).toBe("b952bad2-3d09-4b7f-831a-87ad31eaad3f")
      expect(milk?.retailerProductId).toBe("243255EA")
      expect(milk?.available).toBe(true)
      expect(milk?.brand).toBe("Lactantia")
      expect(milk?.name).toBe("Lactantia PurFiltre 2% Milk Partially Skimmed 2 L")
      expect(milk?.packSizeDescription).toBe("2L")
      expect(milk?.price).toEqual({
        amount: "5.69",
        currency: "CAD"
      })
      expect(milk?.unitPrice?.price.amount).toBe("0.28")
      expect(milk?.unitPrice?.unitName).toBe("PER_100ML")
      expect(milk?.image?.src).toBe("https://voila.ca/images/sanitized-milk.jpg")
      expect(milk?.quantityInBasket).toBe(1)
      expect(milk?.maxQuantityReached).toBe(false)
      expect(milk?.sourceGroupName).toBe("Top results")
      expect(milk?.sourceGroupType).toBe("featured")

      expect(lactoseFree?.productId).toBe("sanitized-second-product-id")
      expect(lactoseFree?.retailerProductId).toBe("987654EA")
      expect(lactoseFree?.available).toBe(false)
      expect(lactoseFree?.quantityInBasket).toBe(0)
      expect(lactoseFree?.sourceGroupType).toBe("standard")
    }
  })

  it("omits optional pagination fields when Voila omits them", () => {
    const result = normalizeSearchResponse({
      productGroups: []
    })

    expect(result.pagination).toEqual({})
    expect(result.products).toEqual([])
  })

  it("combines decorated and standard products when Voila sends both arrays", () => {
    const result = normalizeSearchResponse({
      productGroups: [{
        decoratedProducts: [{
          available: true,
          maxQuantityReached: false,
          name: "Decorated product",
          price: {
            amount: "1.00",
            currency: "CAD"
          },
          productId: "decorated-product-id",
          quantityInBasket: 0,
          retailerProductId: "decorated-retailer-product-id"
        }],
        products: [{
          available: true,
          maxQuantityReached: false,
          name: "Standard product",
          price: {
            amount: "2.00",
            currency: "CAD"
          },
          productId: "standard-product-id",
          quantityInBasket: 0,
          retailerProductId: "standard-retailer-product-id"
        }],
        type: "mixed"
      }]
    })

    expect(result.products.map((product) => product.productId)).toEqual([
      "decorated-product-id",
      "standard-product-id"
    ])
    expect(result.products[0]?.sourceGroupType).toBe("mixed")
    expect(result.products[1]?.sourceGroupType).toBe("mixed")
  })

  it("fails at the schema boundary when total product count is not a non-negative integer", () => {
    for (const totalProducts of [-1, 1.5]) {
      const result = parseSearchResponse({
        productGroups: [],
        totalProducts
      })

      expect(Either.isLeft(result)).toBe(true)

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("SearchResponseSchemaMismatch")
      }
    }
  })

  it("fails at the schema boundary when required product fields drift", () => {
    const result = parseSearchResponse({
      productGroups: [{
        decoratedProducts: [{
          available: true,
          name: "Broken product",
          price: {
            amount: "1.00",
            currency: "CAD"
          },
          productId: "product-id",
          quantityInBasket: 0,
          retailerProductId: "retailer-product-id"
        }],
        type: "featured"
      }]
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SearchResponseSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("Broken product")
    }
  })
})
