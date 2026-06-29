import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import { normalizeCategoryProductsResponse, parseCategoryProductsResponse } from "../../src/voila/category-products.js"

const fixtureText = readFileSync(new URL("../fixtures/category-products-produce.json", import.meta.url), "utf8")

const readFixture = (): unknown => {
  const parsed = parseJson(fixtureText)

  if (Either.isLeft(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.right
}

describe("category product page normalization", () => {
  it("normalizes category metadata, filters, pagination, and PRD-required product fields", () => {
    const result = parseCategoryProductsResponse(readFixture())

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.category).toEqual({
        categoryId: "sanitized-category-produce",
        name: "Fruits & Vegetables",
        retailerCategoryId: "retailer-category-produce",
        urlPath: "/aisles/fruits-vegetables"
      })
      expect(result.right.pagination.nextPageToken).toBe("sanitized-category-next-page-token")
      expect(result.right.pagination.totalProducts).toBe(19)
      expect(result.right.filters).toHaveLength(2)
      expect(result.right.filters[0]?.id).toBe("brand")
      expect(result.right.filters[0]?.options[0]).toEqual({
        count: 7,
        id: "fresh-farms",
        label: "Fresh Farms",
        selected: true
      })
      expect(result.right.products).toHaveLength(2)
      expect(result.right).not.toHaveProperty("productGroups")

      const [strawberries, blueberries] = result.right.products

      expect(strawberries?.productId).toBe("sanitized-strawberries-product-id")
      expect(strawberries?.retailerProductId).toBe("111222EA")
      expect(strawberries?.available).toBe(true)
      expect(strawberries?.brand).toBe("Fresh Farms")
      expect(strawberries?.name).toBe("Fresh Farms Strawberries 454 g")
      expect(strawberries?.packSizeDescription).toBe("454g")
      expect(strawberries?.price).toEqual({
        amount: "4.99",
        currency: "CAD"
      })
      expect(strawberries?.unitPrice?.price.amount).toBe("1.10")
      expect(strawberries?.unitPrice?.unitName).toBe("PER_100G")
      expect(strawberries?.image?.src).toBe("https://voila.ca/images/sanitized-strawberries.jpg")
      expect(strawberries?.quantityInBasket).toBe(2)
      expect(strawberries?.maxQuantityReached).toBe(false)
      expect(strawberries?.sourceGroupName).toBe("Featured in Fruits & Vegetables")
      expect(strawberries?.sourceGroupType).toBe("featured")

      expect(blueberries?.productId).toBe("sanitized-blueberries-product-id")
      expect(blueberries?.retailerProductId).toBe("333444EA")
      expect(blueberries?.available).toBe(false)
      expect(blueberries?.quantityInBasket).toBe(0)
      expect(blueberries?.maxQuantityReached).toBe(true)
      expect(blueberries?.sourceGroupType).toBe("standard")
    }
  })

  it("omits optional filter and pagination fields when Voila omits them", () => {
    const result = normalizeCategoryProductsResponse({
      category: {
        categoryId: "category-id",
        retailerCategoryId: "retailer-category-id"
      },
      productGroups: []
    })

    expect(result.filters).toEqual([])
    expect(result.pagination).toEqual({})
    expect(result.products).toEqual([])
  })

  it("keeps products from both category product arrays when Voila sends both", () => {
    const result = normalizeCategoryProductsResponse({
      category: {
        categoryId: "category-id",
        retailerCategoryId: "retailer-category-id"
      },
      productGroups: [{
        decoratedProducts: [{
          available: true,
          maxQuantityReached: false,
          name: "Decorated category product",
          price: {
            amount: "1.00",
            currency: "CAD"
          },
          productId: "decorated-category-product-id",
          quantityInBasket: 0,
          retailerProductId: "decorated-category-retailer-product-id"
        }],
        products: [{
          available: true,
          maxQuantityReached: false,
          name: "Standard category product",
          price: {
            amount: "2.00",
            currency: "CAD"
          },
          productId: "standard-category-product-id",
          quantityInBasket: 0,
          retailerProductId: "standard-category-retailer-product-id"
        }],
        type: "mixed"
      }]
    })

    expect(result.products.map((product) => product.productId)).toEqual([
      "decorated-category-product-id",
      "standard-category-product-id"
    ])
  })

  it("fails at the schema boundary when category metadata drifts", () => {
    const result = parseCategoryProductsResponse({
      category: {
        categoryId: "category-id"
      },
      productGroups: []
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CategoryProductsResponseSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("category-id")
    }
  })

  it("fails at the schema boundary when filter counts are not non-negative integers", () => {
    for (const count of [-1, 1.5]) {
      const result = parseCategoryProductsResponse({
        category: {
          categoryId: "category-id",
          retailerCategoryId: "retailer-category-id"
        },
        filters: [{
          id: "brand",
          label: "Brand",
          options: [{
            count,
            id: "fresh-farms",
            label: "Fresh Farms"
          }]
        }],
        productGroups: []
      })

      expect(Either.isLeft(result)).toBe(true)

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("CategoryProductsResponseSchemaMismatch")
      }
    }
  })

  it("fails at the schema boundary when total product count is not a non-negative integer", () => {
    for (const totalProducts of [-1, 1.5]) {
      const result = parseCategoryProductsResponse({
        category: {
          categoryId: "category-id",
          retailerCategoryId: "retailer-category-id"
        },
        productGroups: [],
        totalProducts
      })

      expect(Either.isLeft(result)).toBe(true)

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("CategoryProductsResponseSchemaMismatch")
      }
    }
  })

  it("fails at the schema boundary when product fields drift", () => {
    const result = parseCategoryProductsResponse({
      category: {
        categoryId: "category-id",
        retailerCategoryId: "retailer-category-id"
      },
      productGroups: [{
        products: [{
          available: true,
          name: "Broken category product",
          price: {
            amount: "1.00",
            currency: "CAD"
          },
          productId: "product-id",
          quantityInBasket: 0,
          retailerProductId: "retailer-product-id"
        }],
        type: "standard"
      }]
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CategoryProductsResponseSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("Broken category product")
    }
  })
})
