import { readFileSync } from "node:fs"

import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { NormalizedCategoryTreeSchema, RawCategoryTreeSchema } from "../../src/domain/schemas/index.js"
import { getInitialStateCategories, normalizeCategoryTree } from "../../src/voila/categories.js"
import { extractInitialState } from "../../src/voila/initial-state.js"
import { assertDecodeFailure, assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const fixtureHtml = readFileSync(new URL("../fixtures/voila-homepage.html", import.meta.url), "utf8")
const validRawCategory = {
  categoryId: "category-id",
  name: "Pantry",
  retailerCategoryId: "retailer-category-id",
  urlPath: "pantry"
}

describe("category tree normalization", () => {
  it("normalizes root and child categories from homepage initial state", () => {
    const initialState = extractInitialState(fixtureHtml)

    expect(Either.isRight(initialState)).toBe(true)

    if (Either.isRight(initialState)) {
      const categories = getInitialStateCategories(initialState.right)
      const [produce] = categories
      const [fruit, vegetables] = produce?.children ?? []

      expect(categories).toHaveLength(1)
      expect(produce?.categoryId).toBe("sanitized-category-produce")
      expect(produce?.retailerCategoryId).toBe("retailer-category-produce")
      expect(produce?.categoryId).not.toBe(produce?.retailerCategoryId)
      expect(produce?.name).toBe("Fruits & Vegetables")
      expect(produce?.fullUrlPath).toBe("/aisles/fruits-vegetables")

      expect(fruit?.categoryId).toBe("sanitized-category-fresh-fruit")
      expect(fruit?.retailerCategoryId).toBe("retailer-category-fruit")
      expect(fruit?.categoryId).not.toBe(fruit?.retailerCategoryId)
      expect(fruit?.fullUrlPath).toBe("/aisles/fruits-vegetables/fresh-fruit")

      expect(vegetables?.categoryId).toBe("sanitized-category-fresh-vegetables")
      expect(vegetables?.retailerCategoryId).toBe("retailer-category-vegetables")
      expect(vegetables?.categoryId).not.toBe(vegetables?.retailerCategoryId)
      expect(vegetables?.fullUrlPath).toBe("/aisles/fruits-vegetables/fresh-vegetables")
    }
  })

  it("returns an empty tree when initial state has no categories", () => {
    const initialState = extractInitialState(
      fixtureHtml.replace(/,\n          "categories": \[[\s\S]*?\n          \]/, "")
    )

    expect(Either.isRight(initialState)).toBe(true)

    if (Either.isRight(initialState)) {
      expect(getInitialStateCategories(initialState.right)).toEqual([])
    }
  })

  it("normalizes root URL paths without duplicate slashes", () => {
    const categories = normalizeCategoryTree([{
      ...validRawCategory,
      urlPath: "pantry/"
    }])

    expect(categories[0]?.fullUrlPath).toBe("/pantry")
  })

  it("preserves already-rooted child URL paths", () => {
    const categories = normalizeCategoryTree([{
      ...validRawCategory,
      categories: [{
        categoryId: "child-category-id",
        name: "Canned Goods",
        retailerCategoryId: "child-retailer-category-id",
        urlPath: "/pantry/canned-goods"
      }]
    }])

    expect(categories[0]?.children[0]?.fullUrlPath).toBe("/pantry/canned-goods")
  })

  it("normalizes children below a root URL path without duplicate leading slashes", () => {
    const categories = normalizeCategoryTree([{
      ...validRawCategory,
      categories: [{
        categoryId: "child-category-id",
        name: "Fresh Fruit",
        retailerCategoryId: "child-retailer-category-id",
        urlPath: "fresh-fruit"
      }],
      urlPath: "/"
    }])

    expect(categories[0]?.fullUrlPath).toBe("/")
    expect(categories[0]?.children[0]?.fullUrlPath).toBe("/fresh-fruit")
  })

  it("keeps normalized categories under the public category schema", () => {
    const categories = normalizeCategoryTree([{
      ...validRawCategory,
      categories: [{
        categoryId: "child-category-id",
        name: "Canned Goods",
        retailerCategoryId: "child-retailer-category-id",
        urlPath: "canned-goods"
      }]
    }])

    const decoded = assertDecodeSuccess(NormalizedCategoryTreeSchema, categories)
    expect(assertEncodeSuccess(NormalizedCategoryTreeSchema, decoded)).toEqual(categories)
  })

  it("rejects normalized categories without rooted full URL paths", () => {
    const duplicateSlashResult = Schema.decodeUnknownEither(NormalizedCategoryTreeSchema)([{
      categoryId: "category-id",
      children: [],
      fullUrlPath: "//pantry",
      name: "Pantry",
      retailerCategoryId: "retailer-category-id"
    }])

    assertDecodeFailure(NormalizedCategoryTreeSchema, [{
      categoryId: "category-id",
      children: [],
      fullUrlPath: "pantry",
      name: "Pantry",
      retailerCategoryId: "retailer-category-id"
    }])

    expect(Either.isLeft(duplicateSlashResult)).toBe(true)

    if (Either.isLeft(duplicateSlashResult)) {
      expect(String(duplicateSlashResult.left)).toContain(
        "Category full URL path must not start with duplicate slashes"
      )
    }
  })

  it("rejects malformed raw categories at the schema boundary", () => {
    for (
      const category of [
        {
          ...validRawCategory,
          categoryId: ""
        },
        {
          ...validRawCategory,
          categoryId: " category-id"
        },
        {
          ...validRawCategory,
          name: ""
        },
        {
          ...validRawCategory,
          retailerCategoryId: ""
        },
        {
          ...validRawCategory,
          urlPath: ""
        },
        {
          ...validRawCategory,
          retailerCategoryId: validRawCategory.categoryId
        }
      ]
    ) {
      assertDecodeFailure(RawCategoryTreeSchema, [category])
    }
  })

  it("explains category identifier collisions through schemas", () => {
    const rawResult = Schema.decodeUnknownEither(RawCategoryTreeSchema)([{
      ...validRawCategory,
      retailerCategoryId: validRawCategory.categoryId
    }])
    const normalizedResult = Schema.decodeUnknownEither(NormalizedCategoryTreeSchema)([{
      categoryId: "category-id",
      children: [],
      fullUrlPath: "/pantry",
      name: "Pantry",
      retailerCategoryId: "category-id"
    }])

    expect(Either.isLeft(rawResult)).toBe(true)
    expect(Either.isLeft(normalizedResult)).toBe(true)

    if (Either.isLeft(rawResult)) {
      expect(String(rawResult.left)).toContain("Category ID and retailer category ID must be distinct")
    }

    if (Either.isLeft(normalizedResult)) {
      expect(String(normalizedResult.left)).toContain("Category ID and retailer category ID must be distinct")
    }
  })
})
