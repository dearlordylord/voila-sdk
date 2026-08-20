import { readFileSync } from "node:fs"

import { Result } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import { normalizeCategoryProductsResponse, parseCategoryProductsResponse } from "../../src/voila/category-products.js"

const fixtureText = readFileSync(new URL("../fixtures/category-products-produce.json", import.meta.url), "utf8")
const fixtureStrawberriesProductUuid = "11111111-1111-4111-8111-111111111111"
const fixtureBlueberriesProductUuid = "22222222-2222-4222-8222-222222222222"
const decoratedProductUuid = "33333333-3333-4333-8333-333333333333"
const standardProductUuid = "44444444-4444-4444-8444-444444444444"

const readFixture = (): unknown => {
  const parsed = parseJson(fixtureText)

  if (Result.isFailure(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.success
}

describe("category product page normalization", () => {
  it("normalizes category metadata, filters, pagination, and PRD-required product fields", () => {
    const result = parseCategoryProductsResponse(readFixture())

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.category).toEqual({
        categoryId: "sanitized-category-produce",
        name: "Fruits & Vegetables",
        retailerCategoryId: "retailer-category-produce",
        urlPath: "/aisles/fruits-vegetables"
      })
      expect(result.success.pagination.nextPageToken).toBe("sanitized-category-next-page-token")
      expect(result.success.pagination.totalProducts).toBe(19)
      expect(result.success.filters).toHaveLength(2)
      expect(result.success.filters[0]?.id).toBe("brand")
      expect(result.success.filters[0]?.options[0]).toEqual({
        count: 7,
        id: "fresh-farms",
        label: "Fresh Farms",
        selected: true
      })
      expect(result.success.products).toHaveLength(2)
      expect(result.success).not.toHaveProperty("productGroups")

      const [strawberries, blueberries] = result.success.products

      expect(strawberries?.productId).toBe(fixtureStrawberriesProductUuid)
      expect(strawberries?.retailerProductId).toBe("111222EA")
      expect(strawberries?.available).toBe(true)
      expect(strawberries?.brand).toBe("Fresh Farms")
      expect(strawberries?.name).toBe("Fresh Farms Strawberries 454 g")
      expect(strawberries?.packSizeDescription).toBe("454g")
      expect(strawberries?.price).toEqual({ amount: "4.99", currency: "CAD" })
      expect(strawberries?.unitPrice?.price.amount).toBe("1.10")
      expect(strawberries?.unitPrice?.unitName).toBe("PER_100G")
      expect(strawberries?.image?.src).toBe("https://voila.ca/images/sanitized-strawberries.jpg")
      expect(strawberries?.quantityInBasket).toBe(2)
      expect(strawberries?.maxQuantityReached).toBe(false)
      expect(strawberries?.sourceGroupName).toBe("Featured in Fruits & Vegetables")
      expect(strawberries?.sourceGroupType).toBe("featured")

      expect(blueberries?.productId).toBe(fixtureBlueberriesProductUuid)
      expect(blueberries?.retailerProductId).toBe("333444EA")
      expect(blueberries?.available).toBe(false)
      expect(blueberries?.quantityInBasket).toBe(0)
      expect(blueberries?.maxQuantityReached).toBe(true)
      expect(blueberries?.sourceGroupType).toBe("standard")
    }
  })

  it("omits optional filter and pagination fields when Voila omits them", () => {
    const result = normalizeCategoryProductsResponse({
      category: { categoryId: "category-id", retailerCategoryId: "retailer-category-id" },
      productGroups: []
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.filters).toEqual([])
      expect(result.success.pagination).toEqual({})
      expect(result.success.products).toEqual([])
    }
  })

  it("keeps products from both category product arrays when Voila sends both", () => {
    const result = normalizeCategoryProductsResponse({
      category: { categoryId: "category-id", retailerCategoryId: "retailer-category-id" },
      productGroups: [
        {
          decoratedProducts: [
            {
              available: true,
              maxQuantityReached: false,
              name: "Decorated category product",
              price: { amount: "1.00", currency: "CAD" },
              productId: decoratedProductUuid,
              quantityInBasket: 0,
              retailerProductId: "decorated-category-retailer-product-id"
            }
          ],
          products: [
            {
              available: true,
              maxQuantityReached: false,
              name: "Standard category product",
              price: { amount: "2.00", currency: "CAD" },
              productId: standardProductUuid,
              quantityInBasket: 0,
              retailerProductId: "standard-category-retailer-product-id"
            }
          ],
          type: "mixed"
        }
      ]
    })

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.products.map((product) => product.productId)).toEqual([
        decoratedProductUuid,
        standardProductUuid
      ])
    }
  })

  it("fails at the schema boundary when category metadata drifts", () => {
    const result = parseCategoryProductsResponse({ category: { categoryId: "category-id" }, productGroups: [] })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CategoryProductsResponseSchemaMismatch")
      expect(JSON.stringify(result.failure)).not.toContain("category-id")
    }
  })

  it("fails at the schema boundary when filter counts are not non-negative integers", () => {
    for (const count of [-1, 1.5]) {
      const result = parseCategoryProductsResponse({
        category: { categoryId: "category-id", retailerCategoryId: "retailer-category-id" },
        filters: [{ id: "brand", label: "Brand", options: [{ count, id: "fresh-farms", label: "Fresh Farms" }] }],
        productGroups: []
      })

      expect(Result.isFailure(result)).toBe(true)

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("CategoryProductsResponseSchemaMismatch")
      }
    }
  })

  it("fails at the schema boundary when total product count is not a non-negative integer", () => {
    for (const totalProducts of [-1, 1.5]) {
      const result = parseCategoryProductsResponse({
        category: { categoryId: "category-id", retailerCategoryId: "retailer-category-id" },
        productGroups: [],
        totalProducts
      })

      expect(Result.isFailure(result)).toBe(true)

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("CategoryProductsResponseSchemaMismatch")
      }
    }
  })

  it("fails at the schema boundary when product fields drift", () => {
    const result = parseCategoryProductsResponse({
      category: { categoryId: "category-id", retailerCategoryId: "retailer-category-id" },
      productGroups: [
        {
          products: [
            {
              available: true,
              name: "Broken category product",
              price: { amount: "1.00", currency: "CAD" },
              productId: "product-id",
              quantityInBasket: 0,
              retailerProductId: "retailer-product-id"
            }
          ],
          type: "standard"
        }
      ]
    })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CategoryProductsResponseSchemaMismatch")
      expect(JSON.stringify(result.failure)).not.toContain("Broken category product")
    }
  })
})
