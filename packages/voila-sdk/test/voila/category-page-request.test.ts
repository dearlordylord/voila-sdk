import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  CategoryPageInputSchema,
  MAX_CATEGORY_PAGE_SIZE,
  MIN_CATEGORY_PAGE_SIZE
} from "../../src/domain/schemas/index.js"
import type { CategoryProductsRequest, CategoryProductsRequestError } from "../../src/voila/urls.js"
import { makeCategoryProductsRequest } from "../../src/voila/urls.js"
import { assertDecodeFailure } from "../helpers/property.js"

const expectCategoryProductsRequest = (request: CategoryProductsRequest): CategoryProductsRequest => request

const expectCategoryProductsRequestError = (error: CategoryProductsRequestError): CategoryProductsRequestError => error

describe("category page request model", () => {
  it("builds deterministic Voila category product requests", () => {
    const first = makeCategoryProductsRequest({
      categoryId: "category-id",
      pageSize: 24,
      retailerCategoryId: "retailer-category-id"
    })
    const second = makeCategoryProductsRequest({
      categoryId: "category-id",
      pageSize: 24,
      retailerCategoryId: "retailer-category-id"
    })

    expect(Result.isSuccess(first)).toBe(true)
    expect(Result.isSuccess(second)).toBe(true)

    if (Result.isSuccess(first) && Result.isSuccess(second)) {
      const request = expectCategoryProductsRequest(first.success)

      expect(request.method).toBe("GET")
      expect(request.url.href).toBe(second.success.url.href)
      expect(request.url.pathname).toBe("/api/webproductpagews/v6/product-pages")
      expect(request.url.searchParams.get("categoryId")).toBe("category-id")
      expect(request.url.searchParams.get("retailerCategoryId")).toBe("retailer-category-id")
      expect(request.url.searchParams.get("tag")).toBe("web")
      expect(request.url.searchParams.get("includeAdditionalPageInfo")).toBe("true")
      expect(request.url.searchParams.get("maxProductsToDecorate")).toBe("24")
      expect(request.url.searchParams.get("maxPageSize")).toBe("24")
    }
  })

  it("adds optional pagination and filters", () => {
    const request = makeCategoryProductsRequest({
      filters: [
        { id: "brand", value: "fresh-farms" },
        { id: "dietary", value: "organic" }
      ],
      pageSize: 12,
      pageToken: "next-page-token",
      retailerCategoryId: "retailer-category-id"
    })

    expect(Result.isSuccess(request)).toBe(true)

    if (Result.isSuccess(request)) {
      expect(request.success.url.searchParams.get("pageToken")).toBe("next-page-token")
      expect(request.success.url.searchParams.get("retailerCategoryId")).toBe("retailer-category-id")
      expect(request.success.url.searchParams.getAll("filter")).toEqual(["brand:fresh-farms", "dietary:organic"])
    }
  })

  it("allows category ID without retailer category ID", () => {
    const request = makeCategoryProductsRequest({ categoryId: "category-id", pageSize: 12 })

    expect(Result.isSuccess(request)).toBe(true)

    if (Result.isSuccess(request)) {
      expect(request.success.url.searchParams.get("categoryId")).toBe("category-id")
      expect(request.success.url.searchParams.has("retailerCategoryId")).toBe(false)
    }
  })

  it("rejects invalid category page inputs at the boundary", () => {
    for (const input of [
      { pageSize: MIN_CATEGORY_PAGE_SIZE - 1, retailerCategoryId: "retailer-category-id" },
      { pageSize: MAX_CATEGORY_PAGE_SIZE + 1, retailerCategoryId: "retailer-category-id" },
      { pageSize: 12.5, retailerCategoryId: "retailer-category-id" },
      { pageSize: 12 },
      { categoryId: "", pageSize: 12 },
      { pageSize: 12, pageToken: "", retailerCategoryId: "retailer-category-id" },
      { filters: [{ id: "", value: "fresh-farms" }], pageSize: 12, retailerCategoryId: "retailer-category-id" },
      { filters: [{ id: "brand", value: " fresh-farms" }], pageSize: 12, retailerCategoryId: "retailer-category-id" },
      {
        filters: [{ id: "brand:name", value: "fresh-farms" }],
        pageSize: 12,
        retailerCategoryId: "retailer-category-id"
      },
      { filters: [{ id: "brand", value: "fresh:farms" }], pageSize: 12, retailerCategoryId: "retailer-category-id" }
    ]) {
      expect(Result.isFailure(makeCategoryProductsRequest(input))).toBe(true)
      assertDecodeFailure(CategoryPageInputSchema, input)
    }
  })

  it("explains ambiguous filter separator failures through the schema", () => {
    const result = Schema.decodeUnknownResult(CategoryPageInputSchema)({
      filters: [{ id: "brand:name", value: "fresh-farms" }],
      pageSize: 12,
      retailerCategoryId: "retailer-category-id"
    })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain("Category page filter values must not include ':'")
    }
  })

  it("returns a typed request error for invalid input", () => {
    const result = makeCategoryProductsRequest({ pageSize: 0 })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(expectCategoryProductsRequestError(result.failure)._tag).toBe("CategoryPageInputInvalid")
    }
  })

  it("explains missing category identifier failures through the schema", () => {
    const result = Schema.decodeUnknownResult(CategoryPageInputSchema)({ pageSize: 12 })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain("Category page input must include categoryId or retailerCategoryId")
    }
  })
})
