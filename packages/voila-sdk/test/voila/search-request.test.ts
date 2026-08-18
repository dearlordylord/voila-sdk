import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { MAX_SEARCH_PAGE_SIZE, MIN_SEARCH_PAGE_SIZE, SearchInputSchema } from "../../src/domain/schemas/index.js"
import { makeSearchRequest } from "../../src/voila/urls.js"
import { assertDecodeFailure } from "../helpers/property.js"

describe("search request model", () => {
  it("builds deterministic Voila search requests", () => {
    const first = makeSearchRequest({ pageSize: 24, query: "milk" })
    const second = makeSearchRequest({ pageSize: 24, query: "milk" })

    expect(Result.isSuccess(first)).toBe(true)
    expect(Result.isSuccess(second)).toBe(true)

    if (Result.isSuccess(first) && Result.isSuccess(second)) {
      expect(first.success.method).toBe("GET")
      expect(first.success.url.href).toBe(second.success.url.href)
      expect(first.success.url.pathname).toBe("/api/webproductpagews/v6/product-pages/search")
    }
  })

  it("encodes search query values through URLSearchParams", () => {
    const request = makeSearchRequest({ pageSize: 12, query: "milk & eggs" })

    expect(Result.isSuccess(request)).toBe(true)

    if (Result.isSuccess(request)) {
      expect(request.success.url.href).toContain("q=milk+%26+eggs")
      expect(request.success.url.searchParams.get("q")).toBe("milk & eggs")
    }
  })

  it("adds optional page token and category context", () => {
    const request = makeSearchRequest({
      categoryContext: { categoryId: "category-id", retailerCategoryId: "retailer-category-id" },
      pageSize: 24,
      pageToken: "next-page-token",
      query: "apples"
    })

    expect(Result.isSuccess(request)).toBe(true)

    if (Result.isSuccess(request)) {
      expect(request.success.url.searchParams.get("pageToken")).toBe("next-page-token")
      expect(request.success.url.searchParams.get("categoryId")).toBe("category-id")
      expect(request.success.url.searchParams.get("retailerCategoryId")).toBe("retailer-category-id")
    }
  })

  it("rejects invalid search inputs at the boundary", () => {
    for (const input of [
      { pageSize: MIN_SEARCH_PAGE_SIZE - 1, query: "milk" },
      { pageSize: MAX_SEARCH_PAGE_SIZE + 1, query: "milk" },
      { pageSize: 12.5, query: "milk" },
      { pageSize: 12, query: "" },
      { pageSize: 12, query: " milk" },
      { pageSize: 12, pageToken: "", query: "milk" },
      { categoryContext: {}, pageSize: 12, query: "milk" },
      { categoryContext: { categoryId: " category" }, pageSize: 12, query: "milk" },
      { categoryContext: { categoryId: "category", retailerCategoryId: "" }, pageSize: 12, query: "milk" },
      { categoryContext: { categoryId: "", retailerCategoryId: "retailer-category" }, pageSize: 12, query: "milk" }
    ]) {
      expect(Result.isFailure(makeSearchRequest(input))).toBe(true)
      assertDecodeFailure(SearchInputSchema, input)
    }
  })

  it("rejects invalid search input instead of exposing an unsafe URL helper", () => {
    const result = makeSearchRequest({ pageSize: 0, query: "" })

    expect(Result.isFailure(result)).toBe(true)
  })

  it("explains empty category context failures through the schema", () => {
    const result = Schema.decodeUnknownResult(SearchInputSchema)({ categoryContext: {}, pageSize: 12, query: "milk" })

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain("Category context must include categoryId or retailerCategoryId")
    }
  })
})
